'use client';

import { useEffect, useState } from 'react';
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
  const [customMessage, setCustomMessage] = useState('');

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
      console.log('Opening cast composer...');
      const fullMessage = "started aiming higher and it worked out! " + customMessage;
      const result = await sdk.actions.composeCast({
        text: fullMessage,
        channelKey: "higher"
      });
      console.log('Compose cast result:', result);
      // Only close if user successfully posted or cancelled intentionally
      onClose();
    } catch (error) {
      console.error("Failed to open cast composer:", error);
      // Keep modal open on error
    }
  };

  const handleStakeOnMintClub = async () => {
    try {
      console.log('Opening mint.club miniapp...');
      await sdk.actions.openMiniApp({
        url: "https://farcaster.xyz/miniapps/ebIiKqVQ26EG/mint-club"
      });
      // Note: Current app will close after successful navigation
      // No need to call onClose() as the app will close
    } catch (error) {
      console.error("Failed to open mint.club:", error);
      // Keep modal open on error
    }
  };

  const handleSwapToHigher = async () => {
    try {
      // CAIP-19 format for HIGHER token on Base (chain ID 8453)
      const buyToken = "eip155:8453/erc20:0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe";
      
      console.log('Opening swap for buyToken:', buyToken);
      
      // Add a small delay to ensure any previous state is cleared
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = await sdk.actions.swapToken({
        buyToken,
      });
      
      console.log('Swap result:', result);
      
      // Only close modal if swap was successful
      if (result.success) {
        console.log('Swap successful, transactions:', result.swap.transactions);
        onClose();
      } else {
        console.log('Swap not completed:', result.reason);
        if (result.reason === 'rejected_by_user') {
          console.log('User cancelled swap - modal stays open for retry');
        }
        // Keep modal open so user can try again
      }
    } catch (error) {
      console.error("Failed to open swap:", error);
      // Keep modal open on error
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
              <div className="text-xs text-black font-mono mb-2">
                started aiming higher and it worked out!
              </div>
              <textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="[your message here]"
                className="w-full text-xs font-mono bg-white border border-black/20 p-2 text-black placeholder-black/40 focus:outline-none focus:border-black resize-none"
                rows={3}
              />
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

