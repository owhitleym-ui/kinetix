# Host Form Check on one OCI VM (Option 1)

Frontend (`web/`) + coach API (`backend/`) + TTS (`voice-feedback/`) behind **nginx** on the same Compute instance.

## 1. One-time on the VM

```bash
ssh opc@YOUR_PUBLIC_IP

# packages (Oracle Linux)
sudo dnf install -y git nginx python3.12 python3.12-pip
# Node 20+ for TTS (optional but recommended)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# clone
git clone https://github.com/owhitleym-ui/kinetix.git ~/kinetix
cd ~/kinetix
```

Create secrets on the server (do not commit):

```bash
# Coach / GenAI / Object Storage
nano ~/kinetix/backend/.env

# TTS
nano ~/kinetix/voice-feedback/.env   # OPENAI_API_KEY=...

# OCI SDK auth for GenAI
mkdir -p ~/.oci
# put config + oci_api_key.pem here
```

Open firewall / security list: **ingress TCP 80** (and 443 later), **22**.

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload   # if firewalld is on
```

## 2. Deploy

```bash
bash ~/kinetix/deploy.sh
```

That script:

1. Resets to `origin/main`
2. Starts uvicorn on `127.0.0.1:8000`
3. Starts TTS on `127.0.0.1:3002` if `.env` exists
4. Installs `deploy/nginx-formcheck.conf` → `/etc/nginx/conf.d/formcheck.conf`
5. Serves `~/kinetix/web` on port **80**

## 3. Open the app

```
http://YOUR_PUBLIC_IP/
```

or

```
http://207-211-163-177.sslip.io/
```

(if that IP is still this VM)

`web/config.js` uses **same origin** off localhost, so the browser calls:

- `POST /coach/chat`, `/coach/summary`
- `POST /tts`
- `GET /health`

## 4. HTTPS (recommended for mic/camera)

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 207-211-163-177.sslip.io
```

Camera/mic often require a secure context (HTTPS) except on `localhost`.

## 5. GitHub auto-deploy

Repo secrets: `OCI_HOST`, `OCI_USER`, `OCI_SSH_KEY`.  
Push to `main` under `backend/**` runs `deploy.sh` via SSH.

After frontend-only changes, either widen the workflow `paths` to include `web/**` and `deploy/**`, or SSH and run `bash ~/kinetix/deploy.sh` manually.
