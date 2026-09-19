# The Patriot Review

A small private website for our editorial team to read submissions **blind** (no names, no grades) and vote on them.

- **Reviewers** (8 people) read a PDF and vote 👍 or 👎. Once, no changes.
- **Chloe / Mrs. Stafford** (one shared account) make the final ACCEPT / REJECT call on submissions that passed. Still blind.
- **Elijah** (Senior Editor) uploads submissions, enters author + grade, and sees everything.

Built with plain JavaScript + [Vite](https://vite.dev), hosted on GitHub Pages. **Supabase** does everything on the back end: sign-in, database, PDF storage, and security. There is no custom server.

```
supabase/schema.sql   ← creates tables, security rules, voting rule, PDF storage (run once)
supabase/roles.sql    ← tells the database who is the editor / final reviewer / reviewer
supabase/reset.sql    ← only if you want to wipe the database and start over
src/                  ← the website
.github/workflows/    ← publishes the site to GitHub Pages automatically
```

---

## Setup (about 20 minutes, one time)

### 1. Create the Supabase project

1. Go to <https://supabase.com>, sign in, and click **New project**.
2. Name it `patriot-review`, choose a strong **database password** (save it in a password manager; you won't need it day-to-day), pick the region closest to you, and click **Create new project**. Wait a minute or two while it sets up.

### 2 & 3. Create the tables (run the SQL)

1. In the Supabase dashboard, open **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this project, copy **everything**, paste it in, and click **Run**.
3. You should see "Success. No rows returned." If you see an error saying something "already exists", the file was already run; use `supabase/reset.sql` first if you want a clean start.

This creates the tables (`profiles`, `submissions`, `submission_authors`, `submission_status`, `votes`), all the Row Level Security rules, the voting/passing rule, and the PDF storage bucket.

> **Why the author is in a separate table:** Row Level Security decides which *rows* a person can read, not which *columns*. So the author's name and grade live in `submission_authors`, and only Elijah's account is allowed to read that table at all. Reviewers can't fetch it, even if they poke at the site with developer tools.

### 4. Check PDF storage

`schema.sql` already created the bucket. Just confirm it:

1. Open **Storage** in the dashboard. You should see a bucket called **`submissions`** with a lock icon (**Private**). Don't make it public.
2. Nothing else to do. The security rules for it are already in place: only Elijah can upload, and files are stored as `submission-001.pdf`, `submission-002.pdf`, etc. (never the original filename).

### 5. Configure authentication

1. Open **Authentication** → **Sign In / Providers** (on older dashboards: Authentication → Settings).
2. Make sure **Email** is enabled.
3. **Turn OFF "Allow new users to sign up."** This is important: it means nobody can create their own account. Only the 10 accounts you create below can ever sign in.

(Supabase moves menu items around now and then. If you can't find a setting, use the search box in the dashboard.)

### 6. Create the locked Elijah account

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email: `elijah@patriotreview.example`
3. Password: **choose a strong password that only Elijah knows.** Save it in a password manager. Do not share it.
4. Check **Auto Confirm User**, then **Create user**.

(The email doesn't have to be real. Nobody is ever emailed. It's just the account's ID. If Supabase refuses the `.example` domain, use any other domain, e.g. `patriotreview.school`, and see the note under step 8.)

### 7. Create the locked Chloe / Mrs. Stafford account

Same thing:

1. **Add user** → **Create new user**.
2. Email: `chloe@patriotreview.example`
3. Password: **a different strong password** that only Chloe and Mrs. Stafford know.
4. Check **Auto Confirm User**, then **Create user**.

These two accounts can't be entered by just clicking a name. The site asks for the password and Supabase checks it. The passwords are never in the code.

**To change either password later**, run this in the SQL Editor (edit the email and password first):

```sql
update auth.users
set encrypted_password = extensions.crypt('NEW-PASSWORD-HERE', extensions.gen_salt('bf'))
where email = 'elijah@patriotreview.example';
```

### 8. Assign roles

Now create the **eight regular reviewers** the same way (see step 9), then:

1. **SQL Editor** → **New query**.
2. Paste in all of `supabase/roles.sql` and click **Run**.
3. The result table at the bottom should list **10 people**: 1 `editor` (Elijah), 1 `final_reviewer` (Chloe / Mrs. Stafford), and 8 `reviewer`.

> If you used a different email domain than `patriotreview.example`, edit it on the line near the top of `roles.sql` **and** set `VITE_EMAIL_DOMAIN` in step 10. They must match.

### 9. Add the regular reviewers

The eight regular reviewers **share one team password**. They pick their name, type the team password, and they're in. (See "About the reviewer password" below for why there's a password at all.)

Create eight users the same way as steps 6–7 (Auto Confirm User checked), all with the **same** team password:

| Name | Email |
|---|---|
| Isabella | `isabella@patriotreview.example` |
| Jack | `jack@patriotreview.example` |
| Josie | `josie@patriotreview.example` |
| Lina | `lina@patriotreview.example` |
| Lucy | `lucy@patriotreview.example` |
| Lydia | `lydia@patriotreview.example` |
| Nathan | `nathan@patriotreview.example` |
| Sophia | `sophia@patriotreview.example` |

Then run `roles.sql` (step 8). Each reviewer has their own account, so the database always knows exactly who cast each vote.

**To change the team password later** (for example if someone leaves), run:

```sql
update auth.users
set encrypted_password = extensions.crypt('NEW-TEAM-PASSWORD', extensions.gen_salt('bf'))
where lower(email) in (
  'isabella@patriotreview.example','jack@patriotreview.example','josie@patriotreview.example',
  'lina@patriotreview.example','lucy@patriotreview.example','lydia@patriotreview.example',
  'nathan@patriotreview.example','sophia@patriotreview.example');
```

**Removing or replacing a reviewer:** in the SQL Editor, `update public.profiles set active = false where display_name = 'Jack';`. The passing rule then waits only for the remaining active reviewers. (Adding a new person means a new Supabase user, a new line in `roles.sql`, and a new line in `src/roster.js`.)

### 10. Add the Supabase environment variables

1. In Supabase, open **Project Settings** → **API** (or **API Keys**).
2. Copy the **Project URL**, and the **anon** / **publishable** key.
3. In this project, copy `.env.example` to a new file named `.env` and fill it in:

   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...your anon key...
   ```

**Never use the `service_role` / secret key.** It skips all security. The site refuses to start if it sees one. (The anon/publishable key is designed to be visible in a website; the *database rules* are what protect the data.) `.env` is already in `.gitignore`, so it won't be uploaded.

### 11. Run the site on your computer

You need [Node.js](https://nodejs.org) (version 20 or newer).

```bash
npm install
npm run dev
```

Open the address it prints (usually <http://localhost:5173>). Sign in as Elijah, click **+ ADD SUBMISSION**, and upload a test PDF. Then sign in as a reviewer in another browser (or a private window) to see it.

### 12. Put it on GitHub Pages

1. Create a new repository on GitHub and upload this project to it (the `main` branch). `.env` is not uploaded; that's correct.
2. In the repo: **Settings** → **Pages** → under **Build and deployment**, set **Source** to **GitHub Actions**.
3. In the repo: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add two secrets:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon/publishable key

   (If you used a different email domain, also add a **Variable** on the *Variables* tab named `VITE_EMAIL_DOMAIN`.)
4. Push to `main` (or open the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow**). After about a minute your site is live at `https://YOUR-NAME.github.io/YOUR-REPO/`.

The repository can be public. It contains no author names, no PDFs, and no passwords. (GitHub Pages on a *private* repo needs a paid GitHub plan.) The site's address is public, but nobody can read anything without signing in.

---

## About the reviewer password

The brief said reviewers should just pick their name. The catch: if there's no password at all, anyone who finds the web address could pick a name, read every submission, and cast votes. Since the submissions are students' unpublished work, I added one shared **team password** for the eight reviewers. They still just pick a name and enter, and their browser remembers them until they click **Sign out**.

If you'd rather give everyone their own password, set a different password for each user in Supabase. Nothing in the site needs to change.

---

## Who can see what (enforced by the database)

| | Reviewer | Chloe / Mrs. Stafford | Elijah |
|---|---|---|---|
| Submission numbers + PDFs | all | only ones that **passed** | all |
| Author name + grade | ❌ | ❌ | ✅ |
| Other people's votes | ❌ (only sees whether *they* voted) | ❌ | ✅ |
| Vote totals / pass or cut | ❌ | ❌ | ✅ |
| Cast a vote | ✅ once per submission, permanent | ❌ | ❌ |
| ACCEPT / REJECT | ❌ | ✅ once per passed submission | ❌ |
| Upload submissions | ❌ | ❌ | ✅ |

**The passing rule:** after every vote the database checks whether all active reviewers have voted. Only then does it decide: 50% YES or more passes (8/8 down to 4/8), 3/8 or fewer is cut. Passing early never happens, even at 7 votes with 4 YES.

**One thing the site can't control: what's *inside* the PDF.** The site never shows the original filename and stores each PDF as `submission-###.pdf`. But if a student's name is typed on the page, or is in the PDF's hidden "Author" property, reviewers could see it. Before uploading, remove names from the pages and clear the document properties (in most PDF tools: File → Properties → Author).

---

## Fixing mistakes

- **A wrong upload:** Table Editor → `submissions` → delete that row (this also deletes its author, status, and votes). Then Storage → `submissions` → delete the matching PDF. The next upload will reuse the number if it was the latest one.
- **A vote cast by mistake:** votes are locked so reviewers can't change them. As the project owner you can delete the row in Table Editor → `votes`. If that submission had already been marked passed/cut, also set its row in `submission_status` back to `pending` (and clear `final_decision`).
- **Someone locked out:** reset their password with the SQL in steps 7 and 9.

---

## Security checklist (what's enforced, and where)

| Requirement | How |
|---|---|
| Reviewers can't see author name/grade | `submission_authors` has a rule allowing **only the editor** to read it |
| Chloe / Mrs. Stafford can't see author name/grade | Same table, same rule |
| Reviewers can't see others' votes | `votes` rule: a reviewer sees only rows where `reviewer_id` is themselves |
| Chloe / Mrs. Stafford can't see votes | `votes` rule: only the editor (and each reviewer, own rows) |
| Elijah sees everything | Editor role is allowed on every table and every PDF |
| One vote each, no changes | `UNIQUE (submission_id, reviewer_id)`; no update or delete permission exists; a database trigger also blocks edits from the dashboard |
| Can't vote as someone else | Insert rule requires `reviewer_id = the signed-in user` |
| Nothing goes to Chloe early | Status stays `pending` until every active reviewer has voted; her list shows only `passed` |
| 50% passes, less is cut | `yes × 2 ≥ votes cast` in the `finalize_review` trigger |
| Filenames don't leak names | The database generates `submission-###.pdf`; the upload rule rejects any other filename |
| Changing the URL doesn't unlock anything | The website's page choices are only cosmetic. Every read and write is checked by the database |
| No secrets in the code | Only the public anon key is used, via environment variables; the site refuses a `service_role` key |
| Nobody can self-register | Sign-ups are turned off (step 5), and an account without a profile row can read nothing |
