# Higher Steaks

A Farcaster Mini App for the higher network discovery. This Mini App can be embedded and used within Farcaster clients.

## Features

- 🍖 Premium steak menu interface
- 🔐 Farcaster MiniApp SDK integration
- 🎨 Modern, responsive design
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

Create a `.env.local` file:

```env
NEYNAR_API_KEY=your_neynar_api_key_here
```

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

- `POST /api/ingest/higher` - Fetch matching casts from /higher channel
- `GET /api/ingest/higher` - Get recent matching casts
- `GET /api/ingest/higher/stream` - Stream matching casts in real-time

## Development

See https://miniapps.farcaster.xyz for Mini App documentation.

