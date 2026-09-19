-- =====================================================================
-- THE PATRIOT REVIEW — assign roles to the 10 accounts
-- Run AFTER you have created the 10 users in Supabase > Authentication > Users
-- (see README, step 6). Safe to run again any time.
-- =====================================================================

-- If you use a different email domain than patriotreview.example, change it on
-- the next line AND in your .env file (VITE_EMAIL_DOMAIN). They must match.
with cfg as (select 'patriotreview.example'::text as domain)
insert into public.profiles (id, display_name, role)
select u.id, r.display_name, r.role::public.user_role
from (values
  ('chloe',    'Chloe / Mrs. Stafford', 'final_reviewer'),
  ('elijah',   'Elijah',                'editor'),
  ('isabella', 'Isabella',              'reviewer'),
  ('jack',     'Jack',                  'reviewer'),
  ('josie',    'Josie',                 'reviewer'),
  ('lina',     'Lina',                  'reviewer'),
  ('lucy',     'Lucy',                  'reviewer'),
  ('lydia',    'Lydia',                 'reviewer'),
  ('nathan',   'Nathan',                'reviewer'),
  ('sophia',   'Sophia',                'reviewer')
) as r(login, display_name, role)
cross join cfg
join auth.users u on lower(u.email) = r.login || '@' || cfg.domain
on conflict (id) do update
  set display_name = excluded.display_name,
      role         = excluded.role,
      active       = true;

-- Check: you should see exactly 10 rows (1 editor, 1 final_reviewer, 8 reviewer).
select display_name, role, active from public.profiles order by role, display_name;
