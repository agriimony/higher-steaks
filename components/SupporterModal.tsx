'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { sdk } from '@farcaster/miniapp-sdk';
import { LOCKUP_CONTRACT, HIGHER_TOKEN_ADDRESS, LOCKUP_ABI, ERC20_ABI } from '@/lib/contracts';
import { formatTimeRemaining } from '@/lib/supporter-helpers';
import { SupporterLeaderboardModal } from './SupporterLeaderboardModal';

interface SupporterModalProps {
  castHash: string;
  onClose: () => void;
  userFid: number | null;
  walletBalance?: number;
  onStakeSuccess?: () => void;
  onTransactionFailure?: (message?: string) => void;
  onLockSuccess?: (txHash?: string, castHash?: string, amount?: string, unlockTime?: number, lockupId?: string) => void;
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
  topSupporters: Array<{ fid: number; totalAmount: string }>;
  totalUniqueSupporters: number;
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

export function SupporterModal({
  castHash,
  onClose,
  userFid,
  walletBalance = 0,
  onStakeSuccess,
  onTransactionFailure,
  onLockSuccess,
}: SupporterModalProps) {
  const [castData, setCastData] = useState<CastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStakingForm, setShowStakingForm] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('');
  const [lockupDuration, setLockupDuration] = useState<string>('');
  const [lockupDurationUnit, setLockupDurationUnit] = useState<'minute' | 'day' | 'week' | 'month' | 'year'>('day');
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [supporterPfpMap, setSupporterPfpMap] = useState<Record<number, string>>({});
  
  // Staking transaction state
  const [pendingCreateLockUp, setPendingCreateLockUp] = useState(false);
  const [createLockUpParams, setCreateLockUpParams] = useState<{
    amountWei: bigint;
    unlockTime: number;
  } | null>(null);
  // Store metadata keyed by transaction hash to handle multiple concurrent stakes
  const pendingStakeMetadataRef = useRef<Map<string, { amount: string; unlockTime: number }>>(new Map());
  
  // Wagmi hooks
  const { address: wagmiAddress, isConnected } = useAccount();
  
  // Read balance from connected wallet address
  const { data: walletBalanceRaw } = useReadContract({
    address: HIGHER_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: wagmiAddress ? [wagmiAddress] : undefined,
    query: {
      enabled: !!wagmiAddress,
      refetchInterval: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });
  
  // Convert balance from wei to number (18 decimals)
  const connectedWalletBalance = walletBalanceRaw 
    ? parseFloat(formatUnits(walletBalanceRaw, 18))
    : 0; // Fallback to 0 if no wallet connected
  
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
  // Store params key for pending transactions to enable metadata lookup
  const pendingParamsKeyRef = useRef<string | null>(null);
  const reportStakeError = useCallback((message: string) => {
    setStakeError(message);
  }, []);

  const reportTransactionFailure = useCallback(
    (message?: string) => {
      onTransactionFailure?.(message);
    },
    [onTransactionFailure]
  );

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
  // Updated validation logic: check DB first, then Neynar, show error if both fail
  useEffect(() => {
    const fetchCastData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Step 1: Check if cast exists in database
        const dbUrl = `/api/cast/${castHash}${userFid ? `?userFid=${userFid}` : ''}`;
        const dbResponse = await fetch(dbUrl);
        
        if (dbResponse.ok) {
          const dbData = await dbResponse.json();
          
          // If cast_state is 'higher' or 'expired', use DB data directly
          if (dbData.state === 'higher' || dbData.state === 'expired') {
            setCastData(dbData);
            setLoading(false);
            return;
          }
          
          // If cast_state is 'valid' or 'invalid', fallback to Neynar validation
          if (dbData.state === 'valid' || dbData.state === 'invalid') {
            try {
              const neynarResponse = await fetch(`/api/validate-cast?hash=${encodeURIComponent(castHash)}&isUrl=false`);
              if (neynarResponse.ok) {
                const neynarData = await neynarResponse.json();
                if (neynarData.valid) {
                  // Merge Neynar data with DB data (prefer DB for stake info, Neynar for cast text)
                  setCastData({
                    ...dbData,
                    castText: neynarData.castText || dbData.castText,
                    description: neynarData.description || dbData.description,
                    username: neynarData.author?.username || dbData.username,
                    displayName: neynarData.author?.display_name || dbData.displayName,
                    pfpUrl: neynarData.author?.pfp_url || dbData.pfpUrl,
                  });
                  setLoading(false);
                  return;
                }
              }
            } catch (neynarError) {
              console.error('[SupporterModal] Error validating cast via Neynar:', neynarError);
            }
            
            // Neynar validation failed, but we have DB data - use it anyway
            setCastData(dbData);
            setLoading(false);
            return;
          }
          
          // If we got DB data but state is unexpected, use it
          setCastData(dbData);
          setLoading(false);
          return;
        }
      } catch (dbError) {
        console.error('[SupporterModal] Error checking DB for cast:', dbError);
      }
      
      // Step 2: If not found in DB, call /api/validate-cast (Neynar fallback)
      try {
        const validateResponse = await fetch(`/api/validate-cast?hash=${encodeURIComponent(castHash)}&isUrl=false`);
        if (validateResponse.ok) {
          const validateData = await validateResponse.json();
          if (validateData.valid) {
            // Convert Neynar response to CastData format
            setCastData({
              hash: validateData.hash,
              fid: validateData.fid,
              username: validateData.author?.username || 'unknown',
              displayName: validateData.author?.display_name || 'unknown',
              pfpUrl: validateData.author?.pfp_url || '',
              castText: validateData.castText || '',
              description: validateData.description || '',
              timestamp: validateData.timestamp || '',
              state: validateData.state || 'valid',
              totalHigherStaked: '0',
              usdValue: null,
              rank: null,
              maxCasterUnlockTime: 0,
              minCasterUnlockTime: 0,
              totalCasterStaked: '0',
              totalSupporterStaked: '0',
              casterStakes: [],
              topSupporters: [],
              totalUniqueSupporters: 0,
              connectedUserStake: undefined,
            });
            setLoading(false);
            return;
          }
        }
      } catch (validateError) {
        console.error('[SupporterModal] Error validating cast via Neynar:', validateError);
      }
      
      // Step 3: If both fail, show error
      setError('Cast not found or invalid. Please check the cast hash and try again.');
      setLoading(false);
    };

    if (castHash) {
      fetchCastData();
    }
  }, [castHash, userFid]);

  // Fetch latest supporter PFPs for top supporters + connected user (if supporting)
  useEffect(() => {
    const fetchSupporterPfps = async () => {
      if (!castData) return;

      const fidsToFetch: number[] = [];
      const seen = new Set<number>();

      // Include connected user first (if supporting)
      if (castData.connectedUserStake?.fid && castData.connectedUserStake.fid > 0) {
        seen.add(castData.connectedUserStake.fid);
        fidsToFetch.push(castData.connectedUserStake.fid);
      }

      // Include top supporters
      for (const s of (castData.topSupporters || [])) {
        if (!s?.fid || s.fid <= 0) continue;
        if (seen.has(s.fid)) continue;
        seen.add(s.fid);
        fidsToFetch.push(s.fid);
      }

      if (fidsToFetch.length === 0) {
        setSupporterPfpMap({});
        return;
      }

      try {
        const res = await fetch(`/api/user/profiles?fids=${encodeURIComponent(fidsToFetch.join(','))}`);
        if (!res.ok) {
          setSupporterPfpMap({});
          return;
        }
        const data = await res.json();
        const next: Record<number, string> = {};
        for (const u of (data?.users ?? [])) {
          const fid = Number(u?.fid || 0);
          if (!Number.isFinite(fid) || fid <= 0) continue;
          next[fid] = String(u?.pfpUrl || '');
        }
        setSupporterPfpMap(next);
      } catch (e) {
        console.error('[SupporterModal] Failed to fetch supporter PFPs:', e);
        setSupporterPfpMap({});
      }
    };

    fetchSupporterPfps();
  }, [castData]);


  // Chain createLockUp after approve succeeds
  useEffect(() => {
    if (!isApproveSuccess || !approveReceipt || !createLockUpParams || !wagmiAddress || !castHash || hasScheduledCreateLockUp.current || !isConnected) {
      return;
    }

    hasScheduledCreateLockUp.current = true;
    const paramsToUse = createLockUpParams;
    // Create a unique key for this transaction based on params
    const paramsKey = `${paramsToUse.amountWei.toString()}-${paramsToUse.unlockTime}`;
    // Store params key for later lookup when hash is available
    pendingParamsKeyRef.current = paramsKey;

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
        // Metadata is already stored with paramsKey - will be moved to hash key when hash is available
      } catch (error: any) {
        console.error('[SupporterModal] CreateLockUp error:', error);
        const message = error?.message || 'Failed to create lockup';
        reportStakeError(message);
        reportTransactionFailure(message);
        setPendingCreateLockUp(false);
        hasScheduledCreateLockUp.current = false;
        // Clean up metadata on error
        pendingStakeMetadataRef.current.delete(paramsKey);
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

  // Move metadata from params key to hash key when transaction hash becomes available
  useEffect(() => {
    if (createLockUpHash) {
      // Try to find metadata using stored params key or current createLockUpParams
      let paramsKey: string | null = null;
      if (pendingParamsKeyRef.current) {
        paramsKey = pendingParamsKeyRef.current;
        pendingParamsKeyRef.current = null; // Clear after use
      } else if (createLockUpParams) {
        paramsKey = `${createLockUpParams.amountWei.toString()}-${createLockUpParams.unlockTime}`;
      }
      
      if (paramsKey) {
        const metadata = pendingStakeMetadataRef.current.get(paramsKey);
        if (metadata) {
          // Move metadata from params key to hash key
          pendingStakeMetadataRef.current.set(createLockUpHash, metadata);
          pendingStakeMetadataRef.current.delete(paramsKey);
        }
      }
    }
  }, [createLockUpHash, createLockUpParams]);

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
      setStakeError(null);
      
      // Call success callback with metadata for optimistic update
      // Look up metadata by transaction hash
      const metadata = pendingStakeMetadataRef.current.get(createLockUpHash);
      if (metadata) {
        // Generate temporary lockupId from tx hash (will be replaced when Dune updates)
        const tempLockupId = `temp-${createLockUpHash}`;
        onLockSuccess?.(createLockUpHash, castHash, metadata.amount, metadata.unlockTime, tempLockupId);
        // Clean up metadata after use
        pendingStakeMetadataRef.current.delete(createLockUpHash);
      } else {
        onLockSuccess?.(createLockUpHash, castHash);
      }
      onStakeSuccess?.();

      // Trigger supporter notification (only for supporter stakes on other users' casts)
      if (userFid && castData && castData.fid !== userFid && metadata) {
        fetch('/api/notifications/send-supporter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            castHash,
            supporterFid: userFid,
            amount: metadata.amount,
            txHash: createLockUpHash,
          }),
        }).catch(err => console.error('[SupporterModal] Failed to send supporter notification:', err));
      }
    }
  }, [isCreateLockUpSuccess, createLockUpHash, onStakeSuccess, onLockSuccess, castHash]);

  // Handle transaction errors
  useEffect(() => {
    if (approveError || createLockUpError) {
      const message = (approveError || createLockUpError)?.message || 'Transaction failed';
      reportStakeError(message);
      reportTransactionFailure(message);
      setPendingCreateLockUp(false);
      hasScheduledCreateLockUp.current = false;
    }
  }, [approveError, createLockUpError, reportStakeError, reportTransactionFailure]);

  const handleStake = async () => {
    if (!wagmiAddress || !isConnected) {
      reportStakeError('No wallet connected');
      return;
    }

    if (!castData) {
      reportStakeError('No valid cast found');
      return;
    }

    // Check if user is the caster
    const isCaster = userFid !== null && castData.fid === userFid;

    // Validation
    const amountStr = (stakeAmount ?? '').toString();
    const amountNum = parseFloat(amountStr.replace(/,/g, ''));
    
    if (isNaN(amountNum) || amountNum <= 0) {
      reportStakeError('Please enter a valid stake amount');
      return;
    }

    // Check balance
    if (amountNum > connectedWalletBalance) {
      reportStakeError('Amount exceeds wallet balance');
      return;
    }


    setStakeError(null);

    try {
      // Convert amount to wei (18 decimals)
      const amountWei = parseUnits(amountStr.replace(/,/g, ''), 18);
      
      let unlockTime: number;
      
      if (isCaster) {
        // Caster: calculate unlock time from user-defined duration
        const durationNum = parseFloat(lockupDuration);
        
        if (isNaN(durationNum) || durationNum <= 0) {
          reportStakeError('Please enter a valid duration');
          return;
        }
        
        // Calculate unlock time (current time + duration in seconds)
        const durationSeconds = durationToSeconds(durationNum, lockupDurationUnit);
        unlockTime = Math.floor(Date.now() / 1000) + durationSeconds;
      } else {
        // Supporter: use max caster unlock time
        if (!castData.maxCasterUnlockTime || castData.maxCasterUnlockTime <= 0) {
          reportStakeError('No valid caster stake found');
          return;
        }
        unlockTime = castData.maxCasterUnlockTime;
      }
      
      // Validate unlockTime fits in uint40
      if (unlockTime > 0xFFFFFFFF) {
        reportStakeError('Duration too long (exceeds maximum)');
        return;
      }

      // Store params for createLockUp (will be called after approve succeeds or if already approved)
      setCreateLockUpParams({ amountWei, unlockTime });
      // Store metadata for optimistic update, keyed by transaction params (will be moved to hash key when hash is available)
      const paramsKey = `${amountWei.toString()}-${unlockTime}`;
      pendingStakeMetadataRef.current.set(paramsKey, {
        amount: amountStr.replace(/,/g, ''),
        unlockTime,
      });

      // Step 1: Check if we need to approve (only approve if current allowance is insufficient)
      const allowance = currentAllowance || BigInt(0);
      
      if (allowance >= amountWei) {
        console.log('[SupporterModal] Sufficient allowance exists, skipping approve');
        // Sufficient allowance - simulate approve success to trigger createLockUp
        hasScheduledCreateLockUp.current = true;
        setPendingCreateLockUp(true);
        
        // Store params key for later lookup when hash is available
        const paramsKey = `${amountWei.toString()}-${unlockTime}`;
        pendingParamsKeyRef.current = paramsKey;
        
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
            // Metadata is already stored with paramsKey - will be moved to hash key when hash is available
          } catch (error: any) {
            console.error('[SupporterModal] CreateLockUp error:', error);
            const message = error?.message || 'Failed to create lockup';
            reportStakeError(message);
            reportTransactionFailure(message);
            setPendingCreateLockUp(false);
            hasScheduledCreateLockUp.current = false;
            // Clean up metadata on error
            pendingStakeMetadataRef.current.delete(paramsKey);
            pendingParamsKeyRef.current = null;
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
      const message = error?.message || 'Failed to stake';
      reportStakeError(message);
      reportTransactionFailure(message);
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

  const connectedUserStake = castData.connectedUserStake;

  // Check if user is the caster
  const isCaster = userFid !== null && castData.fid === userFid;

  // Format amounts
  const totalCasterStakedFormatted = formatUnits(BigInt(castData.totalCasterStaked || '0'), 18);
  const totalSupporterStakedFormatted = formatUnits(BigInt(castData.totalSupporterStaked || '0'), 18);

  const connectedSupportingFid = connectedUserStake?.fid || null;
  const displaySupporters: Array<{ fid: number; totalAmount: string }> = [];
  if (connectedSupportingFid && connectedSupportingFid > 0) {
    displaySupporters.push({ fid: connectedSupportingFid, totalAmount: connectedUserStake?.totalAmount || '0' });
  }
  for (const s of (castData.topSupporters || [])) {
    if (!s?.fid || s.fid <= 0) continue;
    if (connectedSupportingFid && s.fid === connectedSupportingFid) continue;
    displaySupporters.push({ fid: s.fid, totalAmount: s.totalAmount || '0' });
    if (displaySupporters.length >= 10) break; // cap to 10 total avatars (including connected user)
  }
  const displayedUniqueCount = new Set(displaySupporters.map(s => s.fid)).size;
  const othersCount = Math.max(0, (castData.totalUniqueSupporters || 0) - displayedUniqueCount);

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
          <a
            href={`https://farcaster.xyz/${castData.username}/${castData.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-black/70 mb-2 hover:text-purple-700 transition-colors block break-words cursor-pointer"
          >
            {castData.description}
          </a>
          <div className="text-xs text-black/50">{formatTimestamp(castData.timestamp)}</div>
        </div>

        {/* Supported By Section */}
        {(castData.totalUniqueSupporters > 0 || !!connectedUserStake) && (
          <button
            onClick={() => setShowLeaderboardModal(true)}
            className="w-full mb-4 pb-4 border-b border-black/20 text-left hover:bg-black/5 transition-colors rounded p-2 -ml-2 -mr-2"
          >
            <div className="text-xs font-bold text-black mb-2">Supported by:</div>
            <div className="flex flex-wrap gap-2 items-center">
              {displaySupporters.map((s, index) => {
                const isConnected = connectedSupportingFid !== null && s.fid === connectedSupportingFid;
                const pfp = supporterPfpMap[s.fid] || '';
                return (
                  <img
                    key={`${s.fid}-${index}`}
                    src={pfp}
                    alt={isConnected ? 'You' : `Supporter ${s.fid}`}
                    className={`w-8 h-8 rounded-full border flex-shrink-0 ${
                      isConnected ? 'border-purple-500' : 'border-black/20'
                    }`}
                    title={`FID ${s.fid}`}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                );
              })}
              {othersCount > 0 && (
                <span className="text-xs text-black/60">.. and {othersCount} others</span>
              )}
            </div>
            <div className="text-xs text-black/50 mt-2">Click to view leaderboard</div>
          </button>
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
              <div className="text-xs text-black/50 mt-1">
                Available: {connectedWalletBalance.toFixed(2)} HIGHER
              </div>
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
                    onChange={(e) => {
                      setLockupDuration(e.target.value);
                      setStakeError(null);
                    }}
                    placeholder="1"
                    min="1"
                    className="flex-1 text-sm font-mono bg-white border border-black/20 p-2 text-black placeholder-black/40 focus:outline-none focus:border-black"
                  />
                  <select
                    value={lockupDurationUnit}
                    onChange={(e) => {
                      setLockupDurationUnit(e.target.value as 'minute' | 'day' | 'week' | 'month' | 'year');
                      setStakeError(null);
                    }}
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
            {/* {stakeError && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs">
                {stakeError}
              </div>
            )} */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowStakingForm(false);
                  setStakeAmount('');
                  setLockupDuration('');
                  setLockupDurationUnit('day');
                  setStakeError(null);
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
                onClick={() => {
                  setShowStakingForm(true);
                  setStakeError(null);
                }}
                className="flex-1 px-4 py-2 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm"
              >
                Add Stake
              </button>
            ) : castData.maxCasterUnlockTime > 0 ? (
              /* Supporter: Show "Add Support" button if not expired */
              <button
                onClick={() => {
                  setShowStakingForm(true);
                  setStakeError(null);
                }}
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
      
      {/* Supporter Leaderboard Modal */}
      {showLeaderboardModal && (
        <SupporterLeaderboardModal
          castHash={castHash}
          userFid={userFid}
          onClose={() => setShowLeaderboardModal(false)}
        />
      )}
    </div>
  );
}

