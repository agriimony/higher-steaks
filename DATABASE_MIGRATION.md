# Database Migration Guide

This guide explains how to update your Neon/Vercel Postgres database to the new cast-based schema.

## Why Migrate?

The database schema was recently updated to support a cast-based leaderboard instead of a user-based one. The new schema:
- Stores one row per cast (instead of one per user)
- Uses `cast_hash` as the primary key
- Supports multiple casts per creator
- Includes staker information for each cast

## Step 1: Access Your Neon Database

### Option A: Using Vercel Dashboard (Recommended)

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your **higher-steaks** project
3. Click on the **Storage** tab
4. Click on your database to open it
5. Click on the **Data** tab
6. Click **Query** to open the SQL editor

### Option B: Using Neon Console

1. Go to [Neon Console](https://console.neon.tech)
2. Log in with your Neon account
3. Select your **higher-steaks** database

### Option C: Using Local psql

```bash
# Connect using the non-pooling URL
psql "$POSTGRES_URL_NON_POOLING"
```

## Step 2: Backup Your Data (Important!)

**⚠️ WARNING: This migration will DELETE all existing data!**

If you have important data you want to keep:

```sql
-- Export current data to CSV (run in psql or SQL editor)
\copy (SELECT * FROM leaderboard_entries) TO '/path/to/backup.csv' CSV HEADER;
```

Or in Vercel Dashboard:
1. Go to **Storage** → **Data** tab
2. Click **Export** (if available)
3. Save the CSV file

## Step 3: Run the Migration

### Using Vercel Dashboard

1. Open the **Query** editor in Vercel
2. Copy the contents of `sql/migration_to_cast_based.sql`
3. Paste into the query editor
4. Click **Run Query**

### Using Neon Console

1. Open the **SQL Editor**
2. Copy the contents of `sql/migration_to_cast_based.sql`
3. Paste into the editor
4. Click **Run** or press `Ctrl+Enter` / `Cmd+Enter`

### Using psql

```bash
psql "$POSTGRES_URL_NON_POOLING" -f sql/migration_to_cast_based.sql
```

## Step 4: Verify the Migration

Run this query to verify the new schema:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'leaderboard_entries'
ORDER BY ordinal_position;
```

You should see these columns:
- `id` (integer)
- `cast_hash` (varchar)
- `creator_fid` (integer)
- `creator_username` (varchar)
- `creator_display_name` (varchar)
- `creator_pfp_url` (text)
- `cast_text` (text)
- `description` (text)
- `cast_timestamp` (timestamp)
- `total_higher_staked` (numeric)
- `staker_fids` (integer array)
- `usd_value` (numeric)
- `rank` (integer)
- `updated_at` (timestamp)

## Step 5: Populate Initial Data

After running the migration, trigger the cron job to populate the leaderboard:

```bash
curl -X GET "https://YOUR_DOMAIN.vercel.app/api/cron/update-staking-leaderboard" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Replace:
- `YOUR_DOMAIN` with your Vercel domain
- `YOUR_CRON_SECRET` with your actual cron secret

## Troubleshooting

### "Permission denied" error

Make sure you're using the **non-pooling** URL (`POSTGRES_URL_NON_POOLING`) for schema changes. Pooled connections may restrict DDL operations.

### "Table doesn't exist" error

This is normal! The migration script drops the old table first. Just continue running the script.

### Data is still missing after migration

The migration creates an empty table. You need to run the cron job to populate it with data from the blockchain.

### Need to rollback?

If you backed up your data (Step 2), you can restore it. However, the old schema won't work with the new code. You'd need to either:
1. Revert the code changes, or
2. Write a custom migration script to convert between schemas

## Next Steps

After completing the migration:

1. ✅ Verify the new schema is in place
2. ✅ Run the cron job to populate data
3. ✅ Test the app to ensure everything works
4. ✅ Monitor the leaderboard for a day to ensure updates are working

## Questions?

If you run into issues during migration, check:
- The migration script in `sql/migration_to_cast_based.sql`
- Your database connection strings in Vercel environment variables
- The cron job logs in Vercel Functions tab
