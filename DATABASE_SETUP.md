# Database Setup Guide

This guide explains how to set up Vercel Postgres for the Higher Steaks leaderboard system.

## Step 1: Enable Vercel Postgres

1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Select your **higher-steaks** project
3. Click on the **Storage** tab
4. Click **Create Database**
5. Select **Postgres** (powered by Neon)
6. Choose a database name (e.g., `higher-steaks-db`)
7. Select your region (closest to your users)
8. Click **Create**

## Step 2: Copy Environment Variables

After creating the database, Vercel will show you environment variables:

```
POSTGRES_URL="..."
POSTGRES_PRISMA_URL="..."
POSTGRES_URL_NON_POOLING="..."
POSTGRES_USER="..."
POSTGRES_HOST="..."
POSTGRES_PASSWORD="..."
POSTGRES_DATABASE="..."
```

These are **automatically added** to your Vercel project.

For local development:
1. Copy the `.env.local.example` template (if you have one)
2. Or create `.env.local` and add:

```env
POSTGRES_URL="postgres://..."
POSTGRES_PRISMA_URL="postgres://..."
POSTGRES_URL_NON_POOLING="postgres://..."
```

## Step 3: Run Database Schema

### Option A: Using Vercel Dashboard (Recommended)

1. In your Vercel dashboard, go to **Storage** → Your database
2. Click on the **Data** tab
3. Click **Query**
4. Copy and paste the contents of `sql/schema.sql`
5. Click **Run Query**

### Option B: Using Local psql CLI

```bash
# Install psql if needed (comes with PostgreSQL)
psql "$POSTGRES_URL" -f sql/schema.sql
```

## Step 4: Add Cron Secret

For security, add a cron secret to protect the update endpoint:

1. In Vercel dashboard → **Settings** → **Environment Variables**
2. Add a new variable:
   - **Name**: `CRON_SECRET`
   - **Value**: Generate a random string (e.g., using `openssl rand -hex 32`)
   - **Environments**: Production, Preview, Development

## Step 5: Verify Environment Variables

Ensure these environment variables are set in Vercel:

- ✅ `NEYNAR_API_KEY` - Your Neynar API key
- ✅ `BASE_RPC_URL` - Base network RPC (optional, defaults to public RPC)
- ✅ `POSTGRES_URL` - Auto-added by Vercel
- ✅ `POSTGRES_PRISMA_URL` - Auto-added by Vercel
- ✅ `POSTGRES_URL_NON_POOLING` - Auto-added by Vercel
- ✅ `CRON_SECRET` - Manual (for cron job authentication)

## Step 6: Deploy

```bash
git add .
git commit -m "Add leaderboard database and cron job"
git push
```

Vercel will automatically deploy with the new database connection.

## Step 7: Test Cron Job Manually

You can manually trigger the cron job to populate the database:

```bash
curl -X GET https://higher-steaks.vercel.app/api/cron/update-staking-leaderboard \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Replace `YOUR_CRON_SECRET` with the value you set in Step 4.

## Cron Schedule

The leaderboard automatically updates daily at **midnight UTC** (00:00).

You can change this in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/update-staking-leaderboard",
      "schedule": "0 0 * * *"  // Cron expression
    }
  ]
}
```

**Common schedules:**
- `0 0 * * *` - Daily at midnight UTC
- `0 */6 * * *` - Every 6 hours
- `0 12 * * *` - Daily at noon UTC

## Monitoring

### Check Database

1. Go to Vercel dashboard → **Storage** → Your database
2. Click **Data** tab
3. Run query: `SELECT * FROM leaderboard_entries ORDER BY rank LIMIT 10;`

### Check Cron Logs

1. Go to Vercel dashboard → Your deployment
2. Click **Functions** tab
3. Find `/api/cron/update-staking-leaderboard`
4. View logs for execution status

## Troubleshooting

### Database not found error

- Ensure `POSTGRES_URL` is set correctly
- Verify the database was created in Vercel

### Cron job 401 Unauthorized

- Check that `CRON_SECRET` matches in both the request and environment variables
- Vercel's cron jobs automatically include the correct header

### No data in leaderboard

- Run the cron job manually to populate initial data
- Check Neynar API is returning casts from /higher channel
- Verify users have matching casts with the keyphrase

### Rate limiting from CoinGecko

- The code includes a 5-minute cache for token prices
- CoinGecko free tier allows ~10-50 calls/minute
- Daily updates should be well within limits

## Data Flow

```
1. Cron triggers daily (midnight UTC)
   ↓
2. Fetch casts from /higher channel (Neynar)
   ↓
3. Filter for keyphrase: "started aiming higher and it worked out!"
   ↓
4. Get HIGHER token balance for each user
   ↓
5. Calculate USD value (CoinGecko price)
   ↓
6. Store top 100 in Postgres
   ↓
7. Frontend fetches top 10 on page load
```

## Cost Estimate

**Vercel Postgres Free Tier:**
- 256 MB storage
- 60 hours compute/month
- ~100k+ rows capacity

**For this project:**
- Storing 100 entries ≈ 50 KB
- Daily updates use minimal compute
- Well within free tier limits

If you exceed free tier, Vercel Pro ($20/month) includes more resources.

