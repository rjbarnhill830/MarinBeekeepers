# Marin Hive Tracker

A shared hive-records site for club members. Each member logs their own apiaries, hives,
inspections, **mite counts**, treatments, feedings and harvests from a phone or computer.
The club gets combined statistics without anyone's hive locations or names being shared.

- **Members** see and edit their own records, and can opt in to let other members view their hives.
- **Club admins** approve new members and can view (but not change) everyone's hives on the **Club hives** page.
- **Club stats** shows totals for every member: active hives, honey harvested, colonies lost,
  hives by town and type, and the club's average mite load by month against the 3-per-100
  treatment threshold.
- **Reminders** on each hive: inspection due, mite check due, mites over threshold,
  no queen/eggs seen, queen cells, treatment in progress.
- **Export**: members can download their records as CSV spreadsheets.
- **Membership dues**: admins set each member's **Paid through** date on the **Members** page.
  Members see their status (Active, Renewal due, Expired) on the **Account** page, plus a reminder
  on **My hives** starting 30 days before it runs out. Only admins can change the date.
- **Donate / renew links**: set `DONATE_URL` and `RENEW_URL` in [`js/config.js`](js/config.js).
  The donate link appears at the bottom of every page and on the Account page. Leave either one
  empty to hide it.
- **Weather**: inspections record the time of day, and the temperature, conditions, wind and
  humidity fill in automatically from [Open-Meteo](https://open-meteo.com). It's free for
  non-commercial use and needs no API key or setup. Weather is looked up by the apiary's
  **town** (or central Marin if no town is set), so exact locations are never sent anywhere.
  Members can edit the values or type their own.

It's a static website (plain HTML/CSS/JavaScript, no build step) backed by
[Supabase](https://supabase.com), which provides the database and member logins.

## One-time setup (about 20 minutes)

### 1. Create the Supabase project
1. Sign up at [supabase.com](https://supabase.com) (ideally with a shared club email so
   it isn't tied to one volunteer) and create a **new project**. The free plan is enough.
2. In the project, open **SQL Editor → New query**, paste the whole of
   [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. (After that, set up
   [automatic database updates](#automatic-database-updates) so later changes apply themselves.)
3. Open **Project Settings → API** (or **API Keys**) and copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **anon / publishable** key (never the `service_role` / secret key)
4. Put both into [`js/config.js`](js/config.js) and commit. The anon key is meant to be public;
   the database's row-level security rules are what protect members' data.

### 2. Publish the site with GitHub Pages
1. In this GitHub repo: **Settings → Pages → Build and deployment → Deploy from a branch**,
   choose `main` and `/ (root)`, and save.
2. After a minute the site is live at `https://rjbarnhill830.github.io/MarinBeekeepers/`.

### 3. Tell Supabase where the site lives
In Supabase, open **Authentication → URL Configuration**:
- **Site URL**: `https://rjbarnhill830.github.io/MarinBeekeepers/`
- **Redirect URLs**: add the same URL.

Without this, the links in sign-up confirmation and password-reset emails point to the wrong place.

### 4. Make yourself the first admin
1. Open the site and create an account. You'll see the "waiting for approval" screen.
2. In Supabase **SQL Editor**, run (with your email):
   ```sql
   update public.profiles set role = 'admin', approved = true
   where email = 'you@example.com';
   ```
3. Click **Check again** on the site. You'll now see a **Members** tab where you can approve
   other members and make other people admins. You won't need SQL again.

### 5. Link it from the club website
Add a link to the site URL on the Marin Beekeepers webpage, e.g. "Marin Hive Tracker (member hive records)".
New members sign up there, and an admin approves them from the **Members** tab.

## Automatic database updates
A GitHub Action ([`.github/workflows/update-database.yml`](.github/workflows/update-database.yml))
runs `supabase/schema.sql` against Supabase every time that file changes on `main`, so you never
need to copy and paste it. It runs as a single transaction: if anything fails, nothing changes
and the run shows a red ✗ on the repo's **Actions** tab with the error.

One-time setup:
1. **Get the connection string.** In Supabase, click **Connect** at the top of the project.
   Under **Session pooler**, copy the URI. It looks like
   `postgresql://postgres.qjffbgmcdyemieutxaae:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:5432/postgres`.
   Use the session pooler, not the "Direct connection": GitHub's servers can't reach the direct one.
2. **Put in your database password** in place of `[YOUR-PASSWORD]`, without the brackets. This is
   the password you chose when creating the project, not your Supabase login. If you don't
   know it, reset it under **Project Settings → Database**. If the password contains `@`, `:`,
   `/` or `#`, reset it to one with only letters and numbers to avoid connection-string problems.
3. **Save it as a GitHub secret.** In this repo: **Settings → Secrets and variables → Actions →
   New repository secret**. Name: `SUPABASE_DB_URL`. Secret: the full connection string.
4. **Test it.** Go to **Actions → Update database → Run workflow**. A green ✓ after a minute
   means it's connected and the database is up to date.

Keep this secret private. It gives full access to the database, so never paste it anywhere else
(including chats). GitHub keeps it encrypted and never shows it in logs.

## Things to know about the free Supabase plan
- **Emails**: Supabase's built-in email sender is rate-limited and meant for light use.
  If lots of members sign up at once (say, after a meeting), confirmation emails may be delayed.
  To fix this, connect the club's own email service under
  **Authentication → Emails → SMTP Settings**. Alternatively, turn off "Confirm email" under
  **Authentication → Sign In / Providers → Email**; admin approval still gates access.
- **Pausing**: free projects pause after about a week with no activity. Regular club use
  keeps it awake. If it does pause, click **Restore** in the Supabase dashboard; no data is lost.
- **Backups**: the free plan doesn't include downloadable backups. Members can export their
  own CSVs from the **Account** page, and an admin can export tables from the Supabase
  **Table Editor**.

## How the privacy rules work
All rules live in the database ([`supabase/schema.sql`](supabase/schema.sql)), so they hold
no matter what the website code does:
- New accounts are **pending** and can't read or write anything until approved.
- Only admins can change someone's approval or admin status. Members can't approve themselves.
- Every apiary, hive and record belongs to one member, and only that member can add, edit or delete it.
- **Sharing is opt-in.** A member can tick "Let other members view my hives and records" on the
  **Account** page. Their hives then appear on **Club hives** for other approved members, view-only,
  with the town but never the apiary's name, location or notes. Unticking hides them again right away.
- Admins can view every member's hives on **Club hives** (to help members and answer club
  questions), marked "not shared" where the member hasn't opted in. Admins can't edit them.
- The **Club stats** page uses one database function, `club_stats()`, that returns only totals.

## Changing things
- **Club name, Supabase keys, donate and renewal links**: [`js/config.js`](js/config.js)
- **Form fields, treatment and feed suggestions, mite thresholds, reminder timing (incl. dues reminder)**:
  [`js/records.js`](js/records.js)
- **Pages and behaviour**: [`js/app.js`](js/app.js)
- **Colours and layout**: [`css/styles.css`](css/styles.css)
- **Database changes**: edit `supabase/schema.sql`. Once automatic updates are set up (below),
  pushing it to `main` applies it to Supabase. The file is safe to re-run and never deletes data.
  To add a field to an existing table, add an `alter table ... add column if not exists ...` line
  near the other ones in `schema.sql`, then add the field to `js/records.js`.

To preview locally, serve the folder with any static server (for example
`npx http-server .`) and open it in a browser. ES modules don't load from `file://` URLs.
