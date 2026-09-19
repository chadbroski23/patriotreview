-- DANGER: deletes all Patriot Review data (submissions, votes, profiles) and its PDF security rules.
-- Only use this if you want to start over. Then run schema.sql again.
-- (PDF files themselves are not deleted; remove them in Storage if you want.)

drop policy if exists "pdfs: editor uploads neutral names" on storage.objects;
drop policy if exists "pdfs: read by role"                 on storage.objects;
drop policy if exists "pdfs: editor can delete"            on storage.objects;

drop table if exists public.votes, public.submission_status,
                     public.submission_authors, public.submissions, public.profiles cascade;

drop function if exists public.finalize_review(), public.block_vote_changes(),
  public.create_submission(text, text), public.record_final_decision(uuid, public.final_state),
  public.can_read_pdf(text), public.is_passed(uuid), public.is_final_reviewer(),
  public.is_reviewer(), public.is_editor(), public.my_role();

drop type if exists public.final_state, public.review_state, public.user_role;
