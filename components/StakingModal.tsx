'use client';

import { useEffect, useState } from 'react';

interface LockupDetail {
  lockupId: string;
  amount: string;
  amountFormatted: string;
  unlockTime: number;
  timeRemaining: number;
  receiver: string;
}

interface WalletDetail {
  address: string;
  balance: string;
  balanceFormatted: string;
}

interface TokenBalance {
  totalBalanceFormatted: string;
  lockedBalanceFormatted: string;
  usdValue: string;
  higherLogoUrl?: string;
}

interface StakingModalProps {
  onClose: () => void;
  balance: TokenBalance;
  lockups: LockupDetail[];
  wallets: WalletDetail[];
  connectedWalletAddress?: string;
  loading?: boolean;
}

// Format time remaining to show only largest unit
function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) {
    return '🔓';
  }

  const days = Math.floor(seconds / 86400);
  if (days > 0) {
    return `${days}d`;
  }

  const hours = Math.floor(seconds / 3600);
  if (hours > 0) {
    return `${hours}h`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

// Truncate address: first 6 chars + "..." + last 4 chars
function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Format token amount with K/M/B suffixes
function formatTokenAmount(amount: string): string {
  const num = parseFloat(amount.replace(/,/g, ''));
  if (isNaN(num)) return amount;
  
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(2) + 'B';
  } else if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + 'M';
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + 'K';
  } else {
    return num.toFixed(2);
  }
}

export function StakingModal({ onClose, balance, lockups, wallets, connectedWalletAddress, loading = false }: StakingModalProps) {
  // State for stake input
  const [stakeInputOpen, setStakeInputOpen] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState<string>('');

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (stakeInputOpen) {
          setStakeInputOpen(null);
          setStakeAmount('');
        } else {
          onClose();
        }
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, stakeInputOpen]);

  // Sort wallets: connected first, then by balance descending
  const sortedWallets = [...wallets].sort((a, b) => {
    if (connectedWalletAddress) {
      if (a.address.toLowerCase() === connectedWalletAddress.toLowerCase()) return -1;
      if (b.address.toLowerCase() === connectedWalletAddress.toLowerCase()) return 1;
    }
    return parseFloat(b.balanceFormatted.replace(/,/g, '')) - parseFloat(a.balanceFormatted.replace(/,/g, ''));
  });

  // Handle Max button - fill with wallet balance
  const handleMax = (wallet: WalletDetail) => {
    setStakeAmount(wallet.balanceFormatted.replace(/,/g, ''));
  };

  // Handle percentage buttons - fill with percentage of wallet balance
  const handlePercentage = (wallet: WalletDetail, percentage: number) => {
    const balance = parseFloat(wallet.balanceFormatted.replace(/,/g, ''));
    const amount = (balance * percentage).toFixed(2);
    setStakeAmount(amount);
  };

  // Handle Stake button toggle
  const handleStakeClick = (walletAddress: string) => {
    if (stakeInputOpen === walletAddress) {
      // If already open, close it
      setStakeInputOpen(null);
      setStakeAmount('');
    } else {
      // Open input for this wallet
      setStakeInputOpen(walletAddress);
      setStakeAmount('');
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#fefdfb] border-2 border-black rounded-none p-6 max-w-4xl w-full relative font-mono shadow-2xl"
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

        {/* Top Section: Balance Display */}
        <div className="mb-6 pb-4 border-b-2 border-black">
          <div className="flex items-center gap-1.5 justify-center">
            <img 
              src={balance.higherLogoUrl || '/higher-logo.png'} 
              alt="HIGHER" 
              className="w-5 h-5 rounded-full"
            />
            <span className="text-sm font-bold text-purple-700">
              {formatTokenAmount(balance.lockedBalanceFormatted)} / {formatTokenAmount(balance.totalBalanceFormatted)}
            </span>
            <span className="text-sm">🥩</span>
          </div>
        </div>

        {/* Two-Column Layout */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="text-base font-bold text-black">
                Loading
                <span className="inline-block ml-1">
                  <span className="loading-dot-1">.</span>
                  <span className="loading-dot-2">.</span>
                  <span className="loading-dot-3">.</span>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column: Staked Lockups */}
            <div>
              <h3 className="text-lg font-bold mb-4 text-black border-b-2 border-black pb-2">
                Staked Positions
              </h3>
              {lockups.length === 0 ? (
                <p className="text-sm text-gray-600 italic">No active lockups</p>
              ) : (
                <ul className="space-y-3">
                  {lockups.map((lockup) => {
                    const isConnected = connectedWalletAddress?.toLowerCase() === lockup.receiver.toLowerCase();
                    return (
                      <li key={lockup.lockupId} className="text-sm">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <img 
                              src={balance.higherLogoUrl || '/higher-logo.png'} 
                              alt="HIGHER" 
                              className="w-4 h-4 rounded-full"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                            <span className="font-bold text-black">
                              {formatTokenAmount(lockup.amountFormatted)}
                            </span>
                          </div>
                          {isConnected && lockup.timeRemaining <= 0 ? (
                            <button
                              className="px-2 py-1 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition flex-shrink-0"
                              onClick={() => {
                                // Placeholder for unstake functionality
                                console.log('Unstake lockup:', lockup.lockupId);
                              }}
                            >
                              Unstake
                            </button>
                          ) : lockup.timeRemaining > 0 ? (
                            <span className="text-gray-600 text-s flex-shrink-0">
                              {formatTimeRemaining(lockup.timeRemaining)} left
                            </span>
                          ) : null}
                          <span className="flex-grow mx-2 border-b border-dotted border-black/30 mb-1"></span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isConnected && <span className="text-purple-500 text-xs">•</span>}
                            <a
                              href={`https://basescan.org/address/${lockup.receiver}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-xs transition underline text-right ${
                                isConnected 
                                  ? 'font-bold text-purple-500 border-2 border-purple-500 px-1.5 py-0.5 rounded' 
                                  : 'text-gray-600 hover:text-black'
                              }`}
                            >
                              {truncateAddress(lockup.receiver)}
                            </a>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Right Column: Wallet Holdings */}
            <div>
              <h3 className="text-lg font-bold mb-4 text-black border-b-2 border-black pb-2">
                Wallet Holdings
              </h3>
              {sortedWallets.length === 0 ? (
                <p className="text-sm text-gray-600 italic">No wallet balances</p>
              ) : (
                <ul className="space-y-3">
                  {sortedWallets.map((wallet) => {
                    const isConnected = connectedWalletAddress?.toLowerCase() === wallet.address.toLowerCase();
                    const isStakeInputOpen = stakeInputOpen === wallet.address;
                    return (
                      <li key={wallet.address} className="text-sm">
                        <div className="space-y-2">
                          {/* Main row: Balance, Button, Address */}
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <img 
                                src={balance.higherLogoUrl || '/higher-logo.png'} 
                                alt="HIGHER" 
                                className="w-4 h-4 rounded-full"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                              <span className="font-bold text-black">
                                {formatTokenAmount(wallet.balanceFormatted)}
                              </span>
                            </div>
                            {isConnected && !isStakeInputOpen && (
                              <button
                                className="px-2 py-1 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition flex-shrink-0"
                                onClick={() => handleStakeClick(wallet.address)}
                              >
                                Stake
                              </button>
                            )}
                            {isConnected && isStakeInputOpen && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  className="px-2 py-1 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition"
                                  onClick={() => handleMax(wallet)}
                                >
                                  Max
                                </button>
                                <button
                                  className="px-2 py-1 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition"
                                  onClick={() => handlePercentage(wallet, 0.5)}
                                >
                                  50%
                                </button>
                              </div>
                            )}
                            <span className="flex-grow mx-2 border-b border-dotted border-black/30 mb-1"></span>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {isConnected && <span className="text-purple-500 text-xs">•</span>}
                              <a
                                href={`https://basescan.org/address/${wallet.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`text-xs transition underline text-right ${
                                  isConnected 
                                    ? 'font-bold text-purple-500 border-2 border-purple-500 px-1.5 py-0.5 rounded' 
                                    : 'text-gray-600 hover:text-black'
                                }`}
                              >
                                {truncateAddress(wallet.address)}
                              </a>
                            </div>
                          </div>
                          
                          {/* Stake input row (only visible when stake input is open for this wallet) */}
                          {isConnected && isStakeInputOpen && (
                            <div className="flex items-center gap-2 pl-6">
                              <input
                                type="text"
                                value={stakeAmount}
                                onChange={(e) => setStakeAmount(e.target.value)}
                                placeholder="0.00"
                                className="flex-1 px-2 py-1 text-xs border-2 border-black font-mono bg-[#fefdfb] focus:outline-none focus:ring-2 focus:ring-purple-500"
                              />
                              <button
                                className="px-2 py-1 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition flex-shrink-0 ml-auto"
                                onClick={() => {
                                  // Placeholder for stake functionality
                                  console.log('Stake HIGHER:', stakeAmount, 'from wallet:', wallet.address);
                                }}
                              >
                                Stake Now
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

