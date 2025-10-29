'use client';

import { useEffect } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

interface OnboardingModalProps {
  state: 'staked-no-cast' | 'has-enough' | 'needs-more';
  onClose: () => void;
  data: {
    stakedAmount?: string;
    walletAmount?: string;
    totalAmount?: string;
    minimumRequired?: string;
  };
}

export function OnboardingModal({ state, onClose, data }: OnboardingModalProps) {
  // Handle click outside to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleQuickCast = async () => {
    try {
      await sdk.actions.composeCast({
        text: "started aiming higher and it worked out! ",
        channelKey: "higher"
      });
      onClose();
    } catch (error) {
      console.error("Failed to open cast composer:", error);
    }
  };

  const handleStakeOnMintClub = () => {
    const mintClubUrl = "https://farcaster.xyz/miniapps/ebIiKqVQ26EG/mint-club";
    sdk.actions.openUrl(mintClubUrl);
    onClose();
  };

  const handleSwapToHigher = () => {
    const higherTokenAddress = "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe";
    const swapUrl = `https://warpcast.com/~/wallets?swap=${higherTokenAddress}`;
    sdk.actions.openUrl(swapUrl);
    onClose();
  };

  const renderContent = () => {
    switch (state) {
      case 'staked-no-cast':
        return (
          <>
            <h2 className="text-2xl font-bold mb-4">You're Staking HIGHER! 🥩</h2>
            <p className="mb-4">
              You have <span className="font-bold">{data.stakedAmount}</span> HIGHER staked.
            </p>
            <p className="mb-4">
              To appear on the leaderboard, post in /higher:
            </p>
            <div className="bg-zinc-800 p-4 rounded mb-6 border border-zinc-700">
              <code className="text-sm text-green-400">
                started aiming higher and it worked out! <span className="text-zinc-500">[your message here]</span>
              </code>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleQuickCast}
                className="flex-1 px-6 py-3 bg-white text-black font-bold rounded hover:bg-zinc-200 transition"
              >
                Quick Cast
              </button>
              <button
                onClick={onClose}
                className="px-6 py-3 bg-zinc-800 text-white border border-zinc-700 rounded hover:bg-zinc-700 transition"
              >
                Maybe Later
              </button>
            </div>
          </>
        );

      case 'has-enough':
        return (
          <>
            <h2 className="text-2xl font-bold mb-4">Stake More HIGHER! 🥩</h2>
            <p className="mb-4">
              You have <span className="font-bold">{data.totalAmount}</span> HIGHER total
              {data.stakedAmount && data.walletAmount && (
                <span className="text-zinc-400">
                  {' '}({data.stakedAmount} staked + {data.walletAmount} in wallet)
                </span>
              )}.
            </p>
            <p className="mb-6">
              The minimum to rank is <span className="font-bold text-green-400">{data.minimumRequired}</span> HIGHER. Stake more to compete!
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleStakeOnMintClub}
                className="flex-1 px-6 py-3 bg-white text-black font-bold rounded hover:bg-zinc-200 transition"
              >
                Stake on mint.club
              </button>
              <button
                onClick={onClose}
                className="px-6 py-3 bg-zinc-800 text-white border border-zinc-700 rounded hover:bg-zinc-700 transition"
              >
                Maybe Later
              </button>
            </div>
          </>
        );

      case 'needs-more':
        return (
          <>
            <h2 className="text-2xl font-bold mb-4">Get More HIGHER! 🥩</h2>
            <p className="mb-4">
              You have <span className="font-bold">{data.totalAmount}</span> HIGHER total.
            </p>
            <p className="mb-6">
              The minimum to rank is <span className="font-bold text-green-400">{data.minimumRequired}</span> HIGHER. Swap to get more!
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleSwapToHigher}
                className="flex-1 px-6 py-3 bg-white text-black font-bold rounded hover:bg-zinc-200 transition"
              >
                Swap to HIGHER
              </button>
              <button
                onClick={onClose}
                className="px-6 py-3 bg-zinc-800 text-white border border-zinc-700 rounded hover:bg-zinc-700 transition"
              >
                Maybe Later
              </button>
            </div>
          </>
        );
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-md w-full relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white transition"
          aria-label="Close"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="24" 
            height="24" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        
        {renderContent()}
      </div>
    </div>
  );
}

