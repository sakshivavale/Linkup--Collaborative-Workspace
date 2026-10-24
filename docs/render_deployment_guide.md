# 🚀 LinkUp Render Deployment Guide

> Your code has been pushed to GitHub. Follow these steps **in order** on [your Render project](https://dashboard.render.com/project/prj-dbblpeg473hc73cpk70g).

---

## Step 1 — Create the Backend (Web Service)

1. Go to **Render Dashboard → New → Web Service**
2. Connect repo: `sakshivavale/Linkup--Collaborative-Workspace`
3. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `linkup-api` |
| **Root Directory** | _(leave empty — root of repo)_ |
| **Environment** | Node |
| **Build Command** | `npm install && npm run build --workspace=server` |
| **Start Command** | `node server/dist/index.js` |
| **Plan** | Free |

4. Add these **Environment Variables**:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `SUPABASE_URL` | `https://ppqcrvxwlldjsfpfffth.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | _(copy from your server/.env)_ |
| `CORS_ORIGIN` | _(leave blank for now — fill after Step 2)_ |
| `PISTON_URL` | `http://localhost:2000` |

5. Click **Create Web Service** → wait for the first deploy

6. **Copy the backend URL** — it will look like: `https://linkup-api-XXXX.onrender.com`

---

## Step 2 — Create the Frontend (Static Site)

1. Go to **Render Dashboard → New → Static Site**
2. Connect repo: `sakshivavale/Linkup--Collaborative-Workspace`
3. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `linkup-client` |
| **Root Directory** | _(leave empty — root of repo)_ |
| **Build Command** | `npm install && npm run build --workspace=client` |
| **Publish Directory** | `client/dist` |

4. Add these **Environment Variables**:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://ppqcrvxwlldjsfpfffth.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | _(copy from your client/.env)_ |
| `VITE_API_BASE_URL` | _(paste the backend URL from Step 1, e.g. `https://linkup-api-XXXX.onrender.com`)_ |

5. Add a **Rewrite Rule** for SPA routing:
   - Source: `/*`
   - Destination: `/index.html`
   - Type: Rewrite

6. Click **Create Static Site** → wait for deploy

7. **Copy the frontend URL** — it will look like: `https://linkup-client-XXXX.onrender.com`

---

## Step 3 — Cross-link the URLs

Now that both are deployed, you need to set the cross-references:

### 3a. Update Backend's CORS_ORIGIN
1. Go to `linkup-api` → **Environment** tab
2. Set `CORS_ORIGIN` = your frontend URL (e.g. `https://linkup-client-XXXX.onrender.com`)
   - ⚠️ **No trailing slash!**
3. Click **Save Changes** → this triggers a redeploy

### 3b. Verify Frontend's VITE_API_BASE_URL
1. Go to `linkup-client` → **Environment** tab
2. Confirm `VITE_API_BASE_URL` = your backend URL (e.g. `https://linkup-api-XXXX.onrender.com`)
   - ⚠️ **No trailing slash!**
3. If you changed it, click **Save Changes** → redeploy

---

## Step 4 — Update Supabase Redirect URLs

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project
2. Navigate to **Authentication → URL Configuration**
3. Add your frontend Render URL to **Redirect URLs**:
   - `https://linkup-client-XXXX.onrender.com/**`
4. Save changes

---

## Step 5 — Verify

1. Visit your frontend URL: `https://linkup-client-XXXX.onrender.com`
2. Check the backend health endpoint: `https://linkup-api-XXXX.onrender.com/health`
3. Both should be live! 🎉

---

## ⚠️ Important Notes

> [!WARNING]
> **Free tier cold starts**: Render's free tier spins down after 15 minutes of inactivity. The first request after idle can take 30-60 seconds. This is normal.

> [!IMPORTANT]
> **Supabase URL settings**: Make sure your Supabase project's auth settings allow redirects from your Render frontend URL. Go to Supabase Dashboard → Authentication → URL Configuration → add your frontend URL to "Redirect URLs".

> [!NOTE]
> **Piston code execution**: The `PISTON_URL=http://localhost:2000` won't work on Render (there's no Piston container). The code execution feature will be non-functional unless you deploy a Piston instance separately and update the URL.

---

## Quick Reference

| Service | Type | Build Command | Start/Publish |
|---------|------|---------------|---------------|
| `linkup-api` | Web Service | `npm install && npm run build --workspace=server` | `node server/dist/index.js` |
| `linkup-client` | Static Site | `npm install && npm run build --workspace=client` | `client/dist` |
