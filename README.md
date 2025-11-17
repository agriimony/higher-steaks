# Higher Steaks

A Farcaster Mini App for the higher network discovery. This Mini App can be embedded and used within Farcaster clients.

## Features

- 🍖 Premium steak menu interface with dynamic leaderboard
- 🔐 Farcaster MiniApp SDK integration with Quick Auth
- 👤 User profile display (FID, username, pfp, wallet address)
- 💰 HIGHER token balance tracking across verified addresses
- 🏆 Live leaderboard from /higher channel casts
- 📊 Real-time USD value conversion via CoinGecko
- 🔄 Daily automated updates via Vercel Cron
- 🗄️ Vercel Postgres database integration
- 🎨 Modern, responsive design optimized for 424px modal
- 📐 3:2 aspect ratio embed images
- 🔴 Real-time blockchain event monitoring via CDP Webhooks
- ⚡ Instant UI updates when users stake tokens

## Setup

### Prerequisites
- Node.js 22.11.0 or higher
- npm, pnpm, or yarn

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# Required: Neynar API Key
NEYNAR_API_KEY=your_neynar_api_key_here

# Required: Dune API Key (off-chain indexer)
DUNE_API_KEY=your_dune_api_key_here

# Optional: Alchemy API Key (recommended for production, provides robust RPC with higher rate limits)
ALCHEMY_API_KEY=your_alchemy_api_key_here

# Optional: Base RPC URL (fallback if ALCHEMY_API_KEY not set, defaults to public RPC)
BASE_RPC_URL=https://mainnet.base.org

# Required for Production: CDP (Coinbase Developer Platform) API keys for webhook event monitoring
CDP_API_KEY_ID=your_cdp_api_key_id
CDP_API_KEY_SECRET=your_cdp_api_key_secret
# Each webhook subscription has its own secret from metadata.secret in the creation response
CDP_WEBHOOK_SECRET_LOCKUP=secret_from_lockup_webhook_subscription
CDP_WEBHOOK_SECRET_TRANSFER=secret_from_transfer_webhook_subscription

# Required for Production: Vercel Postgres (auto-added by Vercel)
POSTGRES_URL=postgres://...
POSTGRES_PRISMA_URL=postgres://...
POSTGRES_URL_NON_POOLING=postgres://...

# Required for Production: Cron job authentication
CRON_SECRET=your_random_secret_here
```

**Get your Neynar API key:**
1. Visit [https://neynar.com](https://neynar.com)
2. Sign up or log in
3. Generate an API key from your dashboard

**Get your Alchemy API key (recommended for production):**
1. Visit [https://www.alchemy.com](https://www.alchemy.com)
2. Sign up or log in
3. Create a new app on **Base Mainnet**
4. Copy your API key from the app dashboard
5. The endpoint format is: `https://base-mainnet.g.alchemy.com/v2/{YOUR_API_KEY}`
6. Alchemy provides better rate limits, reliability, and supports optimized batch requests

**Get your CDP (Coinbase Developer Platform) API keys:**
1. Visit [https://portal.cdp.coinbase.com](https://portal.cdp.coinbase.com)
2. Sign up or log in
3. Create a Secret API Key from the API Keys dashboard
4. Save the API Key ID and Secret securely
5. Configure webhook subscriptions (see [CDP Webhooks documentation](https://docs.cdp.coinbase.com/data/webhooks/quickstart))
6. Set `CDP_WEBHOOK_SECRET` to the secret value provided when creating each webhook subscription

**Vercel Postgres Setup:**
See [DATABASE_SETUP.md](./DATABASE_SETUP.md) for detailed database configuration instructions.

### Development

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### Build

```bash
npm run build
npm start
```

## Mini App Integration

This app uses the [@farcaster/miniapp-sdk](https://github.com/farcasterxyz/miniapps) for integration with Farcaster clients.

### Key Features
- **Quick Auth**: Authenticate users with Farcaster
- **MiniApp Embeds**: Share rich embeds in casts
- **SDK Actions**: Interactive features with the client

## Deployment

The app is configured for deployment on Vercel:

```bash
npm run build
```

## API Routes

### User Profile & Balance
- `GET /api/user/profile?fid={fid}` - Fetch Farcaster user profile via Neynar
  - Returns: FID, username, display name, pfp URL, verified addresses
  
- `GET /api/user/balance?fid={fid}` - Get total HIGHER token balance
  - Queries all verified addresses on Base network
  - Returns: Total balance, formatted balance, USD value, price per token

### Leaderboard
- `GET /api/leaderboard/top` - Get top 10 HIGHER holders from leaderboard
  - Returns: FID, username, cast text, description, HIGHER balance, USD value

### User Stakes (Dune-backed)
- `GET /api/user/stakes?fid={fid}&connectedAddress={addr}&offset={offset}`
  - Filters Dune results server-side with `(unlocked = false) AND (receiver IN (...))`
  - Applies modal-specific sorting rules server-side
  - Paginates 3 items at a time; returns `{ items, nextOffset }`
- `POST /api/user/lockup/unlock`
  - Body: `{ castHash, lockUpId, stakeType }`
  - Marks the lockup’s unlocked flag in HS DB after a successful unstake

### Cron Jobs
- `GET /api/cron/update-staking-leaderboard` - Daily leaderboard update (Vercel Cron)
  - Runs every 24 hours (midnight UTC recommended)
  - Aggregates HIGHER token lockups from Dune latest query results (off-chain indexer)
  - Fetches missing cast owners and wallet associations via Neynar when needed
  - Stores/updates aggregated entries in database
  - Protected by `CRON_SECRET` header

### Real-time Features
- **WebSocket Subscriptions**: Monitors Base blockchain for new lockup events and block headers
- **Instant Updates**: UI refreshes automatically when users stake tokens (when connected via Wagmi)
- **Block Freshness Indicator**: Visual indicator showing data synchronization status

## Development

See https://miniapps.farcaster.xyz for Mini App documentation.

## Dune Integration (Off-chain Indexer)

The backend ingests lockup data from Dune and serves the frontend from the HS database.

- Dune docs: https://docs.dune.com/api-reference/overview/introduction
- Latest query result API: https://docs.dune.com/api-reference/executions/endpoint/get-query-result

### Daily Sync (24h)

- The existing cron (`/api/cron/update-staking-leaderboard`) now uses Dune’s latest query results (ID: 6214515) instead of onchain reads.
- Set your scheduler (e.g., Vercel Cron) to invoke once every 24 hours.

### Data Model Updates

The `leaderboard_entries` table includes lock time arrays:

- `caster_stake_lock_times bigint[]`
- `supporter_stake_lock_times bigint[]`

Apply SQL migrations in `sql/` directory.

