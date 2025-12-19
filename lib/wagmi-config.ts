'use client';

import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';

// Get RPC URL with fallbacks
const getRpcUrl = (): string => {
  // Priority 1: Alchemy (most reliable)
  if (process.env.ALCHEMY_API_KEY) {
    return `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  }
  
  // Priority 2: Coinbase CDP
  if (process.env.NEXT_PUBLIC_CDP_RPC_CLIENT_KEY) {
    return `https://api.developer.coinbase.com/rpc/v1/base/${process.env.NEXT_PUBLIC_CDP_RPC_CLIENT_KEY}`;
  }
  
  // Priority 3: Custom Base RPC URL
  if (process.env.NEXT_PUBLIC_BASE_RPC_URL) {
    return process.env.NEXT_PUBLIC_BASE_RPC_URL;
  }
  
  // Fallback: Public Base RPC (explicitly specified for better error messages)
  return 'https://mainnet.base.org';
};

export const wagmiConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(getRpcUrl(), {
      batch: {
        wait: 10,
      },
      retryCount: 3,
      retryDelay: 1000,
    }),
  },
  connectors: [
    farcasterMiniApp(),
  ],
});