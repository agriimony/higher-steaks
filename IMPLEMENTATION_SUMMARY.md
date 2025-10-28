# Leaderboard Implementation Summary

## ✅ Completed Features

### 1. Database Integration
- **Vercel Postgres** setup and configuration
- **Database schema** created with `leaderboard_entries` table
- Stores top 100 HIGHER token holders with cast data
- Indexed for optimal query performance

### 2. API Endpoints

#### `/api/leaderboard/top` (GET)
- Fetches top 10 HIGHER holders from database
- Returns formatted data with USD values
- Used by frontend to populate menu

#### `/api/cron/update-leaderboard` (GET)
- Daily automated update via Vercel Cron (midnight UTC)
- Fetches casts from `/higher` channel via Neynar
- Filters for keyphrase: **"started aiming higher and it worked out!"**
- Extracts description from text after the "!"
- Calculates HIGHER balances for all verified addresses
- Fetches token price from CoinGecko
- Stores top 100 entries in database
- Protected by `CRON_SECRET` header

### 3. Frontend Updates

#### Dynamic Menu Display
- Loads leaderboard data on page mount
- Menu items show:
  - **Username** (bold, clickable → Warpcast profile)
  - **Cast description** (clickable → original cast)
  - **USD value** (right-aligned as price)
- Loading state with spinner
- Fallback to static menu if leaderboard is empty
- Fully responsive design

#### Token Balance Improvements
- Shortened large numbers with K/M/B suffixes
- Example: 1,234,567 → 1.23M

### 4. Documentation
- **DATABASE_SETUP.md**: Complete guide for Vercel Postgres setup
- **README.md**: Updated with new features and API documentation
- **f.plan.md**: Detailed implementation plan

## 📝 Next Steps for You

### 1. Enable Vercel Postgres
1. Go to https://vercel.com/dashboard
2. Select your `higher-steaks` project
3. Navigate to **Storage** tab
4. Create a new **Postgres** database
5. Database name: `higher-steaks-db`
6. Select your preferred region

**Environment variables are auto-added by Vercel:**
- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`

### 2. Run Database Schema
In Vercel dashboard → Storage → Your database → **Data** tab → **Query**:

```sql
-- Copy and paste contents of sql/schema.sql
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL UNIQUE,
  username VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  pfp_url TEXT,
  cast_hash VARCHAR(255) NOT NULL,
  cast_text TEXT NOT NULL,
  description TEXT NOT NULL,
  cast_timestamp TIMESTAMP NOT NULL,
  higher_balance NUMERIC(30, 18) NOT NULL,
  usd_value NUMERIC(15, 2),
  rank INTEGER,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_higher_balance ON leaderboard_entries(higher_balance DESC);
CREATE INDEX IF NOT EXISTS idx_rank ON leaderboard_entries(rank);
CREATE INDEX IF NOT EXISTS idx_fid ON leaderboard_entries(fid);
```

### 3. Add Cron Secret
In Vercel dashboard → **Settings** → **Environment Variables**:

**Name:** `CRON_SECRET`  
**Value:** Generate a random string (e.g., `openssl rand -hex 32` or use a password generator)  
**Environments:** Production, Preview, Development

### 4. Verify Environment Variables
Ensure these are set in Vercel:
- ✅ `NEYNAR_API_KEY` (already set)
- ✅ `BASE_RPC_URL` (optional, defaults to public RPC)
- ✅ `POSTGRES_URL` (auto-added)
- ✅ `POSTGRES_PRISMA_URL` (auto-added)
- ✅ `POSTGRES_URL_NON_POOLING` (auto-added)
- ✅ `CRON_SECRET` (manual - add this)

### 5. Deploy
The code is already pushed to GitHub. Vercel will automatically deploy with the new changes.

### 6. Manually Trigger First Cron Run
After deployment, manually populate the database:

```bash
curl -X GET https://higher-steaks.vercel.app/api/cron/update-leaderboard \
  -H "Authorization: Bearer YOUR_CRON_SECRET_HERE"
```

Replace `YOUR_CRON_SECRET_HERE` with the value you set in step 3.

### 7. Verify Leaderboard
Visit https://higher-steaks.vercel.app and you should see:
- Top 10 HIGHER holders as menu items
- Clickable usernames (→ Warpcast profiles)
- Clickable descriptions (→ original casts)
- USD values as prices

## 🔄 Automation

### Cron Schedule
The leaderboard updates **daily at midnight UTC** automatically via Vercel Cron.

Schedule is configured in `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/update-leaderboard",
    "schedule": "0 0 * * *"
  }]
}
```

### Keyphrase Extraction
**Target keyphrase:** `"started aiming higher and it worked out!"`

**Regex pattern:**
```javascript
/started\s+aiming\s+higher\s+and\s+it\s+worked\s+out!\s*(.+)/i
```

**Example cast:**
```
"started aiming higher and it worked out! by learning web3 every day"
```

**Extracted description:**
```
"by learning web3 every day"
```

## 📊 Data Flow

```
1. Cron triggers (midnight UTC)
   ↓
2. Fetch casts from /higher channel (Neynar)
   ↓
3. Filter for keyphrase
   ↓
4. Keep most recent cast per FID
   ↓
5. Get HIGHER balance (all verified addresses)
   ↓
6. Fetch token price (CoinGecko)
   ↓
7. Calculate USD value
   ↓
8. Store top 100 in Postgres
   ↓
9. Frontend fetches top 10
   ↓
10. Display as menu items
```

## 🎯 Technical Details

### Keyphrase Matching
- Case-insensitive search
- Flexible whitespace matching
- Extracts text **after** the "!" character
- Truncates to 120 characters for UI consistency

### Balance Calculation
- Queries all verified Ethereum addresses from Neynar
- Reads HIGHER token balance from Base network (contract: `0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe`)
- Sums balances across all addresses
- Uses CoinGecko API for price data (cached for 5 minutes)

### Database Storage
- Stores top 100 entries only (to keep database clean)
- Updates daily, replacing all entries
- Indexed by `higher_balance DESC` for fast queries
- Includes rank for future pagination features

## 📦 Packages Added
- `@vercel/postgres` - Database client for Vercel Postgres

## 🔒 Security
- Cron endpoint protected by `CRON_SECRET` header
- Vercel automatically includes this header for scheduled cron jobs
- Manual triggers require the secret in Authorization header

## 💡 Future Enhancements (Optional)
- Cache leaderboard results (5-10 min) to reduce database queries
- Show user's rank if they're in the leaderboard
- Pagination for viewing more than top 10
- Time-based filtering (e.g., "This week's leaders")
- Historical data tracking

## 🐛 Troubleshooting

### No data showing in menu
- Check if database has been initialized (run schema SQL)
- Manually trigger cron job to populate data
- Check Vercel function logs for errors

### Cron job failing
- Verify `CRON_SECRET` is set correctly
- Check Neynar API key is valid
- Ensure Postgres database is connected
- Check function logs in Vercel dashboard

### Build errors
- Run `npm run build` locally to test
- Check TypeScript errors in API routes
- Verify all environment variables are set

## 📚 Reference Files
- `DATABASE_SETUP.md` - Detailed database setup guide
- `README.md` - Updated project documentation
- `sql/schema.sql` - Database schema
- `vercel.json` - Cron job configuration
- `app/api/cron/update-leaderboard/route.ts` - Cron job logic
- `app/api/leaderboard/top/route.ts` - Leaderboard API
- `app/page.tsx` - Frontend menu display

---

**Status:** ✅ Implementation complete, ready for deployment!

**Your action:** Set up Vercel Postgres database and add `CRON_SECRET` environment variable, then manually trigger the first cron run.

