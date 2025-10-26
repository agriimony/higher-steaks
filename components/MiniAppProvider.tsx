'use client';

import { useEffect } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

export function MiniAppProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize MiniApp SDK - call ready() to hide splash
    const initSDK = async () => {
      try {
        await sdk.actions.ready();
        console.log('✅ MiniApp SDK initialized and ready');
      } catch (error) {
        console.error('❌ Failed to initialize MiniApp SDK:', error);
        // In browser, SDK might not be available, which is OK
      }
    };

    initSDK();
  }, []);

  return <>{children}</>;
}

