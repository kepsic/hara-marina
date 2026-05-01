# Hara Marina 🚢

Shared marina management app — boat positions, details, crane queue.

## Deploy to Vercel (5 min)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "init"
gh repo create hara-marina --public --push
```

### 2. Import to Vercel
Go to https://vercel.com/new → Import your `hara-marina` repo → Deploy.

### 3. Add Vercel KV (shared storage)
In your Vercel project dashboard:
- Go to **Storage** tab
- Click **Create Database** → choose **KV**
- Name it `hara-kv` → Create
- Click **Connect to Project** → select your project
- Vercel auto-adds the required env vars (`KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`)

### 4. Redeploy
Vercel will auto-redeploy after connecting KV. Done!

Share the URL with your marina mates — all data syncs in real time.

## Local dev
```bash
npm install
# Copy env vars from Vercel dashboard → Settings → Environment Variables
# into a local .env.local file
npm run dev
```

## Stack
- Next.js 14
- Vercel KV (Redis-based shared storage)
- Auto-refreshes every 30s
