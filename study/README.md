# DTM diffusion-model evaluation study

A blind, human-subjects web experiment: participants see 48 images (24
real, 24 split evenly across four diffusion-model checkpoints) and judge
each as real, AI-generated, or not sure. See `../supabase/schema.sql`
and `../supabase/functions/` for the backend.

## One-time setup

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project. Free tier is fine.
2. Dashboard → SQL Editor → New query → paste the contents of
   `../supabase/schema.sql` → Run.
3. Dashboard → Project Settings → API → copy the **Project URL** and the
   **publishable** key (older projects call this the anon/public key)
   into `study/content.js`:
   ```js
   SUPABASE_URL: "https://xxxxxxxx.supabase.co",
   SUPABASE_ANON_KEY: "sb_publishable_...",
   ```
   This key is *meant* to be public — it ships in the page source. It
   can only reach the Edge Functions below, nothing else (see
   "Why this isn't a client-side manifest" below). Never put the
   **secret** key (`sb_secret_...`, or `service_role` on older projects)
   anywhere under `study/` — it belongs only in `scripts/.env` and in
   Supabase's own Edge Function environment (injected automatically,
   see step 2).

   *This project's values are already filled in `study/content.js` and
   `scripts/.env`. Step 2 (deploying the schema + functions) is still
   pending — see below.*

### 2. Deploy the Edge Functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then
from the repo root:
```bash
supabase login
supabase link --project-ref xxxxxxxx        # the ref from your project URL
supabase functions deploy start-session
supabase functions deploy resume-session
supabase functions deploy submit-response
supabase functions deploy admin-data
supabase functions deploy admin-export
```
No secrets to configure — `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
are injected automatically into every function's environment by Supabase.

### 3. Create your admin login

Dashboard → Authentication → Users → Add user — use andrew.ibrahim@tum.de
and a password of your choice (this is what you'll use to sign in to
`admin.html`). Then in the SQL Editor:
```sql
insert into admin_users (user_id)
select id from auth.users where email = 'andrew.ibrahim@tum.de';
```
Add more rows the same way for anyone else who should have access.

### 4. Enable GitHub Pages

Repo Settings → Pages → Build and deployment → **Source: GitHub Actions**.
The workflow at `.github/workflows/deploy-study-pages.yml` publishes
`study/` on every push to `main` that touches it. First push after
enabling this will trigger the initial deploy.

## Changing the intro text

Everything a participant reads before starting is in
[`study/content.js`](content.js) — `heading`, `intro_paragraphs` (one
paragraph per array entry), `start_button`, and the completion-page text.
Nothing else in the codebase needs to change; edit that file, commit,
push, done.

## Adding or removing images

There's no fixed list of pool names — any folder you create under
`study/source-images/<name>/` becomes a usable pool, `<name>` and all.
Drop image files (`.jpg`/`.jpeg`/`.png`/`.webp`) in there, e.g.:
```
study/source-images/real/
study/source-images/checkpoint1/
study/source-images/BaseModel1.5/
study/source-images/anything-you-want/
```
Then run, from the repo root:
```bash
cp scripts/.env.example scripts/.env   # first time only
# edit scripts/.env with your Project URL + secret key
python3 scripts/sync_images.py
```
This scans every folder under `source-images/`, copies each new file
into `study/images/pool/` under a content-hashed filename, and
registers it in the `images` table (new pools start active; commit the
new files under `study/images/pool/` and push). Removing a file and
re-running the script marks that one image inactive — already-collected
data referencing it is untouched, and it stops being drawn for new
participants. It never touches the `active` flag on images it already
knows about, so re-running it can't undo a pool-level decision made
with the script below.

## Choosing which AI pool(s) are actually shown

`real` is always active. Which non-real pool(s) participants currently
see is a separate, instant decision — nothing is deleted or moved:
```bash
python3 scripts/set_active_pools.py BaseModel1.5 BaseModel3.5
```
This flips `images.active` for every pool: `true` for the ones you
listed, `false` for every other pool that has ever been registered.
Past sessions and their responses are completely unaffected either way
— this only changes what `start-session` draws from for *new*
participants going forward. Run it again with a different set (or the
old checkpoint names) to switch back at any time.

Each participant always sees 24 real + 24 AI images, split into 3
balanced blocks of 16 trials (8 real + 8 AI each). The 8 AI slots per
block have to divide evenly across however many pools are active, so
the pool count must be **1, 2, 4, or 8** — e.g. 2 pools -> 4 each per
block, 12 each overall; 4 pools -> 2 each per block, 6 each overall (the
original checkpoint1-4 setup). Anything else (3, 5, 6, 7 pools) leaves
a fractional slot; the script refuses to set that up, and if it's ever
reached some other way, `start-session` fails with a clear error rather
than silently building an unbalanced sequence.

You need at least (24 / number of active pools) active images in each
active pool, and 24 active real images, before `start-session` can
build a full sequence — it returns a clear error naming the shortfall
if not.

The two intro-page examples are separate: replace
`study/images/examples/real-example.png` and `ai-example.png` directly
(same filenames, or update the paths in `content.js`). These are shown
openly labeled and are never part of the 48 trials, so they don't go
through the pipeline above.

## Threat model

- **Participants**: anonymous, no accounts. `participant_id` +
  `resume_code` together are the only credential — knowing both lets a
  request act as that participant. That's an accepted, deliberate
  trade-off for a study with no accounts and no PII (see Section 8 of
  the original spec); it is not appropriate if responses become
  sensitive later.
- **Everyone else**: the anon key ships in the page source and can only
  invoke the five Edge Functions — it cannot read or write any table
  directly (RLS is enabled on every table with no anon/authenticated
  policies at all). The `images` table, which holds ground truth, is
  reachable only from server-side code running with the service_role
  key.
- **Admin**: real Supabase Auth login, checked against `admin_users` on
  every call to `admin-data`/`admin-export`, not a decorative password
  field.

## Why this isn't a client-side manifest

The original spec sketch called for a JSON file like
`{"real": [...], "checkpoint1": [...]}` loaded by the browser to build
each participant's sequence. That would leak which pool an image came
from to anyone opening dev tools mid-trial — a real blinding failure,
not just a theoretical one, given Section 5's balancing requirement
means the sequence logic has to know each image's true type *before*
the participant answers. Sequence generation therefore happens in
`start-session` (Edge Function, service_role access to `images`); the
browser only ever receives `{trial_number, page, image_id, image_url}`
— never a label, grouping, or folder hint. Ground truth is stamped onto
each response server-side in `submit-response`, from the participant's
stored sequence, not from anything the client sends.

## Other decisions worth knowing about

- **Corrections keep history, not just the latest value.** Going back
  and changing an answer inserts a new row rather than overwriting; the
  `latest_responses` view (used by every export and by `admin-data`)
  resolves to the most recent one. `responses` itself is a full audit
  trail if you ever need it.
- **Response time is measured per page, not per image.** All 8 images
  on a page are visible at once, so `response_time_ms` is time-since-
  the-page-appeared at the moment that image's radio button was
  clicked, not a clean per-image reaction time. Treat it as a rough
  signal (e.g. "did they rush the whole page"), not a precise RT measure.
- **Image exposure is balanced via a running counter** (`images.times_shown`),
  not a fixed per-participant allocation table. With a large image pool
  this keeps exposure roughly even across ~50 participants without extra
  bookkeeping; with a small pool it'll still work but images will repeat
  more.
- **The participant-summary CSV exports counts, not derived statistics.**
  Accuracy, hit rate, false-alarm rate, and d′ are one formula away from
  the hit/miss/false-alarm/not-sure counts it gives you per participant
  per source — deliberately not baked in, so you're not stuck with a
  definition you didn't choose.

## Testing before real participants

1. Fill in `content.js`, run `sync_images.py` with a handful of test
   images per pool (6 real + 6 per checkpoint is the minimum to even
   start a session).
2. Serve `study/` locally, e.g. `python3 -m http.server 8000` from
   inside `study/`, then open `http://localhost:8000`.
3. Click "Start experiment," answer a few trials, note the resume code.
4. Close the tab entirely (not just refresh) and reopen
   `http://localhost:8000` — it should silently resume mid-sequence with
   your earlier answers still checked, not generate a new sequence. This
   works because the browser only stores the participant_id/resume_code
   pair locally; the sequence and all answers are re-fetched from
   `resume-session` each time, which is the authoritative source.
5. Also test the manual path: clear site data, load the page fresh,
   click "Already started? Resume with your code," and paste the code
   from step 3.
6. Finish all 48 trials and confirm the completion page shows before
   you'd expect any data loss — then check `admin.html` for the new row.
