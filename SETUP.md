# Laundry Outreach — Setup Guide

## Prerequisites
- Node.js 18+
- A Supabase account (free tier is fine)
- A Google Cloud account (free tier)
- A Vercel account (free Hobby plan)

---

## Step 1: Supabase Setup

1. Go to [supabase.com](https://supabase.com) → New Project
2. Once created, go to **SQL Editor** and run the entire contents of `supabase/schema.sql`
3. Go to **Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Go to **Authentication → URL Configuration**:
   - Add `https://your-app.vercel.app` to Site URL
   - Add `https://your-app.vercel.app/api/auth/callback` to Redirect URLs

---

## Step 2: Google Cloud Setup (Gmail API)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project
3. Enable **Gmail API**: APIs & Services → Library → search "Gmail API" → Enable
4. Create **OAuth 2.0 credentials**:
   - APIs & Services → Credentials → Create Credentials → OAuth Client ID
   - Application type: **Web application**
   - Authorized redirect URIs: `https://your-app.vercel.app/api/gmail/callback`
   - Also add `http://localhost:3000/api/gmail/callback` for local dev
5. Copy Client ID → `GOOGLE_CLIENT_ID` and Client Secret → `GOOGLE_CLIENT_SECRET`
6. **OAuth consent screen**: Add your email as a test user (for personal use, keep in "Testing" mode)

---

## Step 3: Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Add all environment variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
   GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxx
   NEXT_PUBLIC_URL=https://your-app.vercel.app
   CRON_SECRET=<generate with: openssl rand -hex 32>
   ```
4. Deploy. Vercel will automatically detect Next.js.
5. Update `NEXT_PUBLIC_URL` to your actual Vercel URL after first deploy.

---

## Step 4: Running Locally

```bash
cp .env.example .env.local
# Fill in .env.local with your values
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

---

## Features

| Feature | Details |
|---------|---------|
| **Login / Signup** | Email + password via Supabase Auth |
| **Contacts** | Add, edit, delete, search, filter by status |
| **Notes** | Per-contact notes with timestamps |
| **Email History** | Full history per contact |
| **Do Not Contact** | Flag contacts; excluded from sending |
| **Templates** | Create templates with `{{name}}`, `{{email}}`, `{{company}}`, `{{address}}`, `{{phone}}` placeholders |
| **Send Email** | Send immediately or schedule via Gmail API |
| **Scheduling** | Emails processed hourly by Vercel Cron |
| **Analytics** | Volume charts, best send times by hour and day |
| **CSV Export** | Export contacts from the Contacts page |

---

## Scheduled Email Notes

- Vercel Hobby (free) plan cron jobs run up to once per hour
- The cron is set to `0 * * * *` (top of every hour)
- Scheduled emails will be sent within ~1 hour of their scheduled time
- To process immediately during dev, call `GET /api/cron` with header `Authorization: Bearer dev-secret-change-in-production`

---

## Sharing With Your Team

Once deployed to Vercel, share the URL. Each team member signs up with their own account — all data is isolated per user. Each team member connects their own Gmail account in Settings.
