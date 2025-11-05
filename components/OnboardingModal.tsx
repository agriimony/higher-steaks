'use client';

import { useEffect, useState, useRef } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { sdk } from '@farcaster/miniapp-sdk';
import { LOCKUP_CONTRACT, HIGHER_TOKEN_ADDRESS, LOCKUP_ABI, ERC20_ABI } from '@/lib/contracts';

interface CastCard {
  hash: string;
  text: string;
  description: string;
  timestamp: string;
  castState: 'higher' | 'expired';
  rank: number | null;
  totalHigherStaked: number;
  totalCasterStaked: number;
  totalSupporterStaked: number;
  casterStakeLockupIds: number[];
  casterStakeAmounts: string[];
  casterStakeUnlockTimes: number[];
  supporterStakeLockupIds: number[];
  supporterStakeAmounts: string[];
  supporterStakeFids: number[];
}

interface OnboardingModalProps {
  onClose: () => void;
  userFid: number;
  walletBalance?: number;
  onStakeSuccess?: () => void;
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

// Calculate valid caster and supporter stakes from arrays
function calculateStakeTotals(
  casterStakeAmounts: string[],
  casterStakeUnlockTimes: number[],
  supporterStakeAmounts: string[],
  totalHigherStaked: number
): { totalCasterStaked: number; totalSupporterStaked: number } {
  const currentTime = Math.floor(Date.now() / 1000);
  
  // Filter valid caster stakes: currentTime < unlockTime
  const validCasterStakes = casterStakeAmounts
    .map((amount, index) => ({
      amount: BigInt(amount || '0'),
      unlockTime: casterStakeUnlockTimes[index] || 0,
    }))
    .filter(stake => stake.unlockTime > currentTime);
  
  // Calculate total valid caster staked
  const totalCasterStaked = validCasterStakes.reduce((sum, stake) => sum + stake.amount, BigInt(0));
  
  // For supporter stakes, we don't have unlock times in DB, so we'll use all of them
  // This is a limitation - ideally we'd filter by unlock time too
  const totalSupporterStaked = supporterStakeAmounts.reduce(
    (sum, amount) => sum + BigInt(amount || '0'),
    BigInt(0)
  );
  
  // Convert to numbers (HIGHER tokens with 18 decimals)
  const casterStakedNum = parseFloat(formatUnits(totalCasterStaked, 18));
  const supporterStakedNum = parseFloat(formatUnits(totalSupporterStaked, 18));
  
  return {
    totalCasterStaked: casterStakedNum,
    totalSupporterStaked: supporterStakedNum,
  };
}

export function OnboardingModal({ onClose, userFid, walletBalance = 0, onStakeSuccess }: OnboardingModalProps) {
  // Cast cards state
  const [casts, setCasts] = useState<CastCard[]>([]);
  const [loadingCasts, setLoadingCasts] = useState(true);
  const [selectedCastHash, setSelectedCastHash] = useState<string | null>(null);
  const [showCreateCast, setShowCreateCast] = useState(false);
  
  // Create cast state
  const [customMessage, setCustomMessage] = useState('');
  const [castUrl, setCastUrl] = useState('');
  const [urlValidationError, setUrlValidationError] = useState<string | null>(null);
  const [validatingUrl, setValidatingUrl] = useState(false);
  
  // Staking form state
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
  
  // Scroll state for cards
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  
  // Wagmi hooks
  const { address: wagmiAddress } = useAccount();
  
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

  // Fetch all casts on mount
  useEffect(() => {
    const fetchCasts = async () => {
      setLoadingCasts(true);
      try {
        const response = await fetch(`/api/user/casts/all?fid=${userFid}`);
        if (response.ok) {
          const data = await response.json();
          const castsWithTotals = data.casts.map((cast: any) => {
            const { totalCasterStaked, totalSupporterStaked } = calculateStakeTotals(
              cast.casterStakeAmounts || [],
              cast.casterStakeUnlockTimes || [],
              cast.supporterStakeAmounts || [],
              cast.totalHigherStaked
            );
            
            return {
              hash: cast.hash,
              text: cast.text,
              description: cast.description,
              timestamp: cast.timestamp,
              castState: cast.castState,
              rank: cast.rank,
              totalHigherStaked: cast.totalHigherStaked,
              totalCasterStaked,
              totalSupporterStaked,
              casterStakeLockupIds: cast.casterStakeLockupIds || [],
              casterStakeAmounts: cast.casterStakeAmounts || [],
              casterStakeUnlockTimes: cast.casterStakeUnlockTimes || [],
              supporterStakeLockupIds: cast.supporterStakeLockupIds || [],
              supporterStakeAmounts: cast.supporterStakeAmounts || [],
              supporterStakeFids: cast.supporterStakeFids || [],
            };
          });
          setCasts(castsWithTotals);
        } else {
          console.error('Failed to fetch casts');
          setCasts([]);
        }
      } catch (error) {
        console.error('Error fetching casts:', error);
        setCasts([]);
      } finally {
        setLoadingCasts(false);
      }
    };
    
    fetchCasts();
  }, [userFid]);

  // Check scroll position for dots indicator
  useEffect(() => {
    const checkScroll = () => {
      if (!scrollContainerRef.current) return;
      const container = scrollContainerRef.current;
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth - 1
      );
    };
    
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScroll);
      checkScroll();
      return () => container.removeEventListener('scroll', checkScroll);
    }
  }, [casts]);

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

  // Chain createLockUp after approve succeeds
  useEffect(() => {
    if (!isApproveSuccess || !approveReceipt || !createLockUpParams || !wagmiAddress || !selectedCastHash || hasScheduledCreateLockUp.current) {
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
            selectedCastHash // Use selected cast hash as title
          ],
        });
      } catch (error: any) {
        console.error('[Onboarding] CreateLockUp error:', error);
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
  }, [isApproveSuccess, approveReceipt, wagmiAddress, selectedCastHash, writeContractCreateLockUp]);

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
      setLockupDuration('');
      setLockupDurationUnit('day');
      setSelectedCastHash(null);
      hasScheduledCreateLockUp.current = false;
      
      console.log('[Onboarding] Stake transaction successful - Webhook will refresh UI');
      
      // Refresh casts list
      const fetchCasts = async () => {
        try {
          const response = await fetch(`/api/user/casts/all?fid=${userFid}`);
          if (response.ok) {
            const data = await response.json();
            const castsWithTotals = data.casts.map((cast: any) => {
              const { totalCasterStaked, totalSupporterStaked } = calculateStakeTotals(
                cast.casterStakeAmounts || [],
                cast.casterStakeUnlockTimes || [],
                cast.supporterStakeAmounts || [],
                cast.totalHigherStaked
              );
              
              return {
                hash: cast.hash,
                text: cast.text,
                description: cast.description,
                timestamp: cast.timestamp,
                castState: cast.castState,
                rank: cast.rank,
                totalHigherStaked: cast.totalHigherStaked,
                totalCasterStaked,
                totalSupporterStaked,
                casterStakeLockupIds: cast.casterStakeLockupIds || [],
                casterStakeAmounts: cast.casterStakeAmounts || [],
                casterStakeUnlockTimes: cast.casterStakeUnlockTimes || [],
                supporterStakeLockupIds: cast.supporterStakeLockupIds || [],
                supporterStakeAmounts: cast.supporterStakeAmounts || [],
                supporterStakeFids: cast.supporterStakeFids || [],
              };
            });
            setCasts(castsWithTotals);
          }
        } catch (error) {
          console.error('Error refreshing casts:', error);
        }
      };
      
      fetchCasts();
      
      // Call parent callback
      onStakeSuccess?.();
    }
  }, [isCreateLockUpSuccess, createLockUpHash, onStakeSuccess, userFid]);

  // Error handling
  useEffect(() => {
    if (approveError || createLockUpError) {
      setStakeError((approveError || createLockUpError)?.message || 'Transaction failed');
      setPendingCreateLockUp(false);
      hasScheduledCreateLockUp.current = false;
    }
  }, [approveError, createLockUpError]);

  const handleQuickCast = async () => {
    try {
      console.log('Opening cast composer...');
      const fullMessage = "started aiming higher and it worked out! " + customMessage;
      const result = await sdk.actions.composeCast({
        text: fullMessage,
        channelKey: "higher"
      });
      console.log('Compose cast result:', result);
      
      // If result contains cast hash, refresh casts list
      if (result?.cast?.hash && result?.cast?.text) {
        console.log('Got cast hash from composeCast:', result.cast.hash);
        
        // Refresh casts list after a short delay (cast may not be in DB yet)
        setTimeout(() => {
          const fetchCasts = async () => {
            try {
              const response = await fetch(`/api/user/casts/all?fid=${userFid}`);
              if (response.ok) {
                const data = await response.json();
                const castsWithTotals = data.casts.map((cast: any) => {
                  const { totalCasterStaked, totalSupporterStaked } = calculateStakeTotals(
                    cast.casterStakeAmounts || [],
                    cast.casterStakeUnlockTimes || [],
                    cast.supporterStakeAmounts || [],
                    cast.totalHigherStaked
                  );
                  
                  return {
                    hash: cast.hash,
                    text: cast.text,
                    description: cast.description,
                    timestamp: cast.timestamp,
                    castState: cast.castState,
                    rank: cast.rank,
                    totalHigherStaked: cast.totalHigherStaked,
                    totalCasterStaked,
                    totalSupporterStaked,
                    casterStakeLockupIds: cast.casterStakeLockupIds || [],
                    casterStakeAmounts: cast.casterStakeAmounts || [],
                    casterStakeUnlockTimes: cast.casterStakeUnlockTimes || [],
                    supporterStakeLockupIds: cast.supporterStakeLockupIds || [],
                    supporterStakeAmounts: cast.supporterStakeAmounts || [],
                    supporterStakeFids: cast.supporterStakeFids || [],
                  };
                });
                setCasts(castsWithTotals);
                setShowCreateCast(false);
                setCustomMessage('');
              }
            } catch (error) {
              console.error('Error refreshing casts:', error);
            }
          };
          
          fetchCasts();
        }, 2000);
      }
    } catch (error) {
      console.error("Failed to open cast composer:", error);
    }
  };

  const handleValidateAndUseCastUrl = async () => {
    setUrlValidationError(null);
    setValidatingUrl(true);
    
    try {
      console.log('[Onboarding] Validating cast URL:', castUrl);
      
      let identifierToLookup = castUrl.trim();
      let isFullUrl = false;
      
      // Extract hash from various URL formats
      if (identifierToLookup.includes('farcaster.xyz')) {
        isFullUrl = true;
        console.log('[Onboarding] Using full farcaster.xyz URL as-is:', identifierToLookup);
      } else if (identifierToLookup.includes('warpcast.com')) {
        const match = identifierToLookup.match(/warpcast\.com\/[^/]+\/([a-zA-Z0-9]+)$/);
        if (match && match[1]) {
          if (!match[1].startsWith('0x')) {
            identifierToLookup = '0x' + match[1];
          } else {
            identifierToLookup = match[1];
          }
          console.log('[Onboarding] Extracted hash from warpcast.com URL:', identifierToLookup);
        } else {
          setUrlValidationError('Invalid Warpcast URL format');
          setValidatingUrl(false);
          return;
        }
      } else {
        if (!identifierToLookup.startsWith('0x') && /^[a-fA-F0-9]+$/.test(identifierToLookup)) {
          identifierToLookup = '0x' + identifierToLookup;
        }
        console.log('[Onboarding] Using as-is (assuming hash):', identifierToLookup);
      }
      
      if (!identifierToLookup) {
        setUrlValidationError('Invalid cast URL format');
        setValidatingUrl(false);
        return;
      }
      
      // Validate the cast using Neynar API
      console.log('[Onboarding] Calling validation API with:', identifierToLookup);
      const response = await fetch(`/api/validate-cast?hash=${encodeURIComponent(identifierToLookup)}&isUrl=${isFullUrl}`);
      const data = await response.json();
      
      console.log('[Onboarding] Validation response:', data);
      
      if (data.valid && data.fid === userFid) {
        console.log('[Onboarding] Cast is valid');
        setUrlValidationError(null);
        setCastUrl('');
        
        // Refresh casts list after a short delay
        setTimeout(() => {
          const fetchCasts = async () => {
            try {
              const response = await fetch(`/api/user/casts/all?fid=${userFid}`);
              if (response.ok) {
                const data = await response.json();
                const castsWithTotals = data.casts.map((cast: any) => {
                  const { totalCasterStaked, totalSupporterStaked } = calculateStakeTotals(
                    cast.casterStakeAmounts || [],
                    cast.casterStakeUnlockTimes || [],
                    cast.supporterStakeAmounts || [],
                    cast.totalHigherStaked
                  );
                  
                  return {
                    hash: cast.hash,
                    text: cast.text,
                    description: cast.description,
                    timestamp: cast.timestamp,
                    castState: cast.castState,
                    rank: cast.rank,
                    totalHigherStaked: cast.totalHigherStaked,
                    totalCasterStaked,
                    totalSupporterStaked,
                    casterStakeLockupIds: cast.casterStakeLockupIds || [],
                    casterStakeAmounts: cast.casterStakeAmounts || [],
                    casterStakeUnlockTimes: cast.casterStakeUnlockTimes || [],
                    supporterStakeLockupIds: cast.supporterStakeLockupIds || [],
                    supporterStakeAmounts: cast.supporterStakeAmounts || [],
                    supporterStakeFids: cast.supporterStakeFids || [],
                  };
                });
                setCasts(castsWithTotals);
                setShowCreateCast(false);
              }
            } catch (error) {
              console.error('Error refreshing casts:', error);
            }
          };
          
          fetchCasts();
        }, 2000);
      } else if (data.valid && data.fid !== userFid) {
        console.log('[Onboarding] Cast belongs to different user:', data.fid, 'vs', userFid);
        setUrlValidationError('This cast belongs to a different user');
      } else {
        console.log('[Onboarding] Cast invalid, reason:', data.reason || 'unknown');
        setUrlValidationError(data.reason || 'Cast not found or invalid');
      }
    } catch (error) {
      console.error('Error validating cast URL:', error);
      setUrlValidationError('Failed to validate cast URL');
    } finally {
      setValidatingUrl(false);
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

  const handleStake = async (castHash: string) => {
    if (!wagmiAddress) {
      setStakeError('No wallet connected');
      return;
    }

    // Validate that cast exists and belongs to user (caster-only staking)
    try {
      const castResponse = await fetch(`/api/cast/${castHash}`);
      if (castResponse.ok) {
        const castInfo = await castResponse.json();
        if (castInfo.fid !== userFid) {
          setStakeError('Only the caster can stake on their own cast');
          return;
        }
        // Check cast state - must be 'valid' or 'higher' (expired casts can be re-staked)
        if (castInfo.state && castInfo.state !== 'valid' && castInfo.state !== 'higher' && castInfo.state !== 'expired') {
          setStakeError('Cast is not valid for staking');
          return;
        }
      } else if (castResponse.status === 404) {
        setStakeError('Higher cast not found. Please create a valid cast first.');
        return;
      }
    } catch (error) {
      console.error('[Onboarding] Error validating cast ownership:', error);
      setStakeError('Failed to validate cast ownership');
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
    if (amountNum > walletBalance) {
      setStakeError('Amount exceeds wallet balance');
      return;
    }

    setStakeError(null);

    try {
      // Convert amount to wei (18 decimals)
      const amountWei = parseUnits(stakeAmount.replace(/,/g, ''), 18);
      
      // Calculate unlock time (current time + duration in seconds)
      const durationSeconds = durationToSeconds(durationNum, lockupDurationUnit);
      const unlockTime = Math.floor(Date.now() / 1000) + durationSeconds;
      
      // Validate unlockTime fits in uint40
      if (unlockTime > 0xFFFFFFFF) {
        setStakeError('Duration too long (exceeds maximum)');
        return;
      }

      // Store params for createLockUp (will be called after approve succeeds or if already approved)
      setCreateLockUpParams({ amountWei, unlockTime });
      setSelectedCastHash(castHash);

      // Step 1: Check if we need to approve (only approve if current allowance is insufficient)
      const allowance = currentAllowance || BigInt(0);
      
      if (allowance >= amountWei) {
        console.log('[Onboarding] Sufficient allowance exists, skipping approve');
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
            console.error('[Onboarding] CreateLockUp error:', error);
            setStakeError(error?.message || 'Failed to create lockup');
            setPendingCreateLockUp(false);
            hasScheduledCreateLockUp.current = false;
          }
        }, 100);
        
        createLockUpTimeoutRef.current = delay;
        setCreateLockUpParams(null);
      } else {
        console.log('[Onboarding] Insufficient allowance, calling approve');
        // Step 1: Approve the lockup contract to spend tokens
        writeContractApprove({
          address: HIGHER_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [LOCKUP_CONTRACT, amountWei],
        });
      }
    } catch (error: any) {
      setStakeError(error?.message || 'Failed to initiate stake');
      console.error('Stake error:', error);
    }
  };

  const isLoadingTransaction = isApprovePending || isApproveConfirming || isCreateLockUpPending || isCreateLockUpConfirming || pendingCreateLockUp;

  // Create Cast Flow Component
  const CreateCastFlow = () => (
    <>
      <h2 className="text-xl font-bold mb-4 text-black border-b-2 border-black pb-2">
        Are you aiming higher today?
      </h2>
      
      <p className="mb-3 text-black text-sm">
        Start your journey with /higher:
      </p>
      
      <div className="bg-[#f9f7f1] p-4 border border-black/20 mb-4">
        <div className="text-xs text-black font-mono mb-2">
          <strong>started aiming higher and it worked out!</strong>
        </div>
        <textarea
          value={customMessage}
          onChange={(e) => setCustomMessage(e.target.value)}
          placeholder="[your message here]"
          className="w-full text-xs font-mono bg-white border border-black/20 p-2 text-black placeholder-black/40 focus:outline-none focus:border-black resize-none"
          rows={3}
        />
      </div>

      <div className="relative mb-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-black/20"></div>
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-[#fefdfb] px-2 text-black/60">Or</span>
        </div>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={castUrl}
          onChange={(e) => {
            setCastUrl(e.target.value);
            setUrlValidationError(null);
          }}
          placeholder="Paste your cast URL here..."
          className="w-full text-xs font-mono bg-white border border-black/20 p-2 text-black placeholder-black/40 focus:outline-none focus:border-black"
        />
        {urlValidationError && (
          <div className="mt-2 text-xs text-red-600">
            {urlValidationError}
          </div>
        )}
      </div>
      
      <div className="flex gap-3 border-t border-black/20 pt-4">
        <button
          onClick={handleQuickCast}
          className="flex-1 px-4 py-2.5 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm"
        >
          Cast to /higher
        </button>
        {castUrl && (
          <button
            onClick={handleValidateAndUseCastUrl}
            disabled={validatingUrl}
            className="relative group flex-1 px-4 py-2.5 bg-purple-600 text-white font-bold border-2 border-purple-600 hover:bg-purple-700 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {validatingUrl ? 'Validating...' : 'Use URL'}
            <span className="absolute top-0 right-0 text-xs opacity-60 group-hover:opacity-100">ⓘ</span>
            <div className="absolute bottom-full right-0 mb-2 w-64 bg-black text-white text-xs p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              Valid cast must begin with "started aiming higher and it worked out!" and be cast by you
            </div>
          </button>
        )}
      </div>
      
      <div className="mt-3">
        <button
          onClick={() => {
            setShowCreateCast(false);
            setCustomMessage('');
            setCastUrl('');
            setUrlValidationError(null);
          }}
          className="text-xs text-black/60 hover:text-black underline"
        >
          Cancel
        </button>
      </div>
    </>
  );

  // Cast Cards View Component
  const CastCardsView = () => {
    const selectedCast = casts.find(c => c.hash === selectedCastHash);
    
    return (
      <>
        <h2 className="text-xl font-bold mb-4 text-black border-b-2 border-black pb-2">
          You are aiming higher!
        </h2>
        
        {/* Horizontal scrolling cards */}
        <div className="mb-4">
          <div
            ref={scrollContainerRef}
            className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2"
            style={{ scrollbarWidth: 'thin' }}
          >
            {casts.map((cast) => (
              <div
                key={cast.hash}
                className="bg-[#f9f7f1] p-4 border border-black/20 rounded-none flex-shrink-0 w-[320px] snap-start"
              >
                <div className="text-xs text-black font-mono mb-2">
                  <strong>started aiming higher and it worked out!</strong> {cast.description}
                </div>
                {cast.timestamp && (
                  <div className="text-xs text-black/50 font-mono mb-3">
                    {formatTimestamp(cast.timestamp)}
                  </div>
                )}
                
                <div className="border-t border-black/20 pt-3 mt-3">
                  {cast.castState === 'higher' ? (
                    <>
                      <div className="text-sm text-black font-bold mb-1">
                        Rank: {cast.rank ? `#${cast.rank}` : 'Unranked'}
                      </div>
                      <div className="text-xs text-black/80 mb-2">
                        {cast.totalHigherStaked.toFixed(2)} HIGHER staked
                      </div>
                      <div className="text-xs text-black/60 flex items-center gap-1">
                        <img 
                          src="/higher-logo.png" 
                          alt="HIGHER" 
                          className="w-3 h-3 rounded-full"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        <span>{cast.totalCasterStaked.toFixed(2)}</span>
                        <span className="text-black/40">|</span>
                        <span>{cast.totalSupporterStaked.toFixed(2)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-black/60 italic mb-2">
                      This cast is expired, add stake to rejoin the leaderboard
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setSelectedCastHash(cast.hash);
                      setShowStakingForm(true);
                    }}
                    className="mt-2 w-full px-4 py-2 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition"
                  >
                    Add stake
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          {/* Dots indicator */}
          {casts.length > 1 && (
            <div className="flex justify-center gap-1 mt-2">
              {canScrollLeft && <span className="text-xs text-black/40">●</span>}
              {canScrollRight && <span className="text-xs text-black/40">●</span>}
            </div>
          )}
        </div>
        
        {/* Staking form */}
        {showStakingForm && selectedCast && (
          <div className="border-t border-black/20 pt-4 mt-4">
            <h3 className="text-sm font-bold mb-3">Add stake to this cast</h3>
            
            <div className="mb-3">
              <label className="text-xs text-black/70 mb-1 block">Amount (HIGHER)</label>
              <input
                type="text"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                placeholder="0.00"
                className="w-full text-sm font-mono bg-white border border-black/20 p-2 text-black focus:outline-none focus:border-black"
              />
              <div className="text-xs text-black/50 mt-1">
                Available: {walletBalance.toFixed(2)} HIGHER
              </div>
            </div>

            <div className="mb-3">
              <label className="text-xs text-black/70 mb-1 block">Duration</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={lockupDuration}
                  onChange={(e) => setLockupDuration(e.target.value)}
                  placeholder="1"
                  min="1"
                  className="flex-1 text-sm font-mono bg-white border border-black/20 p-2 text-black focus:outline-none focus:border-black"
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

            {stakeError && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs">
                {stakeError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => handleStake(selectedCast.hash)}
                disabled={isLoadingTransaction}
                className="relative group flex-1 px-4 py-2.5 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingTransaction ? 'Staking...' : (
                  <span className="flex items-center justify-center gap-1">
                    Stake <span className="text-sm">ⓘ</span>
                  </span>
                )}
                <div className="absolute bottom-full left-0 mb-2 w-72 bg-black text-white text-xs p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  Uses mint.club lockup contracts for secure token staking (<a href="https://mint.club/lockup/create" target="_blank" rel="noopener noreferrer" className="underline">https://mint.club/lockup/create</a>)
                </div>
              </button>
              <button
                onClick={() => {
                  setShowStakingForm(false);
                  setStakeError(null);
                  setStakeAmount('');
                  setLockupDuration('');
                  setLockupDurationUnit('day');
                  setSelectedCastHash(null);
                }}
                className="px-4 py-2.5 bg-white text-black border-2 border-black/20 hover:border-black transition text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        
        {/* Buy HIGHER button */}
        {!showStakingForm && (
          <div className="border-t border-black/20 pt-4 mt-4">
            <button
              onClick={handleSwapToHigher}
              className="w-full px-4 py-2.5 bg-purple-600 text-white font-bold border-2 border-purple-600 hover:bg-purple-700 transition text-sm"
            >
              Buy HIGHER
            </button>
          </div>
        )}
        
        {/* Create new cast link */}
        <div className="mt-3 text-center">
          <button
            onClick={() => setShowCreateCast(true)}
            className="text-xs text-black/60 hover:text-black underline"
          >
            Create new cast
          </button>
        </div>
      </>
    );
  };

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#fefdfb] border-2 border-black rounded-none p-6 max-w-md w-full relative font-mono shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 10px 25px rgba(0, 0, 0, 0.3)',
          maxHeight: '90vh',
          maxWidth: 'min(448px, calc(100vw - 2rem))'
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-black/40 hover:text-black transition z-10"
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
        
        <div className="overflow-y-auto flex-1 min-h-0">
          {loadingCasts ? (
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
          ) : showCreateCast || casts.length === 0 ? (
            <CreateCastFlow />
          ) : (
            <CastCardsView />
          )}
        </div>
      </div>
    </div>
  );
}
