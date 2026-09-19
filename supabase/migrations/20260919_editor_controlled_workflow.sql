-- Patriot Review: editor-controlled workflow migration
-- Run this once in Supabase SQL Editor on an existing Patriot Review project.
-- It is safe to re-run. New projects should run schema.sql first, then this file.

do $$ begin
  create type public.submission_genre as enum ('Fiction', 'Poetry', 'Nonfic/Editorial', 'Devos');
exception when duplicate_object then null; end $$;

alter table public.submissions
  add column if not exists genre public.submission_genre,
  add column if not exists withdrawn_at timestamptz;
update public.submissions set genre = 'Fiction' where genre is null;
alter table public.submissions alter column genre set not null;

alter table public.submission_status
  add column if not exists sent_to_final_at timestamptz;

-- 50% is now only a number for the editor. Remove the automatic workflow trigger.
drop trigger if exists votes_finalize_review on public.votes;
drop function if exists public.finalize_review();
drop trigger if exists votes_are_permanent on public.votes;
drop function if exists public.block_vote_changes();

-- Reviewers may update only their own existing vote. They still cannot create
-- a second row because the unique (submission_id, reviewer_id) constraint remains.
grant update (vote) on public.votes to authenticated;
drop policy if exists "votes: reviewers change own vote" on public.votes;
create policy "votes: reviewers change own vote"
  on public.votes for update to authenticated
  using (public.is_reviewer() and reviewer_id = auth.uid())
  with check (public.is_reviewer() and reviewer_id = auth.uid());

create or replace function public.is_active_submission(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.submissions where id = p_submission_id and withdrawn_at is null) $$;

-- Rebuild read policies. Withdrawn work stays in the database for Elijah but
-- disappears from the normal blind-review workflow.
drop policy if exists "submissions: read by role" on public.submissions;
create policy "submissions: read by role"
  on public.submissions for select to authenticated
  using (public.is_editor() or ((public.is_reviewer() or public.is_final_reviewer()) and withdrawn_at is null));

drop policy if exists "status: editor or final reviewer (passed only)" on public.submission_status;
create policy "status: editor or final reviewer"
  on public.submission_status for select to authenticated
  using (public.is_editor() or (public.is_final_reviewer() and public.is_active_submission(submission_id)));

drop policy if exists "pdfs: read by role" on storage.objects;
create or replace function public.can_read_pdf(p_object_name text)
returns boolean language sql stable security definer set search_path = public
as $$
  select case public.my_role()
    when 'editor' then true
    when 'reviewer' then exists (select 1 from public.submissions where storage_path = p_object_name and withdrawn_at is null)
    when 'final_reviewer' then exists (select 1 from public.submissions where storage_path = p_object_name and withdrawn_at is null)
    else false
  end
$$;
create policy "pdfs: read by role" on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and public.can_read_pdf(name));
drop policy if exists "pdfs: editor replaces" on storage.objects;
create policy "pdfs: editor replaces" on storage.objects for update to authenticated
  using (bucket_id = 'submissions' and public.is_editor())
  with check (bucket_id = 'submissions' and public.is_editor() and name ~ '^submission-[0-9]+\\.pdf$');

-- A reviewer may never cast a vote for a withdrawn submission.
drop policy if exists "votes: reviewers vote as themselves" on public.votes;
create policy "votes: reviewers vote as themselves"
  on public.votes for insert to authenticated
  with check (public.is_reviewer() and reviewer_id = auth.uid() and public.is_active_submission(submission_id));

-- New submissions include one of the four fixed genres.
drop function if exists public.create_submission(text, text);
create or replace function public.create_submission(p_author_name text, p_author_grade text, p_genre public.submission_genre)
returns table (new_id uuid, new_number integer, new_path text)
language plpgsql security definer set search_path = public
as $$
declare n integer; sid uuid; p text;
begin
  if not public.is_editor() then raise exception 'Only the editor can add submissions.'; end if;
  if btrim(coalesce(p_author_name, '')) = '' or btrim(coalesce(p_author_grade, '')) = '' or p_genre is null then
    raise exception 'Author name, grade, and genre are required.';
  end if;
  perform pg_advisory_xact_lock(7001);
  select coalesce(max(submission_number), 0) + 1 into n from public.submissions;
  p := 'submission-' || case when n < 1000 then lpad(n::text, 3, '0') else n::text end || '.pdf';
  insert into public.submissions (submission_number, storage_path, genre) values (n, p, p_genre) returning id into sid;
  insert into public.submission_authors (submission_id, author_name, author_grade) values (sid, btrim(p_author_name), btrim(p_author_grade));
  insert into public.submission_status (submission_id) values (sid);
  return query select sid, n, p;
end $$;

create or replace function public.update_submission_details(p_submission_id uuid, p_author_name text, p_author_grade text, p_genre public.submission_genre)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if not public.is_editor() then raise exception 'Only the editor can edit submissions.'; end if;
  if btrim(coalesce(p_author_name, '')) = '' or btrim(coalesce(p_author_grade, '')) = '' or p_genre is null then raise exception 'All fields are required.'; end if;
  update public.submission_authors set author_name = btrim(p_author_name), author_grade = btrim(p_author_grade) where submission_id = p_submission_id;
  update public.submissions set genre = p_genre where id = p_submission_id;
  if not found then raise exception 'Submission not found.'; end if;
end $$;

create or replace function public.set_submission_withdrawn(p_submission_id uuid, p_withdrawn boolean)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if not public.is_editor() then raise exception 'Only the editor can withdraw or restore submissions.'; end if;
  update public.submissions set withdrawn_at = case when p_withdrawn then coalesce(withdrawn_at, now()) else null end where id = p_submission_id;
  if not found then raise exception 'Submission not found.'; end if;
end $$;

create or replace function public.send_to_final_review(p_submission_id uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if not public.is_editor() then raise exception 'Only the editor can send submissions to final review.'; end if;
  update public.submission_status st set sent_to_final_at = coalesce(sent_to_final_at, now()), review_status = 'passed'
    where st.submission_id = p_submission_id and public.is_active_submission(p_submission_id);
  if not found then raise exception 'This submission is withdrawn or does not exist.'; end if;
end $$;

create or replace function public.remove_from_final_review(p_submission_id uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if not public.is_editor() then raise exception 'Only the editor can manage final review.'; end if;
  update public.submission_status set sent_to_final_at = null, review_status = 'pending', final_decision = null, final_decided_at = null where submission_id = p_submission_id;
  if not found then raise exception 'Submission not found.'; end if;
end $$;

create or replace function public.reset_final_decision(p_submission_id uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if not public.is_editor() then raise exception 'Only the editor can reset a final decision.'; end if;
  update public.submission_status set final_decision = null, final_decided_at = null where submission_id = p_submission_id and sent_to_final_at is not null;
  if not found then raise exception 'This submission is not in final review.'; end if;
end $$;

create or replace function public.reset_submission_votes(p_submission_id uuid, p_reviewer_id uuid default null)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if not public.is_editor() then raise exception 'Only the editor can reset votes.'; end if;
  delete from public.votes where submission_id = p_submission_id and (p_reviewer_id is null or reviewer_id = p_reviewer_id);
end $$;

create or replace function public.record_final_decision(p_submission_id uuid, p_decision public.final_state)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if not public.is_final_reviewer() then raise exception 'Only the final reviewer can record a decision.'; end if;
  update public.submission_status set final_decision = p_decision, final_decided_at = now()
    where submission_id = p_submission_id and sent_to_final_at is not null and final_decision is null and public.is_active_submission(p_submission_id);
  if not found then raise exception 'This submission is not awaiting final review.'; end if;
end $$;

revoke execute on function public.is_active_submission(uuid), public.create_submission(text, text, public.submission_genre), public.update_submission_details(uuid, text, text, public.submission_genre), public.set_submission_withdrawn(uuid, boolean), public.send_to_final_review(uuid), public.remove_from_final_review(uuid), public.reset_final_decision(uuid), public.reset_submission_votes(uuid, uuid) from public, anon;
grant execute on function public.is_active_submission(uuid), public.create_submission(text, text, public.submission_genre), public.update_submission_details(uuid, text, text, public.submission_genre), public.set_submission_withdrawn(uuid, boolean), public.send_to_final_review(uuid), public.remove_from_final_review(uuid), public.reset_final_decision(uuid), public.reset_submission_votes(uuid, uuid), public.record_final_decision(uuid, public.final_state) to authenticated;
