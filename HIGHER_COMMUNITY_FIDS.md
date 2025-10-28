# HIGHER Community FIDs

This file contains a curated list of Farcaster FIDs for active members of the /higher community. The cron job uses this list to fetch and filter casts since free-tier Neynar doesn't support channel feed queries.

## How to Add More FIDs

1. Visit https://warpcast.com/~/channel/higher
2. Find active members who post frequently
3. Click on their profile → Look at the URL: `warpcast.com/username`
4. Use Neynar to get their FID: `https://api.neynar.com/v2/farcaster/user/by_username?username=USERNAME`
5. Add the FID to the list in `app/api/cron/update-leaderboard/route.ts`

## Current Seed List

```javascript
const knownHigherFids = [
  3,      // dwr - Farcaster co-founder
  2,      // v - Farcaster co-founder
  239,    // composta
  602,    // wake
  1231,   // jayme
  15971,  // ted
  // Add more here as you discover active members
];
```

## Alternative: Dynamic Discovery

For a more automated approach (requires some manual work initially):

1. **Manual seeding**: Start with 10-20 known active members
2. **Expand organically**: When processing casts, track new FIDs that appear
3. **Store in database**: Create a `community_members` table
4. **Auto-update**: Add new FIDs when they post matching casts
5. **Prune inactive**: Remove FIDs that haven't posted in 30+ days

## Scaling

As the list grows:
- Batch FID requests (10-20 at a time)
- Cache results for 5-10 minutes
- Only fetch from most active members daily
- Use incremental updates (not full scans)

## Notes

- Free tier allows ~100 requests/day comfortably
- Each FID costs 1 API call (fetchCastsForUser)
- Start with 20-30 FIDs, expand gradually
- Focus on quality over quantity

