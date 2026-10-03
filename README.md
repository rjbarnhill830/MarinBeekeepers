# Marin Hive Tracker

A shared hive-records site for club members. Each member logs their own apiaries, hives,
inspections, **mite counts**, treatments, feedings and harvests from a phone or computer.
The club gets combined statistics without anyone's hive locations or names being shared.

- **Members** see and edit only their own records.
- **Club admins** approve new members and can view (but not change) everyone's records.
- **Club page** shows totals for every member: active hives, honey harvested, colonies lost,
  hives by town and type, and the club's average mite load by month against the 3-per-100
  treatment threshold.
- **Reminders** on each hive: inspection due, mite check due, mites over threshold,
  no queen/eggs seen, queen cells, treatment in progress.
- **Export**: members can download their records as CSV spreadsheets.

It's a static website (plain HTML/CSS/JavaScript, no build step) backed by
[Supabase](https://supabase.com), which provides the database and member logins.

## One-time setup (about 20 minutes)

### 1. Create the Supabase project
1. Sign up at [supabase.com](https://supabase.com) (ideally with a shared club email so
   it isn't tied to one volunteer) and create a **new project**. The free plan is enough.
2. In the project, open **SQL Editor → New query**, paste the whole of
   [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
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
- Every apiary, hive and record belongs to one member. Others can't see, attach records to,
  edit or delete it.
- Admins can read all records (to help members and answer club questions) but can't edit them.
- The Club page uses one database function, `club_stats()`, that returns only totals.

## Changing things
- **Club name / Supabase keys**: [`js/config.js`](js/config.js)
- **Form fields, treatment and feed suggestions, mite thresholds, reminder timing**:
  [`js/records.js`](js/records.js)
- **Pages and behaviour**: [`js/app.js`](js/app.js)
- **Colours and layout**: [`css/styles.css`](css/styles.css)
- **Database changes**: `supabase/schema.sql` is safe to re-run; it never deletes data. It
  won't add columns to tables that already exist, though. To add a field, run
  `alter table public.inspections add column if not exists weather text;` (for example) in the
  SQL Editor, add the same line to `schema.sql`, and add the field to `js/records.js`.

To preview locally, serve the folder with any static server (for example
`npx http-server .`) and open it in a browser. ES modules don't load from `file://` URLs.
