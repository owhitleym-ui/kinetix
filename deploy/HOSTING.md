# Hosting: Vercel frontend + Oracle backend (hackathon default)

Static UI on **Vercel**. Coach API, GenAI, Object Storage, and TTS on **OCI Compute**.

```
Browser (Vercel)  →  https://YOUR-VM.sslip.io/coach/*   →  FastAPI :8000
                  →  https://YOUR-VM.sslip.io/tts       →  TTS :3002
                  →  OCI GenAI / Object Storage / ATP (from the VM)
```

## 1. OCI backend (one-time on the VM)

```bash
ssh opc@YOUR_PUBLIC_IP

sudo dnf install -y git nginx python3.12 python3.12-pip certbot python3-certbot-nginx
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

git clone https://github.com/owhitleym-ui/kinetix.git ~/kinetix
# or: cd ~/kinetix && git pull
```

Secrets (do not commit):

```bash
nano ~/kinetix/backend/.env          # GenAI + Object Storage + CORS
nano ~/kinetix/voice-feedback/.env   # OPENAI_API_KEY
mkdir -p ~/.oci                      # config + oci_api_key.pem
```

Open **TCP 80 + 443** in the VCN security list and (if used) firewalld.

```bash
bash ~/kinetix/deploy.sh
sudo certbot --nginx -d 207-211-163-177.sslip.io
```

**HTTPS is required** once the UI is on Vercel (browsers block HTTPS page → HTTP API).

Check:

```bash
curl -fsS https://207-211-163-177.sslip.io/health
```

## 2. Point the frontend at OCI

`web/config.js` already sends Vercel traffic to:

```js
const OCI_BACKEND = "https://207-211-163-177.sslip.io";
```

Change that constant if your public hostname differs.

CORS: FastAPI and TTS allow `*.vercel.app` by default. Add a custom domain to `CORS_ORIGINS` in `backend/.env` if needed, then re-run `deploy.sh`.

## 3. Deploy frontend to Vercel

1. [vercel.com](https://vercel.com) → Import the `kinetix` GitHub repo  
2. Framework: **Other** — `vercel.json` sets `outputDirectory` to `web`  
3. Deploy  

Open the `*.vercel.app` URL, Start session, confirm coach/TTS hit OCI (`/health` in Network tab).

Or CLI:

```bash
npx vercel --prod
```

## 4. Demo story

> Frontend on Vercel; form coach, Generative AI, and session storage on Oracle Cloud.

## 5. GitHub auto-deploy (env secrets → VM)

Repo **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|--------|
| `OCI_HOST` | VM public IP |
| `OCI_USER` | `opc` |
| `OCI_SSH_KEY` | SSH private key |
| `BACKEND_ENV` | full contents of `backend/.env` |
| `VOICE_FEEDBACK_ENV` | full contents of `voice-feedback/.env` |

On push to `main` (or **Actions → Deploy to OCI → Run workflow**), the job pulls code, writes those `.env` files on the VM, then runs `deploy.sh`.

---

## Alternative: everything on one OCI VM

See older Option 1 flow: `deploy.sh` + nginx serves `web/` on port 80 as well.  
`config.js` uses `location.origin` when not on localhost/Vercel.
