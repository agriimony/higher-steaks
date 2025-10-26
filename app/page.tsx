'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

interface User {
  fid: number;
  username?: string;
}

export default function HigherSteakMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [menuItems] = useState([
    { name: "The Ribeye Supreme", price: "$48.00" },
    { name: "Filet Mignon Deluxe", price: "$52.00" },
    { name: "New York Strip Classic", price: "$44.00" },
    { name: "Porterhouse for Two", price: "$89.00" },
    { name: "Wagyu Sirloin Experience", price: "$76.00" },
    { name: "Grilled Salmon Steak", price: "$38.00" },
    { name: "Bone-In Tomahawk", price: "$95.00" },
    { name: "Surf & Turf Combo", price: "$68.00" },
    { name: "Prime Skirt Steak", price: "$36.00" },
    { name: "Vegetarian Portobello Stack", price: "$28.00" },
  ]);

  useEffect(() => {
    // IMPORTANT: Call ready() FIRST to hide splash screen immediately
    const hideSplash = async () => {
      try {
        await sdk.actions.ready();
        console.log('✅ Splash screen hidden');
      } catch (error) {
        console.log('Not in Farcaster client - ready() failed:', error);
      }
    };

    // Hide splash immediately
    hideSplash();

    // Then try to authenticate (this can happen after splash is hidden)
    const authenticate = async () => {
      try {
        const { token } = await sdk.quickAuth.getToken();
        console.log('✅ Authenticated with Farcaster');
        setUser({ fid: 1234 });
      } catch (error) {
        console.log('No authentication available');
      }
    };

    authenticate();
  }, []);

  const handleGetToken = async () => {
    try {
      const { token } = await sdk.quickAuth.getToken();
      console.log('Token:', token);
      alert(`Authenticated! Token: ${token.substring(0, 20)}...`);
    } catch (error) {
      console.error('Auth error:', error);
    }
  };

  return (
    <main className="min-h-screen bg-[#f9f7f1] text-black font-mono p-2 max-w-[424px] mx-auto">
      <div className="bg-[#fefdfb] border-2 border-black p-3">
        {/* Compact Header */}
        <div className="text-center mb-4 pb-3 border-b-2 border-black">
          <h1 className="text-2xl font-bold mb-1">HIGHER STEAKS</h1>
          <p className="text-xs text-gray-600">Premium Cuts & Fine Dining</p>
          <p className="text-xs mt-1">Est. 2025</p>
        </div>

        {/* Menu Items - Compact */}
        <div className="space-y-2 mt-4">
          {menuItems.map((item, index) => (
            <div key={index} className="flex items-center text-xs leading-tight">
              <span className="flex-1 truncate">{item.name}</span>
              <span className="ml-2 font-bold whitespace-nowrap">{item.price}</span>
            </div>
          ))}
        </div>

        {/* Footer Info */}
        <div className="mt-4 pt-3 border-t border-black text-center text-xs">
          <p className="mb-1">All steaks served with choice of two sides</p>
          <p className="text-gray-600">* Prices subject to market availability *</p>
        </div>

        {/* Hours */}
        <div className="text-center mt-3 pt-2 border-t border-black text-xs">
          <p className="font-semibold">Open Daily 5-11PM</p>
        </div>

        {/* Test Authentication Button (for development) */}
        <div className="mt-4 text-center">
          <button
            onClick={handleGetToken}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Test Quick Auth
          </button>
        </div>
      </div>
    </main>
  );
}
