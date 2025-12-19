'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { LOCKUP_CONTRACT, LOCKUP_ABI } from '@/lib/contracts';
import { fetchValidCast, truncateCastText, isValidCastHash } from '@/lib/cast-helpers';

interface LockupDetail {
  lockupId: string;
  amount: string;
  amountFormatted: string;
  unlockTime: number;
  receiver: string;
  title: string;
  castHash?: string | null;
  stakeType?: 'caster' | 'supporter' | null;
  unlocked?: boolean;
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
  userFid?: number; // If not provided, we'll resolve from connected address
  duneStakedData?: {
    totalStaked: string;
    lockups: LockupDetail[];
  } | null;
  onTransactionSuccess?: () => void;
  onTransactionFailure?: (message?: string) => void;
  onUnlockSuccess?: (txHash?: string, lockupId?: string, amount?: string) => void;
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
  const safe = (amount ?? '0').toString();
  const num = parseFloat(safe.replace(/,/g, ''));
  if (isNaN(num)) return safe;
  
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

export function StakingModal({
  onClose,
  balance,
  lockups: _legacyLockups,
  wallets = [],
  loading = false,
  userFid,
  duneStakedData,
  onTransactionSuccess,
  onTransactionFailure,
  onUnlockSuccess,
}: StakingModalProps) {
  // Transaction state
  const [unstakeLockupId, setUnstakeLockupId] = useState<string | null>(null);
  // Use ref to track if we've already processed this transaction success
  const processedUnstakeTxHash = useRef<string | null>(null);
  const reportUnstakeError = useCallback(
    (message: string) => {
      onTransactionFailure?.(message);
    },
    [onTransactionFailure]
  );
  
  // Cast text state
  const [castTexts, setCastTexts] = useState<Record<string, string | null>>({});
  
  // Current time state - updates every second for countdown timers
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));
  
  // Update currentTime every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Wagmi hooks
  const { address: wagmiAddress } = useAccount();
  const { writeContract: writeContractUnstake, data: unstakeHash, isPending: isUnstakePending, error: unstakeWriteError } = useWriteContract();
  const { isLoading: isUnstakeConfirming, isSuccess: isUnstakeSuccess } = useWaitForTransactionReceipt({
    hash: unstakeHash,
  });

  const pendingUnstakeRef = useRef<{
    lockupId: string;
    castHash?: string | null;
    stakeType?: 'caster' | 'supporter' | null;
    amount?: string;
  } | null>(null);

  // Use duneStakedData prop instead of internal fetching; fallback to legacy lockups if needed
  const duneItems = duneStakedData?.lockups ?? _legacyLockups ?? [];
  // Normalize amounts so we always have an amountFormatted for display/sorting
  const normalizedLockups = duneItems.map((l) => ({
    ...l,
    amountFormatted: l.amountFormatted ?? l.amount ?? '0',
  }));

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Fetch cast text for lockups when data changes
  // Updated logic: check DB first, then Neynar, show Invalid cast if both fail
  useEffect(() => {
    if (!duneItems.length) return;
    
    // Use Promise.all with map instead of forEach to avoid race conditions
    Promise.all(
      duneItems.map(async (lockup) => {
        // Use castHash if available, otherwise fall back to title
        const castHash = lockup.castHash || lockup.title;
        
        if (!isValidCastHash(castHash)) {
          return { lockupId: lockup.lockupId, description: null };
        }
        
        // Step 1: Check if cast exists in database
        try {
          const dbResponse = await fetch(`/api/cast/${castHash}`);
          if (dbResponse.ok) {
            const dbData = await dbResponse.json();
            
            // If cast_state is 'higher' or 'expired', use DB data
            if (dbData.state === 'higher' || dbData.state === 'expired') {
              return {
                lockupId: lockup.lockupId,
                description: dbData.description ? truncateCastText(dbData.description) : null,
              };
            }
            
            // If cast_state is 'valid' or 'invalid', fallback to Neynar validation
            if (dbData.state === 'valid' || dbData.state === 'invalid') {
              try {
                const neynarResponse = await fetch(`/api/validate-cast?hash=${encodeURIComponent(castHash)}&isUrl=false`);
                if (neynarResponse.ok) {
                  const neynarData = await neynarResponse.json();
                  if (neynarData.valid && neynarData.description) {
                    return {
                      lockupId: lockup.lockupId,
                      description: truncateCastText(neynarData.description),
                    };
                  }
                }
              } catch (error) {
                console.error('[StakingModal] Error validating cast via Neynar:', error);
              }
              // Neynar validation failed, show Invalid cast
              return {
                lockupId: lockup.lockupId,
                description: 'Invalid cast',
              };
            }
          }
        } catch (error) {
          console.error('[StakingModal] Error checking DB for cast:', error);
        }
        
        // Step 2: If not found in DB, call /api/validate-cast (Neynar fallback)
        try {
          const validateResponse = await fetch(`/api/validate-cast?hash=${encodeURIComponent(castHash)}&isUrl=false`);
          if (validateResponse.ok) {
            const validateData = await validateResponse.json();
            if (validateData.valid && validateData.description) {
              return {
                lockupId: lockup.lockupId,
                description: truncateCastText(validateData.description),
              };
            }
          }
        } catch (error) {
          console.error('[StakingModal] Error validating cast via Neynar:', error);
        }
        
        // Step 3: If both fail, display "Invalid cast"
        return {
          lockupId: lockup.lockupId,
          description: 'Invalid cast',
        };
      })
    ).then((results) => {
      // Update state once with all results to avoid race conditions
      const newCastTexts: Record<string, string | null> = {};
      results.forEach(({ lockupId, description }) => {
        newCastTexts[lockupId] = description;
      });
      setCastTexts(newCastTexts);
    }).catch((error) => {
      console.error('[StakingModal] Error fetching cast texts:', error);
    });
  }, [duneItems]);

  const derivedWallets = useMemo(() => {
    const map = new Map<string, number>();

    const parseAmount = (value?: string) => {
      if (value === undefined || value === null) return 0;
      const num = Number(String(value).replace(/,/g, ''));
      return Number.isFinite(num) ? num : 0;
    };

    const seedFromList = (entry: WalletDetail) => {
      const addr = entry.address?.toLowerCase();
      if (!addr) return;
      const value = parseAmount(entry.balanceFormatted ?? entry.balance);
      if (value <= 0) return;
      map.set(addr, (map.get(addr) || 0) + value);
    };

    wallets.forEach(seedFromList);

    duneItems.forEach((item) => {
      if (item.unlocked) return;
      const addr = item.receiver?.toLowerCase();
      if (!addr) return;
      const amt = Number(item.amount);
      if (!Number.isFinite(amt) || amt <= 0) return;
      map.set(addr, (map.get(addr) || 0) + amt);
    });

    if (map.size === 0) {
      return wallets.filter((entry) => parseAmount(entry.balanceFormatted ?? entry.balance) > 0);
    }

    return Array.from(map.entries())
      .map(([address, amount]) => ({
        address,
        balance: amount.toString(),
        balanceFormatted: amount.toString(),
      }))
      .filter((entry) => parseAmount(entry.balanceFormatted ?? entry.balance) > 0);
  }, [wallets, duneItems]);

  // Sort wallets: connected first, then by balance descending
  const parseFormatted = (v?: string) =>
    parseFloat((v ?? '0').toString().replace(/,/g, ''));

  const sortedWallets = [...derivedWallets].sort((a, b) => {
    if (wagmiAddress) {
      if (a.address.toLowerCase() === wagmiAddress.toLowerCase()) return -1;
      if (b.address.toLowerCase() === wagmiAddress.toLowerCase()) return 1;
    }
    return parseFormatted(b.balanceFormatted) - parseFormatted(a.balanceFormatted);
  });

  // Sort lockups: (1) connected wallet first, (2) expired first, then by time remaining
  // (3) then by amount descending
  // Hide locally-unstaked rows; show only not unlocked
  const sourceLockups = normalizedLockups.filter(l => !l.unlocked);
  const sortedLockups = [...sourceLockups].sort((a, b) => {
    // Calculate time remaining for sorting
    const aTimeRemaining = a.unlockTime - currentTime;
    const bTimeRemaining = b.unlockTime - currentTime;
    
    // (1) Connected wallet first
    if (wagmiAddress) {
      const aIsConnected = a.receiver.toLowerCase() === wagmiAddress.toLowerCase();
      const bIsConnected = b.receiver.toLowerCase() === wagmiAddress.toLowerCase();
      if (aIsConnected && !bIsConnected) return -1;
      if (!aIsConnected && bIsConnected) return 1;
    }
    
    // (2) Expired lockups first
    const aExpired = aTimeRemaining <= 0;
    const bExpired = bTimeRemaining <= 0;
    if (aExpired && !bExpired) return -1;
    if (!aExpired && bExpired) return 1;
    
    // (3) Then by time remaining ascending (earlier expiry first)
    if (aTimeRemaining !== bTimeRemaining) {
      return aTimeRemaining - bTimeRemaining;
    }
    
    // (4) Finally by amount descending (largest first)
    return parseFormatted(b.amountFormatted) - parseFormatted(a.amountFormatted);
  });

  // Handle Unstake
  const handleUnstake = (lockup: LockupDetail) => {
    setUnstakeLockupId(lockup.lockupId);
    pendingUnstakeRef.current = {
      lockupId: lockup.lockupId,
      castHash: lockup.castHash,
      stakeType: lockup.stakeType,
      amount: lockup.amount,
    };
    
    try {
      writeContractUnstake({
        address: LOCKUP_CONTRACT,
        abi: LOCKUP_ABI,
        functionName: 'unlock',
        args: [BigInt(lockup.lockupId)],
      });
    } catch (error: any) {
      reportUnstakeError(error?.message || 'Failed to initiate unstake');
      console.error('Unstake error:', error);
    }
  };

  // Handle transaction success - refresh balance
  useEffect(() => {
    if (isUnstakeSuccess && unstakeHash) {
      if (processedUnstakeTxHash.current === unstakeHash) {
        return;
      }
      
      processedUnstakeTxHash.current = unstakeHash;
      const meta = pendingUnstakeRef.current;
      pendingUnstakeRef.current = null;
      setUnstakeLockupId(null);
      
      console.log('[Staking Modal] Unstake transaction successful - UI updated optimistically');
      
      if (onTransactionSuccess) {
        setTimeout(() => {
          onTransactionSuccess();
        }, 1000);
      }

      if (meta) {
        // Pass lockup metadata to parent for optimistic update
        if (meta.lockupId && meta.amount) {
          onUnlockSuccess?.(unstakeHash, meta.lockupId, meta.amount);
        } else {
          onUnlockSuccess?.(unstakeHash);
        }
        if (meta.castHash && meta.stakeType) {
          fetch('/api/user/lockup/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              castHash: meta.castHash,
              lockUpId: Number(meta.lockupId),
              stakeType: meta.stakeType,
            }),
          }).catch(() => {});
        }
      }
    }
  }, [isUnstakeSuccess, unstakeHash, onTransactionSuccess, onUnlockSuccess]);

  // Update error states
  useEffect(() => {
    if (unstakeWriteError) {
      reportUnstakeError(unstakeWriteError.message || 'Transaction failed');
    }
  }, [unstakeWriteError, reportUnstakeError]);

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
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-black/40 hover:text-black transition"
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
        </div>

        {/* Top Section: Balance Display */}
        <div className="mb-6 pb-4 border-b-2 border-black">
          <div className="flex items-center gap-1.5 justify-center">
            <img 
              src={balance.higherLogoUrl || '/higher-logo.png'} 
              alt="HIGHER" 
              className="w-5 h-5 rounded-full"
            />
            <span className="text-sm font-bold text-purple-700">
              {formatTokenAmount(duneStakedData?.totalStaked ?? balance.lockedBalanceFormatted)} / {formatTokenAmount(balance.totalBalanceFormatted)}
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
              {sortedLockups.length === 0 ? (
                <p className="text-sm text-gray-600 italic">No active lockups</p>
              ) : (
                <ul className="space-y-3">
              {sortedLockups.map((lockup) => {
                    const isConnected = wagmiAddress?.toLowerCase() === lockup.receiver.toLowerCase();
                    return (
                      <li key={lockup.lockupId} className="text-sm">
                        <div>
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
                            {(() => {
                              const timeRemaining = lockup.unlockTime - currentTime;
                              const isExpired = timeRemaining <= 0;
                              
                              if (isConnected && isExpired) {
                                const isThisUnstaking = unstakeLockupId === lockup.lockupId && (isUnstakePending || isUnstakeConfirming);
                                return (
                                  <button
                                    className="px-2 py-1 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                    onClick={() => handleUnstake(lockup)}
                                    disabled={isUnstakePending || isUnstakeConfirming || isThisUnstaking}
                                  >
                                    {isThisUnstaking ? (
                                      <>
                                        <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full"></div>
                                        Unstaking...
                                      </>
                                    ) : 'Unstake'}
                                  </button>
                                );
                              } else if (!isExpired) {
                                return (
                                  <span className="text-gray-600 text-s flex-shrink-0">
                                    {formatTimeRemaining(timeRemaining)} left
                                  </span>
                                );
                              } else {
                                return (
                                  <span className="text-gray-600 text-s flex-shrink-0">
                                    Expired
                                  </span>
                                );
                              }
                            })()}
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
                          {/* Cast text or link */}
                          {(() => {
                            const castHash = lockup.castHash || lockup.title;
                            if (!isValidCastHash(castHash)) return null;
                            
                            if (castTexts[lockup.lockupId]) {
                              return (
                                <p className="text-xs text-gray-400 truncate mt-1">
                                  {castTexts[lockup.lockupId]}
                                </p>
                              );
                            }
                            return (
                              <p className="text-xs text-gray-400 italic mt-1">Higher cast not found</p>
                            );
                          })()}
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
                    return (
                      <li key={wallet.address} className="text-sm">
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
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
        
        {/* Transaction hash link */}
        {unstakeHash && (
          <div className="mt-4 text-center">
            <a 
              href={`https://basescan.org/tx/${unstakeHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-purple-600 hover:text-purple-700 underline"
            >
              View transaction
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

