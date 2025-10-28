<!-- 07efca8e-3b09-45c7-917e-a6f315a8944f ff7dc439-bd08-47d1-b28e-aa63f5bb4391 -->
# Leaderboard Database & Daily Ingestion System

## Overview

Create a leaderboard that ingests Farcaster casts from /higher channel daily, stores them with user HIGHER token balances, and displays top 10 holders as menu items.

## 1. Database Solution Recommendation

### Option A: Vercel Postgres (Recommended)

**Pros:**

- Native Vercel integration
- Auto-scaling
- Free tier: 256 MB storage, 60 hours compute/month
- Perfect for serverless Next.js apps
- Built on Neon (reliable Postgres provider)

**Cons:**

- Paid beyond free tier

### Option B: Supabase (Alternative)

**Pros:**

- Generous free tier (500 MB database, 2GB bandwidth)
- Full Postgres with real-time features
- Easy-to-use dashboard
- Free tier doesn't expire

**Cons:**

- Separate service (not Vercel native)

### Recommendation: **Vercel Postgres**

- Seamless integration with your existing Vercel deployment
- Edge-compatible for fast queries
- Simple setup with `@vercel/postgres` package

## 2. Database Schema

```sql
CREATE TABLE leaderboard_entries (
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

CREATE INDEX idx_higher_balance ON leaderboard_entries(higher_balance DESC);
CREATE INDEX idx_rank ON leaderboard_entries(rank);
CREATE INDEX idx_fid ON leaderboard_entries(fid);
```

**New Fields:**

- `description`: Text after "started aiming higher and it worked out" (extracted from cast)
- `rank`: Cached rank for faster queries (updated during cron)

## 3. Daily Ingestion Cron Job

**File**: `app/api/cron/update-leaderboard/route.ts`

### Flow:

1. Fetch casts from /higher channel via Neynar API
2. Filter for specific keyphrase (e.g., "gm higher" or "#higher")
3. For each unique FID (most recent cast only):

                                - Get user's total HIGHER balance from existing `/api/user/balance` endpoint
                                - Calculate USD value
                                - Upsert into database

4. Clean up old entries (optional: keep only top 100)

### Vercel Cron Configuration

**File**: `vercel.json`

```json
{
  "crons": [{
    "path": "/api/cron/update-leaderboard",
    "schedule": "0 0 * * *"
  }]
}
```

- Runs daily at midnight UTC
- Protected by Vercel cron secret header

## 4. Frontend Integration

### API Route: `/api/leaderboard/top`

**Returns:**

```json
{
  "entries": [
    {
      "rank": 1,
      "username": "dwr",
      "displayName": "Dan Romero",
      "pfpUrl": "...",
      "castText": "gm higher! building the future",
      "castHash": "0x...",
      "higherBalance": "1234567.89",
      "usdValue": "$1,851.23",
      "fid": 3
    }
  ]
}
```

### Update Menu Display

Replace static menu items with leaderboard data:

- **Dish Name**: `@username` (bold, clickable → Warpcast profile)
- **Description**: Cast text (normal font, truncated to ~100 chars)
- **Price**: USD value (right-aligned)

**Example:**

```
@dwr ................................... $1,851.23
gm higher! building the future

@v ...................................... $1,234.56
higher is the future of social
```

## 5. Environment Variables

Add to Vercel:

```env
NEYNAR_API_KEY=existing_key
POSTGRES_URL=postgres://...
POSTGRES_PRISMA_URL=postgres://...
POSTGRES_URL_NON_POOLING=postgres://...
CRON_SECRET=random_secret_key
```

## 6. Implementation Steps

### Phase 1: Database Setup

1. Enable Vercel Postgres in dashboard
2. Install `@vercel/postgres` package
3. Create database schema
4. Create migration file

### Phase 2: Leaderboard API

1. Create `/api/leaderboard/top` endpoint
2. Query top 10 users by HIGHER balance
3. Return formatted data

### Phase 3: Cron Job

1. Create `/api/cron/update-leaderboard` endpoint
2. Fetch casts from Neynar (/higher channel)
3. Filter by keyphrase
4. Get balances for each user
5. Upsert to database
6. Add cron config to `vercel.json`

### Phase 4: Frontend Update

1. Replace static menuItems with API call
2. Fetch from `/api/leaderboard/top` on mount
3. Format as menu: username (link) | cast text | USD value
4. Add loading state
5. Truncate long cast text

## 7. Keyphrase Extraction

**Keyphrase**: `"started aiming higher and it worked out!"`

**Regex Pattern** (case-insensitive, flexible matching):

```javascript
/started\s+aiming\s+higher\s+and\s+it\s+worked\s+out!\s*(.+)/i
```

**Extraction Logic:**

1. Match cast text against pattern
2. Extract everything AFTER the "!" as description
3. Truncate to ~100-120 characters for UI
4. Clean up leading/trailing whitespace

**Example:**

- Cast: "started aiming higher and it worked out! by building cool stuff"
- Description: "by building cool stuff"

**Handling embeds:**

- Only use `text` field from cast
- Ignore `embeds` array (images, URLs, frames)
- Users can click to see full cast with embeds on Warpcast

## 8. Additional Features

### Nice-to-haves:

- Cache leaderboard results (5-10 min)
- Show user's rank if they're in leaderboard
- Pagination for more than top 10
- Time-based filtering (e.g., "This week's leaders")

## 9. Cost Estimate

**Vercel Postgres Free Tier:**

- 256 MB storage ≈ 100k+ entries
- 60 hours compute/month
- Likely sufficient for this use case

**If exceeding free tier:**

- Pro tier: $20/month includes more compute
- Only needed if traffic is very high

## Data Flow

```
Daily Cron (midnight UTC)
    ↓
Fetch /higher casts (Neynar)
    ↓
Filter by keyphrase
    ↓
For each unique FID:
 - Get most recent cast
 - Fetch HIGHER balance
 - Calculate USD value
    ↓
Upsert to Postgres
    ↓
User visits site
    ↓
Fetch top 10 from DB
    ↓
Display as menu items
```

## Questions for Implementation

1. **Keyphrase**: What phrase should we filter for in casts?
2. **Time range**: How far back should we look for casts? (last 24h, 7 days, all time?)
3. **Leaderboard size**: Store top 100 or all matching users?
4. **Update frequency**: Daily at midnight, or more frequent?

### To-dos

- [ ] Enable Vercel Postgres and configure environment variables
- [ ] Install @vercel/postgres package
- [ ] Create database schema and migration for leaderboard_entries table
- [ ] Create /api/leaderboard/top endpoint to query top 10 users
- [ ] Create /api/cron/update-leaderboard endpoint for daily ingestion
- [ ] Fetch /higher channel casts from Neynar and filter by keyphrase
- [ ] Get HIGHER balance for each user and calculate USD value
- [ ] Upsert leaderboard entries to database (one per FID)
- [ ] Create vercel.json with cron schedule configuration
- [ ] Replace static menu items with leaderboard data
- [ ] Make usernames clickable links to Warpcast profiles
- [ ] Add loading state for leaderboard data
- [ ] Test cron endpoint manually before deploying