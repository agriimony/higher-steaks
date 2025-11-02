<!-- 49fd1013-f7f3-46b8-9624-fb8be6365a67 bdf431da-dd89-49df-8db0-4ef33624f826 -->
# Onboarding Modal Redesign - Cast-First Flow

## Overview

Redesign the onboarding modal to focus on casts as the primary entity. Users stake HIGHER on their casts, and the leaderboard ranks casts by total HIGHER staked (one cast per creator).

## Database Schema Changes

**File**: `sql/schema.sql`

Update schema to track casts instead of users:

```sql
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id SERIAL PRIMARY KEY,
  cast_hash VARCHAR(255) NOT NULL UNIQUE,
  creator_fid INTEGER NOT NULL,
  creator_username VARCHAR(255) NOT NULL,
  creator_display_name VARCHAR(255),
  creator_pfp_url TEXT,
  cast_text TEXT NOT NULL,
  description TEXT NOT NULL,
  cast_timestamp TIMESTAMP NOT NULL,
  total_higher_staked NUMERIC(30, 18) NOT NULL,
  staker_fids INTEGER[] NOT NULL DEFAULT '{}',
  usd_value NUMERIC(15, 2),
  rank INTEGER,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_total_higher_staked ON leaderboard_entries(total_higher_staked DESC);
CREATE INDEX IF NOT EXISTS idx_rank ON leaderboard_entries(rank);
CREATE INDEX IF NOT EXISTS idx_cast_hash ON leaderboard_entries(cast_hash);
CREATE INDEX IF NOT EXISTS idx_creator_fid ON leaderboard_entries(creator_fid);
```

**Key Changes**:

- Primary key is `cast_hash` (unique per cast)
- `creator_fid` stores cast author
- `total_higher_staked` aggregates all lockups with this cast_hash in title
- `staker_fids` array tracks all FIDs who have staked on this cast
- Ranking is by `total_higher_staked` descending, limited to best cast per creator_fid

## API Changes

### 1. Update Balance API

**File**: `app/api/user/balance/route.ts`

- Already returns `title` field in lockup data (no changes needed)

### 2. Create User Casts API

**File**: `app/api/user/casts/route.ts` (new file)

- Accept `fid` query param
- Query database: `SELECT * FROM leaderboard_entries WHERE creator_fid = $1 ORDER BY total_higher_staked DESC LIMIT 1`
- If found, return cast data with rank and staked amount
- If not found, fallback to Neynar:
  - Fetch user's casts via `fetchCastsForUser()` limit 25
  - Filter for /higher channel + keyphrase regex
  - Return most recent match: `{hasCast: true/false, hash?, text?, description?, timestamp?, totalStaked: 0, rank: null}`

### 3. Redesign Leaderboard Cron Job

**File**: `app/api/cron/update-staking-leaderboard/route.ts`

**New Flow**:

1. Get all HIGHER lockup IDs via `getLockUpIdsByToken(HIGHER_TOKEN, 1, totalLockups)`
2. Fetch each lockup's details (amount, receiver, title)
3. Skip if `unlocked === true` or `title` is empty/invalid cast hash format
4. Aggregate by cast_hash: 

   - Sum all lockup amounts per cast_hash
   - Collect all unique receiver addresses per cast_hash

5. For each cast_hash, fetch cast details from Neynar (`lookupCastByHashOrWarpcastUrl`)
6. Map receiver addresses to FIDs via Neynar (`fetchBulkUsersByEthereumAddress`)
7. Validate cast has keyphrase via regex
8. Get HIGHER price from CoinGecko
9. Build cast entries with: cast_hash, creator_fid, creator metadata, cast_text, description, timestamp, total_higher_staked, staker_fids[], usd_value
10. Rank by total_higher_staked DESC, keeping only highest-staked cast per creator_fid
11. Upsert to database via `INSERT ... ON CONFLICT (cast_hash) DO UPDATE`

## Frontend Changes

### 1. Add Floating Action Button

**File**: `app/page.tsx`

- Add circular "+" FAB button (bottom right, can overlap menu slightly)
- Position: `fixed bottom-6 right-6 z-50`
- Opens onboarding modal on click
- Keep existing balance pill click behavior

### 2. Redesign OnboardingModal

**File**: `components/OnboardingModal.tsx`

**New Props**:

```typescript
interface OnboardingModalProps {
  onClose: () => void;
  userFid: number;
  castData: {
    hasCast: boolean;
    hash?: string;
    text?: string;
    description?: string;
    timestamp?: string;
    totalStaked: number;
    rank: number | null;
  } | null;
}
```

**UI States**:

**State A: No Cast Found**

- Header: "How are you aiming higher today?"
- Keyphrase (unchangeable): "started aiming higher and it worked out!"
- Textbox for user's description
- Button: "Cast to /higher" → calls `sdk.actions.composeCast()`

**State B: Cast Found**

- Header: "You are aiming higher!"
- Display cast: keyphrase in **bold**, description, timestamp (faded)
- Display leaderboard rank: "Rank: #{rank}" or "Unranked" if null
- Display total staked: "{totalStaked} HIGHER staked on this cast"
- Two buttons:
  - "Add stake": Opens inline staking form (not full modal)
    - Amount input + duration selector
    - Uses `StakingModal` logic but passes `castHash` to `createLockUp` title field
  - "Buy HIGHER": Calls `sdk.actions.swapToken()`

### 3. Update StakingModal

**File**: `components/StakingModal.tsx`

- Remove all staking functionality (amount input, duration selector, approve/createLockUp transactions)
- Keep only unstaking functionality for expired lockups
- Staking will now only happen through OnboardingModal's inline form

### 4. Update Main Page Integration

**File**: `app/page.tsx`

- On mount, fetch `/api/user/casts?fid=${user.fid}` for cast data
- Pass cast data to `OnboardingModal`
- Refresh cast data after successful stake transaction

## Implementation Order

1. Update database schema (`sql/schema.sql`)
2. Redesign cron job (`app/api/cron/update-staking-leaderboard/route.ts`)
3. Create user casts API (`app/api/user/casts/route.ts`)
4. Update `StakingModal` to accept `castHash` prop
5. Redesign `OnboardingModal` component
6. Add FAB button and integrate new modal in `app/page.tsx`
7. Test full flow: cast → stake → leaderboard update

### To-dos

- [ ] Update Balance API to include title field in lockup details
- [ ] Create new /api/user/casts endpoint to fetch user's /higher casts with keyphrase
- [ ] Add floating action button (FAB) to bottom-right of main page
- [ ] Redesign OnboardingModal with cast-first flow, inline staking, and cast display
- [ ] Update leaderboard cron to aggregate by cast hash instead of just FID
- [ ] Update page.tsx to integrate FAB trigger and pass data to OnboardingModal
- [ ] Test complete flow: FAB → cast creation → staking with cast hash → leaderboard