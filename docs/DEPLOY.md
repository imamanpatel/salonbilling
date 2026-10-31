# Deploying Sabilling

This puts Sabilling on its own server at an address like `https://billing.glamandgrit.co.in`, with your
Easy Salon data moved across on the day you switch. Plan about an hour for the setup, plus 15 minutes on
switch-over day.

**What you end up with:** one Ubuntu server running PostgreSQL (the database), the Sabilling API (kept
running by PM2) and Nginx (serves the app over HTTPS). Daily backups go to a folder you copy off the
server.

**Using Oracle Cloud's free server?** Start with [DEPLOY-ORACLE.md](DEPLOY-ORACLE.md): it sets up the
Oracle account and server, then sends you back here with the few changes to make.

## 0. What you need

| | |
|---|---|
| **A server (VPS)** | Ubuntu 24.04, **2 GB RAM**, 1–2 CPUs, 40 GB disk, in an Indian region so it's fast at the salon. For example Hostinger KVM 2, DigitalOcean (Bangalore) or AWS Lightsail (Mumbai): roughly ₹500–1,500 a month. |
| **A web address** | A subdomain of the domain you already own, e.g. `billing.glamandgrit.co.in`. You need to be able to edit its DNS. |
| **GitHub access** | The code is in `github.com/imamanpatel/salonbilling`. |
| **On your PC** | A terminal that has `ssh` (Windows Terminal / PowerShell has it). |

Throughout this guide replace:

- `SERVER_IP` → your server's IP address
- `billing.example.com` → your web address
- anything in `CAPITALS` → a value you choose

## 1. Point your web address at the server

At the company where you manage your domain's DNS, add an **A record**:

| Type | Name | Value |
|---|---|---|
| A | `billing` | `SERVER_IP` |

It usually starts working within minutes (sometimes up to an hour). Carry on meanwhile.

## 2. Prepare the server

Connect as root (your VPS provider shows the root password or lets you add an SSH key):

```bash
ssh root@SERVER_IP
```

Install everything and create a `sabilling` user that will run the app:

```bash
apt update && apt upgrade -y
timedatectl set-timezone Asia/Kolkata

# Node.js 22, PostgreSQL, Nginx, Git, HTTPS certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs postgresql nginx git certbot python3-certbot-nginx
npm install -g pm2

# Firewall: only SSH and web traffic
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# App user; Nginx must be able to read the built app in its home folder
adduser --disabled-password --gecos "" sabilling
chmod 755 /home/sabilling
```

If your server has only 1 GB RAM, add swap so the build doesn't run out of memory:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 3. Create the database

Pick a strong database password using **letters and numbers only** (symbols break the connection string):

```bash
sudo -u postgres psql -c "CREATE USER sabilling WITH PASSWORD 'DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE sabilling OWNER sabilling;"
```

PostgreSQL only listens on the server itself by default, so it isn't reachable from the internet.

## 4. Get the code

Switch to the app user and create a key the server uses to read the (private) GitHub repo:

```bash
su - sabilling
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

On GitHub open **salonbilling → Settings → Deploy keys → Add deploy key**, paste the line that was printed,
leave "Allow write access" **off**, and save. Then:

```bash
git clone git@github.com:imamanpatel/salonbilling.git
cd salonbilling
npm ci
npm run build
mkdir -p ~/uploads ~/backups
```

(Type `yes` if Git asks whether to trust github.com.)

## 5. Configure the API

Generate a secret for login sessions, and copy the result:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Create the settings file:

```bash
nano ~/salonbilling/apps/api/.env
```

Paste this, fill in the capitals, then save (Ctrl+O, Enter, Ctrl+X):

```ini
NODE_ENV="production"
DATABASE_URL="postgresql://sabilling:DB_PASSWORD@127.0.0.1:5432/sabilling?schema=public"
JWT_SECRET="THE_LONG_SECRET_YOU_GENERATED"
PORT=4000
SESSION_HOURS=12
BUSINESS_TIMEZONE="Asia/Kolkata"
APP_URL="https://billing.example.com"
UPLOADS_DIR="/home/sabilling/uploads"

# Used once to create the first login
SEED_ORG_NAME="Glam & Grit Salon"
SEED_ADMIN_USERNAME="superadmin"
SEED_ADMIN_PASSWORD="A_STRONG_ADMIN_PASSWORD"
```

```bash
chmod 600 ~/salonbilling/apps/api/.env
```

## 6. Create the tables and the first login

```bash
cd ~/salonbilling
npm run db:deploy
npm run db:seed
```

The second command creates the organisation, a branch called "Main" and the `superadmin` login with the
password you set above.

## 7. Start the API and keep it running

```bash
cd ~/salonbilling
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` prints one `sudo env PATH=...` command. Copy that command, type `exit` to go back to root,
paste and run it, then `su - sabilling` again. This makes the API start automatically after a reboot.

Check it's running:

```bash
curl http://127.0.0.1:4000/api/health      # → {"ok":true}
```

> Keep it to **one** instance. Message sending and daily reminders run inside the API; two copies would
> send every WhatsApp/SMS twice.

## 8. Put it on the web with HTTPS

As root (`exit` from the sabilling user):

```bash
cp /home/sabilling/salonbilling/deploy/nginx.conf /etc/nginx/sites-available/sabilling
nano /etc/nginx/sites-available/sabilling        # replace billing.example.com with your address
ln -s /etc/nginx/sites-available/sabilling /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

certbot --nginx -d billing.example.com           # enter your email, agree, choose redirect
```

Open `https://billing.example.com` and sign in as `superadmin`. HTTPS is required: without it, sign-in
won't stick.

## 9. Backups

As the sabilling user, save the database password so the backup can run unattended:

```bash
echo "127.0.0.1:5432:sabilling:sabilling:DB_PASSWORD" > ~/.pgpass && chmod 600 ~/.pgpass
bash ~/salonbilling/deploy/backup.sh          # try it once
crontab -e
```

Add this line to run it every night at 2:30 am, then save:

```
30 2 * * * /bin/bash /home/sabilling/salonbilling/deploy/backup.sh >> /home/sabilling/backups/backup.log 2>&1
```

Backups (`~/backups/db-DATE.dump` and `uploads-DATE.tar.gz`, last 14 days) are on the same server, so
**also copy them somewhere else** regularly, e.g. from your PC:

```bash
scp -r sabilling@SERVER_IP:backups ./sabilling-backups
```

(For that, add your PC's SSH key to `/home/sabilling/.ssh/authorized_keys`, or ask your VPS provider to
enable their snapshot backups as well.)

To restore a backup into an empty database:
`pg_restore -h 127.0.0.1 -U sabilling -d sabilling --clean db-DATE.dump`.

## 10. Switch-over day: move your Easy Salon data

Do this when you stop using Easy Salon, so nothing is billed in both.

1. **In Sabilling**, go to **Admin → Branches**, edit "Main", rename it to **Jaunpur** (the same name as in
   Easy Salon) and set its booking-page name (e.g. `jaunpur`). The import then fills this branch instead of
   creating a second one.
2. **Stop billing in Easy Salon.**
3. **Export from Easy Salon:** on your PC, sign in to Easy Salon as superadmin, press F12 → Console, paste the
   whole of [`apps/api/scripts/easysalon/export.browser.js`](../apps/api/scripts/easysalon/export.browser.js)
   and press Enter. After a few minutes it downloads `easysalon-export-DATE.json`.
4. **Copy it to the server** (from the folder it downloaded to):

   ```bash
   scp easysalon-export-DATE.json sabilling@SERVER_IP:~/
   ```

5. **Import** (on the server, as sabilling). Check the summary of the dry run first, then run it for real:

   ```bash
   cd ~/salonbilling/apps/api
   npm run import:easysalon -- --file ~/easysalon-export-DATE.json --dry-run
   npm run import:easysalon -- --file ~/easysalon-export-DATE.json
   rm ~/easysalon-export-DATE.json       # it contains client phone numbers
   ```

   Delete the export file from your PC's Downloads folder too.
6. **Check in the app:** a few recent bills, a client's wallet and points, and the dashboard dues should
   match Easy Salon. Fix the one client whose Easy Salon points looked wrong (see the note in their profile).
7. **Finish setting up:**
   - **Admin → Users:** create logins for your team. "Front desk" is the limited role: billing, clients,
     appointments, no reports, team, catalogue changes or users.
   - **Admin → Settings:** GST defaults and loyalty points.
   - **Admin → Messaging:** enter your WhatsApp/SMS provider details. Until then messages are only logged,
     not sent.
   - Change the Easy Salon superadmin password, or close that account.

## 11. Updating later

When new code is pushed to GitHub, on the server as sabilling:

```bash
bash ~/salonbilling/deploy/update.sh
```

It pulls the code, rebuilds, applies database changes and restarts the API. Your data, `.env` and uploaded
images are not touched. Take a backup first if the update changes the database
(`bash ~/salonbilling/deploy/backup.sh`).

## If something goes wrong

| Problem | Check |
|---|---|
| Site doesn't open | `systemctl status nginx`, `nginx -t`; is the DNS record pointing at the right IP (`ping billing.example.com`)? |
| "502 Bad Gateway" | The API isn't running: `pm2 status`, then `pm2 logs sabilling-api --lines 100` |
| "403 Forbidden" on every page | `chmod 755 /home/sabilling`, and the `root` path in the Nginx file matches where you cloned |
| Signed in but immediately signed out | You're on `http://`, not `https://` (run step 8's certbot), or `NODE_ENV`/`APP_URL` are wrong in `.env` |
| API won't start: "Missing required environment variable" | A value is missing in `apps/api/.env` |
| Database errors at start | `DATABASE_URL` password/user wrong, or `npm run db:deploy` wasn't run |
| Images missing after a move | `UPLOADS_DIR` points at the folder you copied them into |

Useful commands: `pm2 logs sabilling-api` (live API log), `pm2 restart sabilling-api`,
`sudo tail -f /var/log/nginx/error.log`.
