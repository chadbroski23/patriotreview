# The Patriot Review

A deliberately simple, private, blind-review site for a school writing journal. It uses Vite on the front end and Supabase for authentication, data, PDF storage, and database-enforced permissions.

## Current workflow

1. Elijah uploads a PDF, author, grade, and exactly one genre: **Fiction**, **Poetry**, **Nonfic/Editorial**, or **Devos**.
2. Reviewers browse blind submissions by genre and cast a YES or NO vote. They can change their own current vote.
3. Elijah sees reviewer progress and the current YES percentage. Above/below 50% is information only; it never changes the workflow.
4. Only Elijah can send a submission to Chloe / Mrs. Stafford.
5. Chloe can browse all non-withdrawn submissions blind, with a separate Final Review section for work Elijah sent. Only that section has ACCEPT/REJECT controls.

Elijah can also edit metadata, replace a PDF, withdraw/restore work, remove it from final review, reset a final decision, and reset individual or all votes. These are database-authorized actions, not merely hidden buttons.

## Security model

| Capability | Reviewers | Chloe / Mrs. Stafford | Elijah |
|---|---:|---:|---:|
| Read blind PDFs and genre | Yes | Yes, all submissions | Yes |
| Read author / grade | No | No | Yes |
| See vote progress, totals, or identities | No | No | Yes |
| Change own vote | Yes | — | — |
| Final ACCEPT / REJECT | — | Sent work only | — |
| Manage submission workflow | No | No | Yes |

Author identity lives in a separate editor-only table. RLS prevents reviewers and Chloe from querying author data, votes, or editor controls even if they alter the front end or call Supabase directly. PDFs are private and use neutral filenames only.

## Supabase setup

1. Create a Supabase project and enable Email authentication.
2. Turn **off** public sign-ups in Authentication settings.
3. In SQL Editor, run `supabase/schema.sql` once on a fresh project.
4. **Then run `supabase/migrations/20260919_editor_controlled_workflow.sql`.** Run this migration on existing projects too. It changes permanent votes and automatic passing to the editor-controlled workflow above.
5. Create the ten accounts below in Authentication → Users using **Create new user** and **Auto Confirm User**. Do not put passwords in the repository.

| Account | Email | Role |
|---|---|---|
| Elijah | `elijah@patriotreview.example` | editor |
| Chloe / Mrs. Stafford | `chloe@patriotreview.example` | final reviewer |
| Isabella, Jack, Josie, Lina, Lucy, Lydia, Nathan, Sophia | `<name>@patriotreview.example` | reviewer |

Use strong, unique passwords for Elijah and Chloe. Reviewers may share a team password, but each must have their own Supabase account so the database can enforce one current vote per person.

6. Run `supabase/roles.sql` after creating all ten accounts. If you use a different email domain, update both `roles.sql` and `VITE_EMAIL_DOMAIN`.
7. Confirm Storage contains a private `submissions` bucket. The schema creates it and the policies; do not make it public.

## Environment variables

Copy `.env.example` to `.env` and fill it in with the Supabase project URL, anon/publishable key, and the email domain. Use only the anon/publishable key; never use a service-role or secret key in a website. `.env` is ignored by Git.

> Important: this update removes the previously committed `.env` file. If its Supabase key was real, rotate that key in Supabase now, then save the replacement only in local `.env` and GitHub Actions secrets.

## Run locally

```bash
npm install
npm run dev
```

To test permissions, use separate browser profiles or private windows: Elijah should see names, grades, votes and controls; reviewers should only see their own vote and genre; Chloe should never see identities or vote data.

## Deploy to GitHub Pages

In GitHub repository Settings, set Pages to deploy with **GitHub Actions**, then add Actions secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Add `VITE_EMAIL_DOMAIN` as an Actions variable if you changed it.

The project contains no PDFs, author identities, or passwords. Before uploading any PDF, remove author names from its pages and PDF metadata—the database cannot conceal identity information embedded inside the document itself.
