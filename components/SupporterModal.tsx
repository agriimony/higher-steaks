'use client';

import { useEffect, useState, useRef } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { sdk } from '@farcaster/miniapp-sdk';
import { LOCKUP_CONTRACT, HIGHER_TOKEN_ADDRESS, LOCKUP_ABI, ERC20_ABI } from '@/lib/contracts';
import { useEventSubscriptions } from '@/hooks/useEventSubscriptions';
import { formatTimeRemaining } from '@/lib/supporter-helpers';

interface SupporterModalProps {
  castHash: string;
  onClose: () => void;
  userFid: number | null;
  walletBalance?: number;
  onStakeSuccess?: () => void;
}

interface CastData {
  hash: string;
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  castText: string;
  description: string;
  timestamp: string;
  state: string;
  totalHigherStaked: string;
  usdValue: number | null;
  rank: number | null;
  maxCasterUnlockTime: number;
  minCasterUnlockTime: number;
  totalCasterStaked: string;
  totalSupporterStaked: string;
  casterStakes: Array<{ lockupId: number; amount: string; unlockTime: number }>;
  supporterStakes: Array<{ fid: number; pfp: string; totalAmount: string }>;
  connectedUserStake?: { fid: number; totalAmount: string };
}

// Format timestamp to readable date
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return timestamp;
  }
}

// Convert duration and unit to seconds
function durationToSeconds(duration: number, unit: 'minute' | 'day' | 'week' | 'month' | 'year'): number {
  switch (unit) {
    case 'minute':
      return duration * 60;
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

export function SupporterModal({ castHash, onClose, userFid, walletBalance = 0, onStakeSuccess }: SupporterModalProps) {
  const [castData, setCastData] = useState<CastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStakingForm, setShowStakingForm] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('');
  const [lockupDuration, setLockupDuration] = useState<string>('');
  const [lockupDurationUnit, setLockupDurationUnit] = useState<'minute' | 'day' | 'week' | 'month' | 'year'>('day');
  
  // Staking transaction state
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [pendingCreateLockUp, setPendingCreateLockUp] = useState(false);
  const [createLockUpParams, setCreateLockUpParams] = useState<{
    amountWei: bigint;
    unlockTime: number;
  } | null>(null);
  
  // Wagmi hooks
  const { address: wagmiAddress, isConnected } = useAccount();
  
  // Read current allowance to avoid unnecessary approvals
  const { data: currentAllowance } = useReadContract({
    address: HIGHER_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: wagmiAddress ? [wagmiAddress, LOCKUP_CONTRACT] : undefined,
  });
  
  const { writeContract: writeContractApprove, data: approveHash, isPending: isApprovePending, error: approveError } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess, data: approveReceipt } = useWaitForTransactionReceipt({
    hash: approveHash,
    confirmations: 1,
  });
  
  const { writeContract: writeContractCreateLockUp, data: createLockUpHash, isPending: isCreateLockUpPending, error: createLockUpError } = useWriteContract();
  const { isLoading: isCreateLockUpConfirming, isSuccess: isCreateLockUpSuccess } = useWaitForTransactionReceipt({
    hash: createLockUpHash,
  });
  
  // Use ref to track if we've already scheduled the createLockUp call
  const hasScheduledCreateLockUp = useRef(false);
  // Use ref to track if we've already processed this transaction success
  const processedTxHash = useRef<string | null>(null);
  const createLockUpTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Webhook listeners
  const wsEnabled = userFid !== null;
  const ws = useEventSubscriptions(wsEnabled);
  const lastEventRef = useRef<string | null>(null);

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

  // Fetch cast data on mount
  useEffect(() => {
    const fetchCastData = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/cast/${castHash}${userFid ? `?userFid=${userFid}` : ''}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to fetch cast data');
        }
        const data = await response.json();
        setCastData(data);
      } catch (err: any) {
        console.error('[SupporterModal] Error fetching cast data:', err);
        setError(err.message || 'Failed to load cast data');
      } finally {
        setLoading(false);
      }
    };

    if (castHash) {
      fetchCastData();
    }
  }, [castHash, userFid]);


  // Chain createLockUp after approve succeeds
  useEffect(() => {
    if (!isApproveSuccess || !approveReceipt || !createLockUpParams || !wagmiAddress || !castHash || hasScheduledCreateLockUp.current || !isConnected) {
      return;
    }

    hasScheduledCreateLockUp.current = true;
    const paramsToUse = createLockUpParams;

    const delay = setTimeout(() => {
      createLockUpTimeoutRef.current = null;
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
            castHash // Use cast hash as title
          ],
        });
      } catch (error: any) {
        console.error('[SupporterModal] CreateLockUp error:', error);
        setStakeError(error?.message || 'Failed to create lockup');
        setPendingCreateLockUp(false);
        hasScheduledCreateLockUp.current = false;
      }
    }, 1000);

    createLockUpTimeoutRef.current = delay;
    setPendingCreateLockUp(true);
    setCreateLockUpParams(null);

    return () => {
      if (createLockUpTimeoutRef.current) {
        clearTimeout(createLockUpTimeoutRef.current);
        createLockUpTimeoutRef.current = null;
      }
    };
  }, [isApproveSuccess, approveReceipt, wagmiAddress, castHash, isConnected, writeContractCreateLockUp]);

  // Handle transaction success
  useEffect(() => {
    if (isCreateLockUpSuccess && createLockUpHash) {
      // Check if we've already processed this transaction
      if (processedTxHash.current === createLockUpHash) {
        return;
      }
      
      // Mark this transaction as processed
      processedTxHash.current = createLockUpHash;
      
      setPendingCreateLockUp(false);
      setCreateLockUpParams(null);
      setShowStakingForm(false);
      setStakeAmount('');
      
      // Call success callback
      onStakeSuccess?.();
    }
  }, [isCreateLockUpSuccess, createLockUpHash, onStakeSuccess]);

  // Handle transaction errors
  useEffect(() => {
    if (approveError || createLockUpError) {
      setStakeError((approveError || createLockUpError)?.message || 'Transaction failed');
      setPendingCreateLockUp(false);
      hasScheduledCreateLockUp.current = false;
    }
  }, [approveError, createLockUpError]);

  // Listen for webhook events to refresh cast data
  useEffect(() => {
    if (ws.newLockupEvent && wagmiAddress && castHash) {
      // Generate event ID based on what data is available
      const eventId = ws.newLockupEvent.from && ws.newLockupEvent.to 
        ? `lockup-transfer-${ws.newLockupEvent.from}-${ws.newLockupEvent.to}-${ws.newLockupEvent.value}`
        : `${ws.newLockupEvent.lockUpId}-${ws.newLockupEvent.receiver}`;
      
      // Avoid processing duplicate events
      if (eventId === lastEventRef.current) {
        return;
      }
      lastEventRef.current = eventId;

      console.log('[SupporterModal] New lockup detected:', ws.newLockupEvent);

      // Check if this event is relevant to the current user
      const isRelevant = ws.newLockupEvent.from 
        ? ws.newLockupEvent.from.toLowerCase() === wagmiAddress.toLowerCase()
        : ws.newLockupEvent.receiver?.toLowerCase() === wagmiAddress.toLowerCase();
      
      if (isRelevant) {
        console.log('[SupporterModal] Lockup involves current user, refreshing cast data');
        
        // Refresh cast data
        const fetchCastData = async () => {
          try {
            const url = `/api/cast/${castHash}${userFid ? `?userFid=${userFid}` : ''}`;
            const response = await fetch(url);
            if (response.ok) {
              const data = await response.json();
              setCastData(data);
            }
          } catch (err) {
            console.error('[SupporterModal] Error refreshing cast data:', err);
          }
        };
        
        fetchCastData();
        
        // Call success callback
        onStakeSuccess?.();
      }
    }
  }, [ws.newLockupEvent, wagmiAddress, castHash, userFid, onStakeSuccess]);

  const handleStake = async () => {
    if (!wagmiAddress || !isConnected) {
      setStakeError('No wallet connected');
      return;
    }

    if (!castData) {
      setStakeError('No valid cast found');
      return;
    }

    // Check if user is the caster
    const isCaster = userFid !== null && castData.fid === userFid;

    // Validation
    const amountNum = parseFloat(stakeAmount.replace(/,/g, ''));
    
    if (isNaN(amountNum) || amountNum <= 0) {
      setStakeError('Please enter a valid stake amount');
      return;
    }

    // Check balance
    if (amountNum > walletBalance) {
      setStakeError('Amount exceeds wallet balance');
      return;
    }

    setStakeError(null);

    try {
      // Convert amount to wei (18 decimals)
      const amountWei = parseUnits(stakeAmount.replace(/,/g, ''), 18);
      
      let unlockTime: number;
      
      if (isCaster) {
        // Caster: calculate unlock time from user-defined duration
        const durationNum = parseFloat(lockupDuration);
        
        if (isNaN(durationNum) || durationNum <= 0) {
          setStakeError('Please enter a valid duration');
          return;
        }
        
        // Calculate unlock time (current time + duration in seconds)
        const durationSeconds = durationToSeconds(durationNum, lockupDurationUnit);
        unlockTime = Math.floor(Date.now() / 1000) + durationSeconds;
      } else {
        // Supporter: use max caster unlock time
        if (!castData.maxCasterUnlockTime || castData.maxCasterUnlockTime <= 0) {
          setStakeError('No valid caster stake found');
          return;
        }
        unlockTime = castData.maxCasterUnlockTime;
      }
      
      // Validate unlockTime fits in uint40
      if (unlockTime > 0xFFFFFFFF) {
        setStakeError('Duration too long (exceeds maximum)');
        return;
      }

      // Store params for createLockUp (will be called after approve succeeds or if already approved)
      setCreateLockUpParams({ amountWei, unlockTime });

      // Step 1: Check if we need to approve (only approve if current allowance is insufficient)
      const allowance = currentAllowance || BigInt(0);
      
      if (allowance >= amountWei) {
        console.log('[SupporterModal] Sufficient allowance exists, skipping approve');
        // Sufficient allowance - simulate approve success to trigger createLockUp
        hasScheduledCreateLockUp.current = true;
        setPendingCreateLockUp(true);
        
        // Call createLockUp directly after a short delay
        const delay = setTimeout(() => {
          try {
            writeContractCreateLockUp({
              address: LOCKUP_CONTRACT,
              abi: LOCKUP_ABI,
              functionName: 'createLockUp',
              args: [
                HIGHER_TOKEN_ADDRESS,
                true, // isERC20
                amountWei,
                unlockTime,
                wagmiAddress,
                castHash // Use cast hash as title
              ],
            });
          } catch (error: any) {
            console.error('[SupporterModal] CreateLockUp error:', error);
            setStakeError(error?.message || 'Failed to create lockup');
            setPendingCreateLockUp(false);
            hasScheduledCreateLockUp.current = false;
          }
        }, 100);
        
        createLockUpTimeoutRef.current = delay;
        setCreateLockUpParams(null);
      } else {
        console.log('[SupporterModal] Insufficient allowance, calling approve');
        // Step 1: Approve the lockup contract to spend tokens
        writeContractApprove({
          address: HIGHER_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [LOCKUP_CONTRACT, amountWei],
        });
      }
    } catch (error: any) {
      console.error('[SupporterModal] Stake error:', error);
      setStakeError(error?.message || 'Failed to stake');
      setPendingCreateLockUp(false);
      hasScheduledCreateLockUp.current = false;
    }
  };

  const handleSwapToHigher = async () => {
    try {
      const buyToken = "eip155:8453/erc20:0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe";
      
      console.log('Opening swap for buyToken:', buyToken);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = await sdk.actions.swapToken({
        buyToken,
      });
      
      console.log('Swap result:', result);
      
      if (result.success) {
        console.log('Swap successful, transactions:', result.swap.transactions);
        onClose();
      } else if (result.reason !== 'rejected_by_user') {
        alert('Swap failed. Please try again.');
      }
    } catch (error) {
      console.error("Failed to open swap:", error);
      alert('Failed to open swap. Please try again.');
    }
  };

  if (loading) {
    return (
      <div 
        className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <div 
          className="bg-[#fefdfb] border-2 border-black rounded-none p-6 max-w-md w-full relative font-mono"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center text-black">Loading cast data...</div>
        </div>
      </div>
    );
  }

  if (error || !castData) {
    return (
      <div 
        className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <div 
          className="bg-[#fefdfb] border-2 border-black rounded-none p-6 max-w-md w-full relative font-mono"
          onClick={(e) => e.stopPropagation()}
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
          <div className="text-center text-red-600">
            {error || 'Failed to load cast data'}
          </div>
        </div>
      </div>
    );
  }

  // Separate connected user's stake from other supporters
  const otherSupporterStakes = castData.supporterStakes.filter(
    stake => !userFid || stake.fid !== userFid
  );
  const connectedUserStake = castData.connectedUserStake;

  // Check if user is the caster
  const isCaster = userFid !== null && castData.fid === userFid;

  // Format amounts
  const totalCasterStakedFormatted = formatUnits(BigInt(castData.totalCasterStaked || '0'), 18);
  const totalSupporterStakedFormatted = formatUnits(BigInt(castData.totalSupporterStaked || '0'), 18);
  const connectedUserStakeFormatted = connectedUserStake 
    ? formatUnits(BigInt(connectedUserStake.totalAmount || '0'), 18)
    : null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#fefdfb] border-2 border-black rounded-none p-6 max-w-lg w-full relative font-mono shadow-2xl max-h-[90vh] overflow-y-auto"
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

        {/* Top Section: Caster Info + Total USD */}
        <div className="flex items-center justify-between mb-4 pb-4 border-b-2 border-black gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {castData.pfpUrl && (
              <a 
                href={`https://farcaster.xyz/${castData.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:opacity-80 transition-opacity flex-shrink-0"
              >
                <img 
                  src={castData.pfpUrl} 
                  alt={castData.username}
                  className="w-12 h-12 rounded-full border border-black/20"
                />
              </a>
            )}
            <div className="min-w-0 flex-1">
              <a 
                href={`https://farcaster.xyz/${castData.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-black hover:text-purple-700 transition-colors block truncate w-32"
                title={`@${castData.username}`}
              >
                @{castData.username}
              </a>
              {castData.displayName && castData.displayName !== castData.username && (
                <div className="text-xs text-black/60 truncate">{castData.displayName}</div>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="flex items-center gap-2 justify-end">
              <div className="font-bold text-black">
                ${castData.usdValue ? castData.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
              </div>
              {castData.maxCasterUnlockTime > 0 ? (
                <div className="text-xs text-black/60">
                  for {formatTimeRemaining(castData.maxCasterUnlockTime)}
                </div>
              ) : (
                <div className="text-xs text-black/60">
                  {formatTimeRemaining(castData.maxCasterUnlockTime)}
                </div>
              )}
            </div>
            <div className="text-xs text-black/80 mt-0 flex items-center gap-1 justify-end">
              <span className="font-bold flex items-center gap-1">
                <img 
                  src="/higher-logo.png" 
                  alt="HIGHER" 
                  className="w-3 h-3 rounded-full"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                {totalCasterStakedFormatted}
              </span>
              {'+'}
              <span className="text-black/60 flex items-center gap-1">
                {totalSupporterStakedFormatted}
              </span>
              {' '}
              <span className="text-black/60">supporting</span>
            </div>
          </div>
        </div>

        {/* Cast Description */}
        <div className="mb-4 pb-4 border-b border-black/20">
          <div className="text-sm text-black mb-2">{castData.description}</div>
          <div className="text-xs text-black/50">{formatTimestamp(castData.timestamp)}</div>
        </div>

        {/* Supported By Section */}
        {castData.supporterStakes.length > 0 && (
          <div className="mb-4 pb-4 border-b border-black/20">
            <div className="text-xs font-bold text-black mb-2">Supported by:</div>
            <div className="flex flex-wrap gap-2 items-center">
              {/* Show connected user's stake first if exists */}
              {connectedUserStake && connectedUserStakeFormatted && (
                <div className="flex items-center gap-2">
                  <img 
                    src={castData.supporterStakes.find(s => s.fid === userFid)?.pfp || ''} 
                    alt="Your stake"
                    className="w-8 h-8 rounded-full border border-black/20"
                  />
                  <span className="text-xs text-black font-bold">{connectedUserStakeFormatted} HIGHER</span>
                </div>
              )}
              {/* Show other supporters */}
              {otherSupporterStakes.map((stake, index) => (
                <img 
                  key={`${stake.fid}-${index}`}
                  src={stake.pfp || ''} 
                  alt={`Supporter ${stake.fid}`}
                  className="w-8 h-8 rounded-full border border-black/20"
                  title={`@${stake.fid}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Staking Form */}
        {showStakingForm ? (
          <div className="mb-4">
            <div className="mb-3">
              <label className="block text-xs font-bold text-black mb-1">
                Amount (HIGHER)
              </label>
              <input
                type="text"
                value={stakeAmount}
                onChange={(e) => {
                  setStakeAmount(e.target.value);
                  setStakeError(null);
                }}
                placeholder="0.00"
                className="w-full text-sm font-mono bg-white border border-black/20 p-2 text-black placeholder-black/40 focus:outline-none focus:border-black"
              />
            </div>
            {isCaster ? (
              /* Caster: Show duration input */
              <div className="mb-3">
                <label className="block text-xs font-bold text-black mb-1">
                  Duration
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={lockupDuration}
                    onChange={(e) => setLockupDuration(e.target.value)}
                    placeholder="1"
                    min="1"
                    className="flex-1 text-sm font-mono bg-white border border-black/20 p-2 text-black placeholder-black/40 focus:outline-none focus:border-black"
                  />
                  <select
                    value={lockupDurationUnit}
                    onChange={(e) => setLockupDurationUnit(e.target.value as 'minute' | 'day' | 'week' | 'month' | 'year')}
                    className="text-sm font-mono bg-white border border-black/20 p-2 text-black focus:outline-none focus:border-black"
                  >
                    <option value="minute">Minute(s)</option>
                    <option value="day">Day(s)</option>
                    <option value="week">Week(s)</option>
                    <option value="month">Month(s)</option>
                    <option value="year">Year(s)</option>
                  </select>
                </div>
              </div>
            ) : (
              /* Supporter: Show unlock time info */
              <div className="mb-3">
                <label className="block text-xs font-bold text-black mb-1">
                  until {castData.maxCasterUnlockTime > 0 
                    ? new Date(castData.maxCasterUnlockTime * 1000).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })
                    : 'N/A'}
                </label>
                <div className="text-xs text-black/50 mt-1">
                  Your stake will unlock together with @{castData.username}
                </div>
              </div>
            )}
            {stakeError && (
              <div className="mb-3 text-xs text-red-600">{stakeError}</div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowStakingForm(false);
                  setStakeError(null);
                  setStakeAmount('');
                  setLockupDuration('');
                  setLockupDurationUnit('day');
                }}
                className="flex-1 px-4 py-2 bg-white text-black font-bold border-2 border-black hover:bg-black hover:text-white transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleStake}
                disabled={pendingCreateLockUp || isApprovePending || isApproveConfirming || isCreateLockUpPending || isCreateLockUpConfirming}
                className="flex-1 px-4 py-2 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pendingCreateLockUp || isApprovePending || isApproveConfirming || isCreateLockUpPending || isCreateLockUpConfirming
                  ? 'Processing...'
                  : isApprovePending || isApproveConfirming
                  ? 'Approving...'
                  : 'Stake'}
              </button>
            </div>
          </div>
        ) : (
          /* Action Buttons */
          <div className="flex gap-2">
            {isCaster ? (
              /* Caster: Show "Add Stake" button */
              <button
                onClick={() => setShowStakingForm(true)}
                className="flex-1 px-4 py-2 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm"
              >
                Add Stake
              </button>
            ) : castData.maxCasterUnlockTime > 0 ? (
              /* Supporter: Show "Add Support" button if not expired */
              <button
                onClick={() => setShowStakingForm(true)}
                className="flex-1 px-4 py-2 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm"
              >
                Add Support
              </button>
            ) : (
              /* Supporter: Show "Expired" button if expired */
              <button
                disabled
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-500 font-bold border-2 border-gray-300 cursor-not-allowed transition text-sm"
              >
                Expired
              </button>
            )}
            <button
              onClick={handleSwapToHigher}
              className="flex-1 px-4 py-2 bg-purple-600 text-white font-bold border-2 border-purple-600 hover:bg-purple-700 transition text-sm"
            >
              Buy HIGHER
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

