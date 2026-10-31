# Deploying Sabilling on Oracle Cloud (free)

Oracle's **Always Free** plan gives you a permanent Ubuntu server (Ampere A1, up to 2 CPUs and 12 GB RAM)
at no cost, which is plenty for Sabilling. This guide covers the Oracle-specific part: account, server and
firewall. It then hands over to the main guide, [DEPLOY.md](DEPLOY.md), and lists what to do differently.

Plan about 1½ hours. Oracle's website changes its menus from time to time; if a name below doesn't match
exactly, look for the nearest equivalent.

## A. Create the account

1. Go to **oracle.com/cloud/free** and click **Start for free**.
2. Fill in your details. When asked for the **Home Region**, choose **India West (Mumbai)** or
   **India South (Hyderabad)**. This **cannot be changed later**, and free servers only exist in your home region.
3. Add a credit or debit card. It's for verification; Always Free resources are not charged.
4. Wait for the "account is ready" email (minutes, sometimes a few hours), then sign in at
   **cloud.oracle.com**.

## B. Stop Oracle from reclaiming the free server

Oracle may take back an Always Free server that looks idle (low CPU use for a week), and a billing app is
mostly idle. Upgrading the account to Pay As You Go avoids this; you still pay nothing as long as you stay
within the Always Free limits.

1. Menu (☰) → **Billing & Cost Management** → **Upgrade and Manage Payment** → **Pay As You Go** → upgrade.
2. Menu → **Billing & Cost Management** → **Budgets** → **Create Budget**: amount **1** (your billing
   currency), alert at **1%** to your email. You'll hear about it immediately if anything ever costs money.
3. Only ever create the resources below. Anything labelled "Always Free eligible" is fine; don't add other
   paid services.

## C. Make an SSH key on your PC

In **PowerShell** on your PC:

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\oracle
```

Press **Enter** twice when it asks for a passphrase (or type one you'll remember). Then show the public key:

```powershell
Get-Content $HOME\.ssh\oracle.pub
```

Keep the window open: you'll paste the printed line (starting `ssh-ed25519`) into Oracle next. The file
`$HOME\.ssh\oracle` (without `.pub`) is your private key. Never share it, and back it up: without it you
can't log in.

## D. Create the server

Menu → **Compute** → **Instances** → **Create instance**:

| Setting | Choose |
|---|---|
| **Name** | `sabilling` |
| **Image** | **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** |
| **Shape** | **Change shape** → **Ampere** → **VM.Standard.A1.Flex**, **2** OCPUs, **12** GB memory (it shows "Always Free eligible") |
| **Networking** | **Create new virtual cloud network** and **Create new public subnet** (keep the suggested names); **Assign a public IPv4 address: Yes** |
| **SSH keys** | **Paste public keys** → paste the `ssh-ed25519 …` line from step C |
| **Boot volume** | Leave the default (about 47 GB; free up to 200 GB in total) |

Click **Create**. After a minute or two the status is **Running**. Copy the **Public IP address**: that's
your `SERVER_IP`.

> **"Out of capacity for shape VM.Standard.A1.Flex"** is common. Try another **Availability domain** in the
> Placement section, try again later in the day, or temporarily choose 1 OCPU / 6 GB (you can resize later).

## E. Open the web ports in Oracle's firewall

Oracle blocks everything except SSH by default.

1. On the instance page, click the **subnet** link (under Primary VNIC), then the **Default Security List**.
2. **Add Ingress Rules**, twice:

   | Source CIDR | IP protocol | Destination port |
   |---|---|---|
   | `0.0.0.0/0` | TCP | `80` |
   | `0.0.0.0/0` | TCP | `443` |

## F. Log in and prepare the server

From PowerShell on your PC:

```powershell
ssh -i $HOME\.ssh\oracle ubuntu@SERVER_IP
```

(Type `yes` the first time.) You're now the `ubuntu` user, which uses `sudo` for admin commands.

Open ports 80 and 443 in the server's own firewall too. Oracle's Ubuntu image only allows SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
sudo iptables -L INPUT --line-numbers     # the two ACCEPT lines must be above the "REJECT" line
```

Install everything and create the app user. This replaces step 2 of DEPLOY.md: no `ufw` (Oracle's two
firewalls above do that job) and no swap (you have 12 GB RAM):

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Kolkata

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql nginx git certbot python3-certbot-nginx
sudo npm install -g pm2

sudo adduser --disabled-password --gecos "" sabilling
sudo chmod 755 /home/sabilling
```

If `apt upgrade` asks about restarting services or keeping a config file, accept the defaults (press Enter).

## G. Continue with the main guide

Now follow [DEPLOY.md](DEPLOY.md) from **step 1** (DNS) and then **step 3** onwards, with these changes,
because on Oracle you log in as `ubuntu`, not `root`:

| DEPLOY.md step | On Oracle |
|---|---|
| 1. DNS | Same: point `billing` at your Oracle `SERVER_IP`. |
| 2. Prepare the server | **Skip.** You did it in step F above. |
| 3. Database | Same commands (they already use `sudo`). |
| 4. Get the code | Use `sudo -iu sabilling` instead of `su - sabilling`. |
| 5–6. Configure, tables, first login | Same (as the sabilling user). |
| 7. PM2 | After `pm2 startup`, type `exit` (back to `ubuntu`) and run the `sudo env PATH=…` line it printed. Then `sudo -iu sabilling` to continue. |
| 8. Nginx + HTTPS | Put `sudo` in front of every command (`sudo cp …`, `sudo nano …`, `sudo ln …`, `sudo rm …`, `sudo nginx -t && sudo systemctl reload nginx`, `sudo certbot --nginx -d …`). |
| 9. Backups | Same. To copy backups to your PC, see "Copying backups to your PC" below. |
| 10–11. Switch-over day, updates | Same. To copy the Easy Salon export up: `scp -i $HOME\.ssh\oracle easysalon-export-DATE.json ubuntu@SERVER_IP:~/` then on the server `sudo mv ~/easysalon-export-DATE.json /home/sabilling/ && sudo chown sabilling: /home/sabilling/easysalon-export-DATE.json`. |

Everything Sabilling uses (Node, PostgreSQL, Prisma, Nginx) runs on Oracle's ARM processors; nothing
special is needed for that.

## Copying backups to your PC

Backups live in `/home/sabilling/backups`. From PowerShell on your PC:

```powershell
ssh -i $HOME\.ssh\oracle ubuntu@SERVER_IP "sudo tar -czf /tmp/sabilling-backups.tgz -C /home/sabilling backups && sudo chmod 644 /tmp/sabilling-backups.tgz"
scp -i $HOME\.ssh\oracle ubuntu@SERVER_IP:/tmp/sabilling-backups.tgz .
```

Do this weekly, or more often, and keep the copies somewhere safe (Google Drive, an external disk).
Oracle's free plan comes with no guarantee.

## Oracle-specific problems

| Problem | Fix |
|---|---|
| `ssh` hangs or times out | Check the public IP; the Security List must still allow port 22 (it does by default). |
| `Permission denied (publickey)` | Use `-i $HOME\.ssh\oracle` and the user `ubuntu`; the key pasted in step D must be the `.pub` of that file. |
| Site doesn't load, but `curl http://127.0.0.1` on the server works | One of the two firewalls: the Security List rules (step E) or the `iptables` lines (step F). |
| certbot says "Timeout during connect" | Same firewall check for port 80, and the DNS record must point at this IP. |
| Instance shows **Stopped** and you didn't stop it | Start it from the console (**Instance → Start**). If Oracle reclaimed it, check you upgraded to Pay As You Go (step B). |
| "Out of capacity" when creating | See the note in step D. |
