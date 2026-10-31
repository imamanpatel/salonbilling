# Deploying Sabilling for free: Render + Supabase

No server to manage and no card needed. **Supabase** holds the database; **Render** runs the app from your
GitHub repo and rebuilds it by itself whenever new code is pushed. Plan about 45 minutes.

**Before you start, know the limits of the free plans** (details at the end):

- **Website photos are not kept.** Offer and gallery images uploaded in Sabilling disappear whenever Render
  restarts. Billing, clients, appointments and everything else is in the database and is safe.
- **The database is 500 MB** (years of bills for one salon) and **has no automatic backups**: you take them
  yourself from your PC, once a week (step 8).
- **The free server is slow-ish**, and sleeps if nobody visits for 15 minutes. Step 4 keeps it awake for free.

## 1. Create the database (Supabase)

1. Go to **supabase.com** → **Start your project** → sign in with GitHub.
2. **New project**:
   - **Name:** `sabilling`
   - **Database password:** type a long one using **only letters and numbers** (symbols break the
     connection address). Save it in a safe place.
   - **Region:** **Southeast Asia (Singapore)**, the same region as the app in step 2.
   - Click **Create new project** and wait about 2 minutes.
3. Click **Connect** (top of the project page) → under **Session pooler** copy the URI. It looks like:

   ```
   postgresql://postgres.abcdefghij:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```

   Replace `[YOUR-PASSWORD]` with your password and add `?sslmode=require&connection_limit=5` at the end:

   ```
   postgresql://postgres.abcdefghij:MyLongPassword123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=5
   ```

   This is your **DATABASE_URL**. Use the **Session pooler** one: the "Direct connection" address doesn't
   work from Render, and the "Transaction pooler" (port 6543) doesn't suit Sabilling.
4. **Close Supabase's automatic web API.** Sabilling doesn't use it, and leaving it on would expose the tables.
   Open **SQL Editor** → **New query**, paste and **Run**:

   ```sql
   revoke usage on schema public from anon, authenticated;
   ```

## 2. Create the app (Render)

1. Go to **render.com** → **Get Started** → sign in with GitHub, and allow access to the
   `imamanpatel/salonbilling` repository.
2. **New** → **Blueprint** → pick **salonbilling** → Render reads `render.yaml` from the repo.
3. It asks for three values:

   | Setting | Value |
   |---|---|
   | `DATABASE_URL` | the address from step 1.3 |
   | `APP_URL` | `https://sabilling.onrender.com` (fix it in step 3 if Render gives a different address) |
   | `SEED_ADMIN_PASSWORD` | the password you'll use to sign in as `superadmin` (at least 8 characters) |

4. Click **Apply** / **Deploy Blueprint**. The first build takes 5–10 minutes. In **Logs** you'll see the
   database tables being created and `Seeded "Glam & Grit Salon" with branch "Main" and superadmin`.

## 3. Sign in

Open the address shown at the top of the service page (e.g. `https://sabilling.onrender.com`) and sign in
as **superadmin** with the password from step 2.

If the address differs from what you typed for `APP_URL`: service → **Environment** → edit `APP_URL` → save
(it redeploys). Links sent to clients (feedback, online booking) use it.

## 4. Keep it awake (free)

Render's free server sleeps after 15 minutes without visitors; the next visit then waits about a minute,
and WhatsApp reminders don't go out while it sleeps. A free monitor visits every 5 minutes to keep it awake.
One always-on service fits within Render's 750 free hours a month.

1. Go to **uptimerobot.com** → sign up free.
2. **New monitor** → type **HTTP(s)** → URL `https://sabilling.onrender.com/api/health` (your address) →
   interval **5 minutes** → **Create**.

It also emails you if the site ever goes down.

## 5. Your own address (optional)

To use `https://billing.glamandgrit.co.in`:

1. Render → service → **Settings** → **Custom Domains** → **Add** → `billing.glamandgrit.co.in`.
2. Where you manage your domain's DNS, add a **CNAME** record: name `billing`, value `sabilling.onrender.com`
   (the address Render shows).
3. Back in Render click **Verify**. HTTPS is set up automatically.
4. Change `APP_URL` to `https://billing.glamandgrit.co.in`, and the UptimeRobot monitor URL too.

## 6. Switch-over day: move your Easy Salon data

The import runs **from your PC** straight into the Supabase database.

1. **In Sabilling (online)** → **Admin → Branches** → edit "Main": rename it to **Jaunpur** and set its
   booking-page name (e.g. `jaunpur`). The import then fills this branch.
2. **Stop billing in Easy Salon.**
3. **Export:** on your PC, sign in to Easy Salon as superadmin, press F12 → Console, paste the whole of
   `apps/api/scripts/easysalon/export.browser.js` and press Enter. It downloads `easysalon-export-DATE.json`.
4. **Import** from PowerShell on your PC (use your DATABASE_URL and the downloaded file's path):

   ```powershell
   cd C:\Users\AmanPatel\Desktop\Sabilling
   git pull
   npm install
   cd apps\api
   $env:DATABASE_URL = "postgresql://postgres.abcdefghij:MyLongPassword123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=5"
   npm run import:easysalon -- --file "$HOME\Downloads\easysalon-export-DATE.json" --no-images --dry-run
   npm run import:easysalon -- --file "$HOME\Downloads\easysalon-export-DATE.json" --no-images
   Remove-Item Env:DATABASE_URL
   ```

   The import prints the database it writes to: it must say `…pooler.supabase.com`, not `127.0.0.1`.
   Check the dry run's summary before running the real import. `--no-images` skips the website photos,
   because the free plan can't keep them. Then delete the export file: it has client phone numbers.
5. **Check in the app:** recent bills, a client's wallet and points, and the dues on the dashboard should
   match Easy Salon. Fix the one client whose Easy Salon points looked wrong (see the note in their profile).
6. **Finish setting up:**
   - **Admin → Users:** logins for your team ("Front desk" is the limited role).
   - **Admin → Settings:** GST defaults and loyalty points.
   - **Admin → Messaging:** your WhatsApp/SMS provider. Until then messages are only logged, not sent.
   - Change the Easy Salon superadmin password, or close that account.

## 7. Updating later

Push new code to the `main` branch on GitHub and Render rebuilds and restarts by itself in about 5–10
minutes, applying any database changes. Your data is untouched. Watch it under the service's **Events**.

## 8. Backups (weekly, from your PC)

The free database has no backups you can download, so make one yourself, from PowerShell on your PC. It
uses `pg_dump`, which came with the PostgreSQL you installed. Use your DATABASE_URL **without**
`&connection_limit=5`:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" "postgresql://postgres.abcdefghij:MyLongPassword123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require" --schema=public --no-owner -Fc -f "sabilling-$(Get-Date -Format yyyy-MM-dd).dump"
```

Keep the `.dump` files somewhere safe (Google Drive, an external disk). To restore one into the database:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" --clean --if-exists --no-owner -d "THE_SAME_ADDRESS" sabilling-DATE.dump
```

## The free plans' limits, in full

| Limit | What it means for you |
|---|---|
| Files reset on every restart/deploy | Website offer and gallery photos vanish; don't rely on them on the free plan. Everything else is in the database. |
| Sleeps after 15 min idle | Solved by the UptimeRobot monitor (step 4). |
| Small, slow server (512 MB) | Fine for one salon; pages may feel slower than on your PC. |
| 500 MB database | Many years of bills for one salon. |
| Supabase pauses projects unused for 7 days | Sabilling checks the database every few seconds, so it stays active. If it is ever paused, open the project in Supabase and click **Restore**. |
| No automatic backups | Step 8, weekly. |

When the salon relies on it daily, moving to a paid plan removes these limits: either Render's **Starter**
plan with a persistent disk for photos, or a small VPS with [DEPLOY.md](DEPLOY.md) (about ₹500 a month).

## If something goes wrong

| Problem | Fix |
|---|---|
| Build fails at `db:deploy` with "Can't reach database server" | `DATABASE_URL` is wrong: use the **Session pooler** address, port 5432, with your real password (letters and numbers only) and `?sslmode=require&connection_limit=5`. |
| `prepared statement "s0" already exists` | You used the Transaction pooler (port 6543); switch to the Session pooler (port 5432). |
| Build fails with "Set SEED_ADMIN_PASSWORD" | Add `SEED_ADMIN_PASSWORD` (8+ characters) under **Environment** and redeploy. |
| Site takes a minute to open | The UptimeRobot monitor isn't running, or points at the wrong address. |
| The import says `Database: 127.0.0.1…` | `$env:DATABASE_URL` isn't set in that PowerShell window, so it's using your local database. Set it and run again. |
| Anything else | Render → service → **Logs** shows the error; paste it to whoever is helping you. |
