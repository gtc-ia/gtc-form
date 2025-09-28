# 📦 GTC1 Server Infrastructure Overview

This document describes the current configuration, software stack, and automation setup for the main GTC1 production server used in the GTC IT project.

---

## 🖥️ Server Overview

- **OS**: Ubuntu 22.04.5 LTS (x86_64)
- **Kernel**: 6.8.0-1029-azure
- **Environment**: Microsoft Azure VM
- **CPU**: Intel Xeon Platinum 8370C (4 cores)
- **RAM**: 16 GB
- **Disk**: 248 GB (SSD), 19% used

## 🌐 Networking

- **Public domain**: https://agent.gtstor.com
- **Internal IP**: 10.0.0.4
- **Access**: SSH via key, RDP disabled, VPN recommended

## 🧠 Applications Installed

- **n8n** (workflow automation)
  - Version: 1.94.1
  - Installation: Global via `npm install -g n8n`
  - Autostart: Configured via `systemd` service (`n8n.service`)
  - Port: 5678
  - Database: External PostgreSQL
  - File path: `/home/kfilipenko/.n8n`

- **PostgreSQL**
  - Version: 14
  - Running via systemd (`postgresql.service`)
  - Configured for service `gtc_db` under user `gtc_user`
  - Also includes parallel instance used by Coder IDE on port 43015

## 🔐 Access & Identity

- SSH Access via:
  - `~/.ssh/GTC1_key.pem` (primary)
  - Generated: `gtc_restore_key` for backups and transfers

- Google Workspace OAuth group access configured for authenticated use with n8n (authorization via email address `kfilipenko@kmf.ru`)

## 🔁 Automation

### Auto Update Script

```bash
#!/bin/bash
cd ~
sudo npm install -g n8n@latest
sudo systemctl restart n8n
```

- Path: `/home/kfilipenko/n8n_update.sh`
- Permissions: `chmod +x n8n_update.sh`

### Crontab Entry

```cron
0 */2 * * * /home/kfilipenko/n8n_update.sh >> /home/kfilipenko/n8n_update.log 2>&1
```

- Description: Updates n8n every 2 days and restarts service

## 🚀 Registration Form Deployment

- Repository cloned at `~/gtc-form`
- Static site for the registration form is served from `/var/www/gtc-form`
- Deployment is handled by the `deploy.sh` script committed in the repository root
  - Installs dependencies with `npm ci`
  - Stages the `Client/gtc-form` and `assets` directories
  - Syncs the bundle into `/var/www/gtc-form` using `rsync --delete`
- Run on GTC1 after pulling the latest changes:

  ```bash
  cd ~/gtc-form
  export GOOGLE_CLIENT_ID="<google-oauth-client-id>"
  git pull origin main
  ./deploy.sh
  ```

- Script exits with non-zero codes when requirements are missing (npm/node/rsync) or if syncing fails, enabling monitoring by GitHub Actions
- `deploy.sh` writes `/var/www/gtc-form/gtc-config.js` during sync. The script serializes the value of `$GOOGLE_CLIENT_ID` into that file so the Google sign-in page can initialize the OAuth client at runtime. Keep the environment variable in your shell profile or deployment automation to make redeployments reproducible.

## 📦 Backup & Restore

- Backup created with:
  ```bash
  sudo -u postgres pg_dump -U postgres -d gtc_db -F c -f /tmp/gtc_db_n8n.backup
  ```
- Restore confirmed from `/tmp/gtc_db_n8n.backup`
- Server GTC1-backup used for emergency failover and was successfully synced

## 📁 Directory Structure

| Path                      | Description                        |
|---------------------------|------------------------------------|
| `/home/kfilipenko/.n8n`   | n8n user data and logs             |
| `/home/kfilipenko/.ssh`   | SSH keys                           |
| `/home/kfilipenko/n8n_update.sh` | Auto-update script              |
| `/etc/systemd/system/n8n.service` | n8n systemd service config     |

## 🧾 Notes

- Deprecated n8n installations removed
- All access routed through authorized domain with certificate in place
- Infrastructure documented and maintained via GitHub: `gtc-ia/gtc-form`