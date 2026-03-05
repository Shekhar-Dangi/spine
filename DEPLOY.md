# Spine V1 — Deployment Guide

Target: **Azure Container Apps** (backend) + **Vercel** (frontend)

---

## Before You Start — Local Prep

### 1. Grab your Fernet key (if migrating existing data)
```bash
cat backend/storage/.spine.key
```
Copy the output. You'll paste it into Azure Key Vault later.
If you're starting fresh (no existing users/books), skip this — a new key will be generated automatically.

### 2. Commit and push all code
```bash
git add -A
git commit -m "deploy: env-based secrets, WAL mode, Dockerfile"
git push origin main
```

---

## Part 1 — Azure Setup (one-time)

### 3. Install Azure CLI (if not installed)
```bash
brew install azure-cli
az login
```

### 4. Create a resource group
```bash
az group create --name spine-rg --location eastus
```

### 5. Create Azure Container Registry (ACR)
```bash
az acr create \
  --resource-group spine-rg \
  --name spineregistry \
  --sku Basic \
  --admin-enabled true
```
Note your registry login server — it'll be `spineregistry.azurecr.io`.

### 6. Create Azure Files share (for persistent SQLite + ChromaDB)
```bash
az storage account create \
  --name spinestorage \
  --resource-group spine-rg \
  --sku Standard_LRS

az storage share create \
  --name spinedata \
  --account-name spinestorage
```
Get the storage account key:
```bash
az storage account keys list \
  --account-name spinestorage \
  --resource-group spine-rg \
  --query "[0].value" -o tsv
```
Save this key — needed when creating the Container App.

### 7. Create Key Vault and store secrets
```bash
az keyvault create \
  --name spine-vault \
  --resource-group spine-rg \
  --location eastus

# Paste your Fernet key from step 1 (or skip if fresh DB)
az keyvault secret set \
  --vault-name spine-vault \
  --name SPINE-FERNET-KEY \
  --value "<paste key here>"

# Generate a strong JWT secret and store it
az keyvault secret set \
  --vault-name spine-vault \
  --name SPINE-JWT-SECRET \
  --value "$(openssl rand -hex 32)"
```

---

## Part 2 — Build & Push Docker Image

### 8. Build the image
```bash
cd backend
docker build -t spineregistry.azurecr.io/spine-backend:latest .
```

> **If build fails on PyMuPDF**: PyMuPDF ships its own MuPDF so the
> `libmupdf-dev` apt package isn't actually needed. If the build errors
> on that step, remove the `apt-get` block from Dockerfile and rebuild.

### 9. Push to ACR
```bash
az acr login --name spineregistry
docker push spineregistry.azurecr.io/spine-backend:latest
```

---

## Part 3 — Deploy Backend (Azure Container Apps)

### 10. Create Container Apps environment
```bash
az containerapp env create \
  --name spine-env \
  --resource-group spine-rg \
  --location eastus
```

### 11. Mount Azure Files to the environment
```bash
az containerapp env storage set \
  --name spine-env \
  --resource-group spine-rg \
  --storage-name spinefiles \
  --azure-file-account-name spinestorage \
  --azure-file-account-key "<storage account key from step 6>" \
  --azure-file-share-name spinedata \
  --access-mode ReadWrite
```

### 12. Get Key Vault secret URIs
```bash
az keyvault secret show \
  --vault-name spine-vault \
  --name SPINE-FERNET-KEY \
  --query id -o tsv

az keyvault secret show \
  --vault-name spine-vault \
  --name SPINE-JWT-SECRET \
  --query id -o tsv
```
You'll get URLs like:
`https://spine-vault.vault.azure.net/secrets/SPINE-FERNET-KEY/abc123`

### 13. Create the Container App
```bash
az containerapp create \
  --name spine-backend \
  --resource-group spine-rg \
  --environment spine-env \
  --image spineregistry.azurecr.io/spine-backend:latest \
  --registry-server spineregistry.azurecr.io \
  --registry-username spineregistry \
  --registry-password "$(az acr credential show --name spineregistry --query passwords[0].value -o tsv)" \
  --target-port 8000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --env-vars \
    SPINE_FERNET_KEY=secretref:fernet-key \
    SPINE_JWT_SECRET=secretref:jwt-secret \
    COOKIE_SECURE=true \
    CORS_ORIGINS=https://spine-v1.vercel.app \
  --secrets \
    fernet-key=keyvaultref:<FERNET-KEY-URI>,identityref:system \
    jwt-secret=keyvaultref:<JWT-SECRET-URI>,identityref:system
```
Replace `<FERNET-KEY-URI>` and `<JWT-SECRET-URI>` with the URIs from step 12.
Replace `https://spine-v1.vercel.app` with your actual Vercel URL (you can update this after frontend deploy).

> Note: `--max-replicas 1` is intentional — SQLite can't handle concurrent
> writers from multiple instances. Keep it at 1.

### 14. Mount the storage volume
After creating the app, add the volume mount via the portal or:
```bash
az containerapp update \
  --name spine-backend \
  --resource-group spine-rg \
  --storage-name spinefiles \
  --mount-path /app/storage
```
If the CLI doesn't support `--storage-name` on update directly, do it via:
Azure Portal → spine-backend → Containers → Edit → Volume Mounts → add `spinefiles` at `/app/storage`

### 15. Get your backend URL
```bash
az containerapp show \
  --name spine-backend \
  --resource-group spine-rg \
  --query properties.configuration.ingress.fqdn -o tsv
```
It'll look like: `spine-backend.yellowfield-abc123.eastus.azurecontainerapps.io`
Your backend URL is: `https://<that fqdn>`

### 16. Check the logs for your admin password
```bash
az containerapp logs show \
  --name spine-backend \
  --resource-group spine-rg \
  --follow
```
Look for the `====` block:
```
============================================================
  SPINE — Admin account created
  Username : shekhardangi
  Email    : dangishekhar3109@gmail.com
  Password : <temp password here>
  Change this password after first login!
============================================================
```
**Copy and save this password.**

---

## Part 4 — Deploy Frontend (Vercel)

### 17. Connect repo to Vercel
- Go to vercel.com → New Project → Import your GitHub repo
- Set **Root Directory** to `frontend`
- Framework: Next.js (auto-detected)

### 18. Set environment variable in Vercel
In the Vercel project → Settings → Environment Variables, add:
```
NEXT_PUBLIC_API_URL = https://<your backend fqdn from step 15>
```

### 19. Deploy
- Click Deploy (or push to `main` — Vercel auto-deploys)
- Note your Vercel URL (e.g. `https://spine-v1.vercel.app`)

### 20. Update CORS_ORIGINS in backend
Go to Azure Portal → spine-backend → Environment Variables, update:
```
CORS_ORIGINS = https://spine-v1.vercel.app
```
Or via CLI:
```bash
az containerapp update \
  --name spine-backend \
  --resource-group spine-rg \
  --set-env-vars CORS_ORIGINS=https://spine-v1.vercel.app
```

---

## Part 5 — First Login & Verify

### 21. Log in with admin credentials
- Open your Vercel URL
- Log in with username `shekhardangi` and the temp password from step 16
- Go to Settings → change your password

### 22. Smoke test
- [ ] Upload a PDF — status goes through parsing → pending TOC review
- [ ] Confirm TOC — status goes to ready
- [ ] Open reader — chapter text loads
- [ ] Add a model profile in Settings with your OpenAI key
- [ ] Generate a dossier
- [ ] Run deep explain on a chapter
- [ ] Ask a Q&A question

### 23. Invite other users (if needed)
- Settings page → Invite Manager → Generate invite code
- Share the link: `https://spine-v1.vercel.app/register?code=<code>`

---

## Updating the App Later

### To push a new backend version:
```bash
cd backend
docker build -t spineregistry.azurecr.io/spine-backend:latest .
docker push spineregistry.azurecr.io/spine-backend:latest
az containerapp update \
  --name spine-backend \
  --resource-group spine-rg \
  --image spineregistry.azurecr.io/spine-backend:latest
```

### To push a new frontend version:
Just push to `main` — Vercel auto-deploys.

---

## Checklist Summary

- [ ] Fernet key saved (or decided to start fresh)
- [ ] Code pushed to main
- [ ] Resource group created
- [ ] ACR created and image pushed
- [ ] Azure Files share created
- [ ] Key Vault created with secrets
- [ ] Container App deployed with volume mount
- [ ] Admin temp password saved from logs
- [ ] Frontend deployed on Vercel
- [ ] `NEXT_PUBLIC_API_URL` set in Vercel
- [ ] `CORS_ORIGINS` updated in backend
- [ ] First login works
- [ ] Smoke test passed
