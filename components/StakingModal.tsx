'use client';

import { useEffect, useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { parseUnits } from 'viem';
import { LOCKUP_CONTRACT, HIGHER_TOKEN_ADDRESS, LOCKUP_ABI, ERC20_ABI } from '@/lib/contracts';

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
  loading?: boolean;
  onTransactionSuccess?: () => void;
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

// Convert duration and unit to seconds
function durationToSeconds(duration: number, unit: 'day' | 'week' | 'month' | 'year'): number {
  switch (unit) {
    case 'day':
      return duration * 86400;
    case 'week':
      return duration * 604800;
    case 'month':
      return duration * 2592000; // 30 days
    case 'year':
      return duration * 31536000; // 365 days
    default:
      return duration * 86400;
  }
}

export function StakingModal({ onClose, balance, lockups, wallets, loading = false, onTransactionSuccess }: StakingModalProps) {
  // State for stake input
  const [stakeInputOpen, setStakeInputOpen] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState<string>('');
  const [lockupDuration, setLockupDuration] = useState<string>('');
  const [lockupDurationUnit, setLockupDurationUnit] = useState<'day' | 'week' | 'month' | 'year'>('day');
  
  // Transaction state
  const [unstakeLockupId, setUnstakeLockupId] = useState<string | null>(null);
  const [unstakeError, setUnstakeError] = useState<string | null>(null);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [stakePending, setStakePending] = useState(false);
  
  // Wagmi hooks
  const { address: wagmiAddress } = useAccount();
  const { writeContract: writeContractUnstake, data: unstakeHash, isPending: isUnstakePending, error: unstakeWriteError } = useWriteContract();
  const { isLoading: isUnstakeConfirming, isSuccess: isUnstakeSuccess } = useWaitForTransactionReceipt({
    hash: unstakeHash,
  });
  
  // Separate hooks for approve and createLockUp
  const { writeContract: writeContractApprove, data: approveHash, isPending: isApprovePending, error: approveError } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
  });
  
  const { writeContract: writeContractCreateLockUp, data: createLockUpHash, isPending: isCreateLockUpPending, error: createLockUpError } = useWriteContract();
  const { isLoading: isCreateLockUpConfirming, isSuccess: isCreateLockUpSuccess } = useWaitForTransactionReceipt({
    hash: createLockUpHash,
  });
  
  // Track if we need to initiate createLockUp after approve succeeds
  const [pendingCreateLockUp, setPendingCreateLockUp] = useState(false);
  const [createLockUpParams, setCreateLockUpParams] = useState<{
    amountWei: bigint;
    unlockTime: number;
  } | null>(null);

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
      if (stakeInputOpen) {
        setStakeInputOpen(null);
        setStakeAmount('');
        setLockupDuration('');
        setLockupDurationUnit('day');
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
    if (wagmiAddress) {
      if (a.address.toLowerCase() === wagmiAddress.toLowerCase()) return -1;
      if (b.address.toLowerCase() === wagmiAddress.toLowerCase()) return 1;
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
      setLockupDuration('');
      setLockupDurationUnit('day');
      setStakeError(null);
    } else {
      // Open input for this wallet
      setStakeInputOpen(walletAddress);
      setStakeAmount('');
      setLockupDuration('');
      setLockupDurationUnit('day');
      setStakeError(null);
    }
  };

  // Handle Unstake
  const handleUnstake = (lockupId: string) => {
    setUnstakeLockupId(lockupId);
    setUnstakeError(null);
    
    try {
      writeContractUnstake({
        address: LOCKUP_CONTRACT,
        abi: LOCKUP_ABI,
        functionName: 'unlock',
        args: [BigInt(lockupId)],
      });
    } catch (error: any) {
      setUnstakeError(error?.message || 'Failed to initiate unstake');
      console.error('Unstake error:', error);
    }
  };

  // Handle Stake - sequential approve + createLockUp
  const handleStake = async (wallet: WalletDetail) => {
    if (!wagmiAddress) {
      setStakeError('No wallet connected');
      return;
    }

    // Validation
    const amountNum = parseFloat(stakeAmount.replace(/,/g, ''));
    const durationNum = parseFloat(lockupDuration);
    
    if (isNaN(amountNum) || amountNum <= 0) {
      setStakeError('Please enter a valid stake amount');
      return;
    }
    
    if (isNaN(durationNum) || durationNum <= 0) {
      setStakeError('Please enter a valid duration');
      return;
    }

    // Check balance
    const walletBalance = parseFloat(wallet.balanceFormatted.replace(/,/g, ''));
    if (amountNum > walletBalance) {
      setStakeError('Amount exceeds wallet balance');
      return;
    }

    setStakeError(null);
    setStakePending(true);

    try {
      // Convert amount to wei (18 decimals)
      const amountWei = parseUnits(stakeAmount.replace(/,/g, ''), 18);
      
      // Calculate unlock time (current time + duration in seconds)
      const durationSeconds = durationToSeconds(durationNum, lockupDurationUnit);
      const unlockTime = Math.floor(Date.now() / 1000) + durationSeconds;
      
      // Validate unlockTime fits in uint40
      if (unlockTime > 0xFFFFFFFF) {
        setStakeError('Duration too long (exceeds maximum)');
        setStakePending(false);
        return;
      }

      // Store params for createLockUp (will be called after approve succeeds)
      setCreateLockUpParams({ amountWei, unlockTime });

      // Step 1: Approve the lockup contract to spend tokens
      writeContractApprove({
        address: HIGHER_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [LOCKUP_CONTRACT, amountWei],
      });
    } catch (error: any) {
      setStakeError(error?.message || 'Failed to initiate stake');
      setStakePending(false);
      console.error('Stake error:', error);
    }
  };

  // Chain createLockUp after approve succeeds
  useEffect(() => {
    if (isApproveSuccess && createLockUpParams && wagmiAddress && !pendingCreateLockUp) {
      setPendingCreateLockUp(true);
      // Clear params immediately to prevent running this effect again
      const paramsToUse = createLockUpParams;
      setCreateLockUpParams(null);
      
      try {
        writeContractCreateLockUp({
          address: LOCKUP_CONTRACT,
          abi: LOCKUP_ABI,
          functionName: 'createLockUp',
          args: [
            HIGHER_TOKEN_ADDRESS,
            true, // isERC20
            paramsToUse.amountWei,
            paramsToUse.unlockTime,
            wagmiAddress,
            'Higher Steaks!'
          ],
        });
      } catch (error: any) {
        setStakeError(error?.message || 'Failed to create lockup');
        setPendingCreateLockUp(false);
        console.error('CreateLockUp error:', error);
      }
    }
  }, [isApproveSuccess, createLockUpParams, wagmiAddress, pendingCreateLockUp, writeContractCreateLockUp]);

  // Handle transaction success - refresh balance
  useEffect(() => {
    if (isUnstakeSuccess || isCreateLockUpSuccess) {
      // Reset state
      if (isUnstakeSuccess) {
        setUnstakeLockupId(null);
      }
      if (isCreateLockUpSuccess) {
        setStakePending(false);
        setStakeInputOpen(null);
        setStakeAmount('');
        setLockupDuration('');
        setLockupDurationUnit('day');
        setPendingCreateLockUp(false);
        setCreateLockUpParams(null);
      }
      
      // Call refresh callback
      if (onTransactionSuccess) {
        setTimeout(() => {
          onTransactionSuccess();
        }, 1000); // Wait a bit for blockchain to update
      }
    }
  }, [isUnstakeSuccess, isCreateLockUpSuccess, onTransactionSuccess]);

  // Update stake pending state based on transaction status
  const isStakeProcessing = isApprovePending || isApproveConfirming || isCreateLockUpPending || isCreateLockUpConfirming || pendingCreateLockUp;
  
  useEffect(() => {
    if (!isStakeProcessing) {
      setStakePending(false);
    }
  }, [isStakeProcessing]);

  // Update error states
  useEffect(() => {
    if (unstakeWriteError) {
      setUnstakeError(unstakeWriteError.message || 'Transaction failed');
    }
  }, [unstakeWriteError]);

  useEffect(() => {
    if (approveError) {
      setStakeError(approveError.message || 'Approve transaction failed');
      setStakePending(false);
      setCreateLockUpParams(null);
    }
  }, [approveError]);

  useEffect(() => {
    if (createLockUpError) {
      setStakeError(createLockUpError.message || 'Create lockup transaction failed');
      setStakePending(false);
      setPendingCreateLockUp(false);
      setCreateLockUpParams(null);
    }
  }, [createLockUpError]);

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
                    const isConnected = wagmiAddress?.toLowerCase() === lockup.receiver.toLowerCase();
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
                              className="px-2 py-1 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                              onClick={() => handleUnstake(lockup.lockupId)}
                              disabled={isUnstakePending || isUnstakeConfirming || (unstakeLockupId === lockup.lockupId && isUnstakeConfirming)}
                            >
                              {unstakeLockupId === lockup.lockupId && (isUnstakePending || isUnstakeConfirming) ? 'Processing...' : 'Unstake'}
                            </button>
                          ) : lockup.timeRemaining > 0 ? (
                            <span className="text-gray-600 text-s flex-shrink-0">
                              {formatTimeRemaining(lockup.timeRemaining)} left
                            </span>
                          ) : (
                            <span className="text-gray-600 text-s flex-shrink-0">
                              Expired
                            </span>
                          )}
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
                    const isConnected = wagmiAddress?.toLowerCase() === wallet.address.toLowerCase();
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
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={stakeAmount}
                                  onChange={(e) => {
                                    setStakeAmount(e.target.value);
                                    setStakeError(null);
                                  }}
                                  placeholder="0.00"
                                  className="w-24 px-2 py-1 text-xs border-2 border-black font-mono bg-[#fefdfb] focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                                  disabled={stakePending || isStakeProcessing}
                                />
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-gray-600">⌛</span>
                                  <input
                                    type="text"
                                    value={lockupDuration}
                                    onChange={(e) => {
                                      setLockupDuration(e.target.value);
                                      setStakeError(null);
                                    }}
                                    placeholder="1"
                                    className="w-12 px-2 py-1 text-xs border-2 border-black font-mono bg-[#fefdfb] focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                                    disabled={stakePending || isStakeProcessing}
                                  />
                                  <select
                                    value={lockupDurationUnit}
                                    onChange={(e) => setLockupDurationUnit(e.target.value as 'day' | 'week' | 'month' | 'year')}
                                    className="px-2 py-1 text-xs border-2 border-black font-mono bg-[#fefdfb] focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                                    disabled={stakePending || isStakeProcessing}
                                  >
                                    <option value="day">day</option>
                                    <option value="week">week</option>
                                    <option value="month">month</option>
                                    <option value="year">year</option>
                                  </select>
                                </div>
                                <button
                                  className="px-2 py-1 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition flex-shrink-0 ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                  onClick={() => handleStake(wallet)}
                                  disabled={stakePending || isStakeProcessing}
                                >
                                  {stakePending || isStakeProcessing ? 'Processing...' : 'Stake!'}
                                </button>
                              </div>
                              {stakeError && (
                                <div className="text-xs text-red-600 px-2">
                                  {stakeError}
                                </div>
                              )}
                              {unstakeHash && (
                                <div className="text-xs text-gray-600 px-2">
                                  <a 
                                    href={`https://basescan.org/tx/${unstakeHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                  >
                                    View transaction
                                  </a>
                                </div>
                              )}
                              {createLockUpHash && (
                                <div className="text-xs text-gray-600 px-2">
                                  <a 
                                    href={`https://basescan.org/tx/${createLockUpHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                  >
                                    View transaction
                                  </a>
                                </div>
                              )}
                              {isCreateLockUpSuccess && (
                                <div className="text-xs text-green-600 px-2">
                                  ✓ Transaction confirmed!
                                </div>
                              )}
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

