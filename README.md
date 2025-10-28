# Higher Steaks

A Farcaster Mini App for the higher network discovery. This Mini App can be embedded and used within Farcaster clients.

## Features

- 🍖 Premium steak menu interface
- 🔐 Farcaster MiniApp SDK integration with Quick Auth
- 👤 User profile display (FID, username, pfp, wallet address)
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
NEYNAR_API_KEY=your_neynar_api_key_here
```

**Get your Neynar API key:**
1. Visit [https://neynar.com](https://neynar.com)
2. Sign up or log in
3. Generate an API key from your dashboard

**Note:** The app will work without the Neynar API key, but will display mock user data. Add the key to fetch real Farcaster profile information.

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

### User Authentication
- `POST /api/user/profile` - Fetch authenticated user's Farcaster profile
  - Requires Quick Auth JWT token in request body
  - Returns: FID, username, display name, pfp URL, wallet address

### Data Ingestion
- `POST /api/ingest/higher` - Fetch matching casts from /higher channel
- `GET /api/ingest/higher` - Get recent matching casts
- `GET /api/ingest/higher/stream` - Stream matching casts in real-time

## Development

See https://miniapps.farcaster.xyz for Mini App documentation.

