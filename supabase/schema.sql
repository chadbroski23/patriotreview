-- =====================================================================
-- THE PATRIOT REVIEW — database schema
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Run it ONCE on a fresh project. (To start over, run reset.sql first.)
-- =====================================================================
--
-- How blindness works
-- -------------------
-- Postgres Row Level Security (RLS) controls which ROWS a person can read,
-- not which columns. So the author's identity lives in its own table
-- (submission_authors) that only the editor can read. Reviewers and the final
-- reviewer never get a single row from it. Vote totals and pass/cut status
-- are also kept away from regular reviewers.
--
--   submissions          number + neutral PDF filename        (no identity)
--   submission_authors   author name + grade                  (editor only)
--   submission_status    pass/cut + final decision            (editor; final reviewer sees passed rows)
--   votes                one row per reviewer per submission  (editor sees all; reviewer sees own)
--   profiles             who each account is + their role
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Types and tables
-- ---------------------------------------------------------------------

create type public.user_role    as enum ('reviewer', 'editor', 'final_reviewer');
create type public.review_state as enum ('pending', 'passed', 'cut');
create type public.final_state  as enum ('accepted', 'rejected');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role         public.user_role not null,
  active       boolean not null default true
);

create table public.submissions (
  id                uuid primary key default gen_random_uuid(),
  submission_number integer not null unique check (submission_number > 0),
  storage_path      text not null unique,      -- always "submission-001.pdf" style
  created_at        timestamptz not null default now()
);

create table public.submission_authors (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  author_name   text not null,
  author_grade  text not null
);

create table public.submission_status (
  submission_id    uuid primary key references public.submissions (id) on delete cascade,
  review_status    public.review_state not null default 'pending',
  final_decision   public.final_state,
  final_decided_at timestamptz
);

create table public.votes (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  reviewer_id   uuid not null references public.profiles (id),
  vote          text not null check (vote in ('yes', 'no')),
  created_at    timestamptz not null default now(),
  unique (submission_id, reviewer_id)          -- ONE vote per reviewer per submission
);


-- ---------------------------------------------------------------------
-- 2. Helper functions (used by the security rules below)
--    SECURITY DEFINER lets them look up the caller's role without the
--    caller needing permission to read the profiles table directly.
-- ---------------------------------------------------------------------

create or replace function public.my_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.my_role() = 'editor', false) $$;

create or replace function public.is_reviewer()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.my_role() = 'reviewer', false) $$;

create or replace function public.is_final_reviewer()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.my_role() = 'final_reviewer', false) $$;

create or replace function public.is_passed(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.submission_status
    where submission_id = p_submission_id and review_status = 'passed'
  )
$$;

-- Who may download which PDF file from Storage.
create or replace function public.can_read_pdf(p_object_name text)
returns boolean language sql stable security definer set search_path = public
as $$
  select case public.my_role()
    when 'editor'   then true
    when 'reviewer' then exists (
      select 1 from public.submissions s where s.storage_path = p_object_name)
    when 'final_reviewer' then exists (
      select 1
      from public.submissions s
      join public.submission_status st on st.submission_id = s.id
      where s.storage_path = p_object_name and st.review_status = 'passed')
    else false
  end
$$;


-- ---------------------------------------------------------------------
-- 3. Table permissions (deny everything, then allow only what's needed)
--    Nobody gets UPDATE on anything, and nobody gets DELETE on votes,
--    so votes cannot be changed or removed through the website/API.
-- ---------------------------------------------------------------------

revoke all on public.profiles, public.submissions, public.submission_authors,
              public.submission_status, public.votes
  from public, anon, authenticated;

grant select         on public.profiles           to authenticated;
grant select, delete on public.submissions        to authenticated;  -- delete: editor undoing a failed upload
grant select         on public.submission_authors to authenticated;
grant select         on public.submission_status  to authenticated;
grant select, insert on public.votes              to authenticated;


-- ---------------------------------------------------------------------
-- 4. Row Level Security rules
-- ---------------------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.submissions        enable row level security;
alter table public.submission_authors enable row level security;
alter table public.submission_status  enable row level security;
alter table public.votes              enable row level security;

-- profiles: you can see your own row; the editor can see everyone's.
create policy "profiles: own row or editor"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_editor());

-- submissions (no identity in here):
--   reviewers + editor see all; the final reviewer only sees passed ones.
create policy "submissions: read by role"
  on public.submissions for select to authenticated
  using (
    public.is_editor()
    or public.is_reviewer()
    or (public.is_final_reviewer() and public.is_passed(id))
  );

create policy "submissions: editor can delete"
  on public.submissions for delete to authenticated
  using (public.is_editor());

-- author name + grade: EDITOR ONLY. No other role can read a single row.
create policy "authors: editor only"
  on public.submission_authors for select to authenticated
  using (public.is_editor());

-- pass/cut + final decision: editor sees all; final reviewer sees passed rows.
-- Regular reviewers have no matching rule here, so they see nothing.
create policy "status: editor or final reviewer (passed only)"
  on public.submission_status for select to authenticated
  using (
    public.is_editor()
    or (public.is_final_reviewer() and review_status = 'passed')
  );

-- votes: editor sees all; a reviewer sees ONLY their own votes.
create policy "votes: editor all, reviewer own"
  on public.votes for select to authenticated
  using (
    public.is_editor()
    or (public.is_reviewer() and reviewer_id = auth.uid())
  );

-- A reviewer can only insert a vote as themselves. (The unique constraint
-- stops a second vote; there is no UPDATE or DELETE rule, so it can't change.)
create policy "votes: reviewers vote as themselves"
  on public.votes for insert to authenticated
  with check (public.is_reviewer() and reviewer_id = auth.uid());


-- ---------------------------------------------------------------------
-- 5. Votes are permanent (even from the Supabase dashboard)
-- ---------------------------------------------------------------------

create or replace function public.block_vote_changes()
returns trigger language plpgsql as $$
begin
  raise exception 'Votes cannot be changed.';
end $$;

create trigger votes_are_permanent
  before update on public.votes
  for each row execute function public.block_vote_changes();


-- ---------------------------------------------------------------------
-- 6. The passing rule
--    After each vote, check whether ALL active reviewers have voted.
--    Only then decide. 50% YES or more passes (yes*2 >= votes cast).
--    8/8 down to 4/8 = PASS, 3/8 or fewer = CUT.
-- ---------------------------------------------------------------------

create or replace function public.finalize_review()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_status public.review_state;
  v_needed integer;
  v_cast   integer;
  v_yes    integer;
begin
  -- Lock this submission's status row so two last-second votes can't
  -- both think the other one hasn't happened yet.
  select review_status into v_status
  from public.submission_status
  where submission_id = new.submission_id
  for update;

  if v_status is distinct from 'pending' then
    return new;                                   -- already decided
  end if;

  select count(*) into v_needed
  from public.profiles where role = 'reviewer' and active;

  select count(*), count(*) filter (where vote = 'yes')
    into v_cast, v_yes
  from public.votes where submission_id = new.submission_id;

  if v_needed > 0 and v_cast >= v_needed then
    update public.submission_status
       set review_status = (case when v_yes * 2 >= v_cast then 'passed' else 'cut' end)::public.review_state
     where submission_id = new.submission_id;
  end if;

  return new;
end $$;

create trigger votes_finalize_review
  after insert on public.votes
  for each row execute function public.finalize_review();


-- ---------------------------------------------------------------------
-- 7. Actions that need more than a plain insert
-- ---------------------------------------------------------------------

-- Editor adds a submission. Assigns the next number and the neutral
-- filename. (The website then uploads the PDF to exactly that filename.)
create or replace function public.create_submission(p_author_name text, p_author_grade text)
returns table (new_id uuid, new_number integer, new_path text)
language plpgsql security definer set search_path = public
as $$
declare
  n   integer;
  sid uuid;
  p   text;
begin
  if not public.is_editor() then
    raise exception 'Only the editor can add submissions.';
  end if;
  if btrim(coalesce(p_author_name, '')) = '' or btrim(coalesce(p_author_grade, '')) = '' then
    raise exception 'Author name and grade are required.';
  end if;

  perform pg_advisory_xact_lock(7001);            -- one upload at a time, so numbers never collide
  select coalesce(max(s.submission_number), 0) + 1 into n from public.submissions s;
  p := 'submission-' || case when n < 1000 then lpad(n::text, 3, '0') else n::text end || '.pdf';

  insert into public.submissions (submission_number, storage_path)
  values (n, p) returning id into sid;

  insert into public.submission_authors (submission_id, author_name, author_grade)
  values (sid, btrim(p_author_name), btrim(p_author_grade));

  insert into public.submission_status (submission_id) values (sid);

  return query select sid, n, p;
end $$;

-- Final reviewer records ACCEPT or REJECT. Only for passed submissions,
-- and only once.
create or replace function public.record_final_decision(p_submission_id uuid, p_decision public.final_state)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_final_reviewer() then
    raise exception 'Only the final reviewer can record a decision.';
  end if;

  update public.submission_status
     set final_decision = p_decision, final_decided_at = now()
   where submission_id = p_submission_id
     and review_status = 'passed'
     and final_decision is null;

  if not found then
    raise exception 'This submission cannot be decided (it has not passed, or is already decided).';
  end if;
end $$;

-- Who can call what
revoke execute on function
  public.my_role(), public.is_editor(), public.is_reviewer(), public.is_final_reviewer(),
  public.is_passed(uuid), public.can_read_pdf(text),
  public.create_submission(text, text), public.record_final_decision(uuid, public.final_state),
  public.finalize_review(), public.block_vote_changes()
  from public, anon, authenticated;

grant execute on function
  public.my_role(), public.is_editor(), public.is_reviewer(), public.is_final_reviewer(),
  public.is_passed(uuid), public.can_read_pdf(text),
  public.create_submission(text, text), public.record_final_decision(uuid, public.final_state)
  to authenticated;


-- ---------------------------------------------------------------------
-- 8. PDF storage (private bucket)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 20971520,
      allowed_mime_types = array['application/pdf'];

-- Only the editor can upload, and only with a neutral name like submission-007.pdf
create policy "pdfs: editor uploads neutral names"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and public.is_editor()
    and name ~ '^submission-[0-9]+\.pdf$'
  );

-- Reading follows the same rules as the submissions table.
create policy "pdfs: read by role"
  on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and public.can_read_pdf(name));

create policy "pdfs: editor can delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'submissions' and public.is_editor());
