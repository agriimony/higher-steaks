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

# Optional: Base RPC URL (defaults to public RPC)
BASE_RPC_URL=https://mainnet.base.org

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

### Cron Jobs
- `GET /api/cron/update-leaderboard` - Daily leaderboard update (Vercel Cron)
  - Runs at midnight UTC
  - Fetches /higher channel casts with keyphrase "started aiming higher and it worked out!"
  - Calculates HIGHER balances and USD values
  - Stores top 100 entries in database
  - Protected by `CRON_SECRET` header

## Development

See https://miniapps.farcaster.xyz for Mini App documentation.

