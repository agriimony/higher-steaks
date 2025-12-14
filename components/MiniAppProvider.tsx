'use client';

import { MiniAppProvider as NeynarMiniAppProvider } from '@neynar/react';

export function MiniAppProvider({ children }: { children: React.ReactNode }) {
  // Use Neynar's MiniAppProvider for notification support
  return <NeynarMiniAppProvider>{children}</NeynarMiniAppProvider>;
}

