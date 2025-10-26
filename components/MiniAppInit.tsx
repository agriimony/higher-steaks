'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

export function MiniAppInit() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const initSDK = async () => {
      try {
        // Call ready() to hide the splash screen
        await sdk.actions.ready();
        setIsReady(true);
        console.log('✅ MiniApp SDK initialized and ready');
      } catch (error) {
        console.error('❌ Failed to initialize MiniApp SDK:', error);
        // Still mark as ready to show UI in browser
        setIsReady(true);
      }
    };

    initSDK();
  }, []);

  // Show loading state until SDK is ready
  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-sm text-gray-600">Loading Higher Steaks...</p>
        </div>
      </div>
    );
  }

  return null;
}

