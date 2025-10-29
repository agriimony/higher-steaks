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

  const handleStakeOnMintClub = async () => {
    try {
      await sdk.actions.openUrl("https://farcaster.xyz/miniapps/ebIiKqVQ26EG/mint-club");
      onClose();
    } catch (error) {
      console.error("Failed to open mint.club:", error);
    }
  };

  const handleSwapToHigher = async () => {
    try {
      const higherTokenAddress = "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe";
      await sdk.actions.swapToken({
        token: higherTokenAddress as `0x${string}`,
      });
      onClose();
    } catch (error) {
      console.error("Failed to open swap:", error);
    }
  };

  const renderContent = () => {
    switch (state) {
      case 'staked-no-cast':
        return (
          <>
            <h2 className="text-xl font-bold mb-4 text-black border-b-2 border-black pb-2">
              You're Staking HIGHER! 🥩
            </h2>
            <p className="mb-3 text-black text-sm">
              You have <span className="font-bold">{data.stakedAmount}</span> HIGHER staked.
            </p>
            <p className="mb-3 text-black text-sm">
              To appear on the leaderboard, post in /higher:
            </p>
            <div className="bg-[#f9f7f1] p-4 border border-black/20 mb-6">
              <code className="text-xs text-black">
                started aiming higher and it worked out! <span className="text-black/40">[your message here]</span>
              </code>
            </div>
            <div className="flex gap-3 border-t border-black/20 pt-4">
              <button
                onClick={handleQuickCast}
                className="flex-1 px-4 py-2.5 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm"
              >
                Quick Cast
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 bg-white text-black border-2 border-black/20 hover:border-black transition text-sm"
              >
                Maybe Later
              </button>
            </div>
          </>
        );

      case 'has-enough':
        return (
          <>
            <h2 className="text-xl font-bold mb-4 text-black border-b-2 border-black pb-2">
              Stake More HIGHER! 🥩
            </h2>
            <p className="mb-3 text-black text-sm">
              You have <span className="font-bold">{data.totalAmount}</span> HIGHER total
              {data.stakedAmount && data.walletAmount && (
                <span className="text-black/50">
                  {' '}({data.stakedAmount} staked + {data.walletAmount} in wallet)
                </span>
              )}.
            </p>
            <p className="mb-6 text-black text-sm">
              The minimum to rank is <span className="font-bold underline">{data.minimumRequired}</span> HIGHER. Stake more to compete!
            </p>
            <div className="flex gap-3 border-t border-black/20 pt-4">
              <button
                onClick={handleStakeOnMintClub}
                className="flex-1 px-4 py-2.5 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm"
              >
                Stake on mint.club
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 bg-white text-black border-2 border-black/20 hover:border-black transition text-sm"
              >
                Maybe Later
              </button>
            </div>
          </>
        );

      case 'needs-more':
        return (
          <>
            <h2 className="text-xl font-bold mb-4 text-black border-b-2 border-black pb-2">
              Get More HIGHER! 🥩
            </h2>
            <p className="mb-3 text-black text-sm">
              You have <span className="font-bold">{data.totalAmount}</span> HIGHER total.
            </p>
            <p className="mb-6 text-black text-sm">
              The minimum to rank is <span className="font-bold underline">{data.minimumRequired}</span> HIGHER. Swap to get more!
            </p>
            <div className="flex gap-3 border-t border-black/20 pt-4">
              <button
                onClick={handleSwapToHigher}
                className="flex-1 px-4 py-2.5 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm"
              >
                Swap to HIGHER
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 bg-white text-black border-2 border-black/20 hover:border-black transition text-sm"
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
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#fefdfb] border-2 border-black rounded-none p-6 max-w-md w-full relative font-mono shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 10px 25px rgba(0, 0, 0, 0.3)'
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-black/40 hover:text-black transition"
          aria-label="Close"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="20" 
            height="20" 
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

