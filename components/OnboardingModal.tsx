'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { sdk } from '@farcaster/miniapp-sdk';
import { LOCKUP_CONTRACT, HIGHER_TOKEN_ADDRESS, LOCKUP_ABI, ERC20_ABI } from '@/lib/contracts';
import { KEYPHRASE_TEXT } from '@/lib/constants';
import { extractDescription } from '@/lib/cast-helpers';

interface CastCard {
  hash: string;
  text: string;
  description: string;
  timestamp: string;
  castState: 'higher' | 'expired' | 'valid';
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
  username?: string; // Optional username for constructing cast URL
}

interface OnboardingModalProps {
  onClose: () => void;
  userFid: number;
  walletBalance?: number;
  onStakeSuccess?: () => void;
  onTransactionFailure?: (message?: string) => void;
  onLockSuccess?: (txHash?: string, castHash?: string, amount?: string, unlockTime?: number, lockupId?: string) => void;
  onOpenSupporterModal?: (castHash: string) => void;
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
      unlockTime: (index < casterStakeUnlockTimes.length ? casterStakeUnlockTimes[index] : 0) || 0,
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

export function OnboardingModal({
  onClose,
  userFid,
  walletBalance = 0,
  onStakeSuccess,
  onTransactionFailure,
  onLockSuccess,
  onOpenSupporterModal,
}: OnboardingModalProps) {
  // Helper function to normalize hash format (ensure 0x prefix and lowercase)
  const normalizeHash = useCallback((hash: string): string => {
    if (!hash) return hash;
    if (!hash.startsWith('0x') && /^[a-fA-F0-9]+$/.test(hash)) {
      return '0x' + hash;
    }
    return hash.toLowerCase();
  }, []);

  // Cast cards snapshot stored in ref to avoid unnecessary rerenders
  const castsRef = useRef<CastCard[]>([]);
  const [castsVersion, setCastsVersion] = useState(0);
  const replaceCasts = useCallback((next: CastCard[]) => {
    castsRef.current = next;
    setCastsVersion((v) => v + 1);
  }, []);
  const updateCasts = useCallback((updater: (prev: CastCard[]) => CastCard[]) => {
    replaceCasts(updater(castsRef.current));
  }, [replaceCasts]);

  const [loadingCasts, setLoadingCasts] = useState(true);
  const [selectedCastHash, setSelectedCastHash] = useState<string | null>(null);
  const [showCreateCast, setShowCreateCast] = useState(false);
  const [userUsername, setUserUsername] = useState<string | null>(null);
  const [otherUserCast, setOtherUserCast] = useState<{ 
    hash: string; 
    state: string; 
    hasActiveStakes: boolean; 
    casterFid: number; 
    casterUsername?: string;
    casterDisplayName?: string;
  } | null>(null);
  
  // Create cast state
  const [customMessage, setCustomMessage] = useState('');
  const [castUrl, setCastUrl] = useState('');
  const [urlValidationError, setUrlValidationError] = useState<string | null>(null);
  const [validatingUrl, setValidatingUrl] = useState(false);
  
  // Staking form state
  const [selectedCastIndex, setSelectedCastIndex] = useState<number | null>(null);
  const [stakeAmount, setStakeAmount] = useState('');
  const [lockupDuration, setLockupDuration] = useState<string>('');
  const [stakeError, setStakeError] = useState<string | null>(null);
  
  // Staking transaction state
  const [pendingCreateLockUp, setPendingCreateLockUp] = useState(false);
  const [createLockUpParams, setCreateLockUpParams] = useState<{
    amountWei: bigint;
    unlockTime: number;
  } | null>(null);
  // Metadata storage for optimistic updates (keyed by params key or tx hash)
  const pendingStakeMetadataRef = useRef<Map<string, { amount: string; unlockTime: number }>>(new Map());
  const pendingParamsKeyRef = useRef<string | null>(null);
  
  // Card navigation state
  const castUrlInputRef = useRef<HTMLInputElement>(null);
  const stakeAmountInputRef = useRef<HTMLInputElement>(null);
  const lockupDurationInputRef = useRef<HTMLInputElement>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);

  
  // Wagmi hooks
  const { address: wagmiAddress } = useAccount();
  
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
  // Only read when we're in staking mode (not create cast flow)
  const { data: currentAllowance } = useReadContract({
    address: HIGHER_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: wagmiAddress && !showCreateCast && castsRef.current.length > 0 ? [wagmiAddress, LOCKUP_CONTRACT] : undefined,
    query: {
      enabled: !!wagmiAddress && !showCreateCast && castsRef.current.length > 0,
      refetchInterval: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
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
  const transactionErrorReportedRef = useRef(false);

  const reportStakeError = useCallback((message: string) => {
    setStakeError(message);
  }, []);

  const reportTransactionFailure = useCallback(
    (message?: string) => {
      onTransactionFailure?.(message);
    },
    [onTransactionFailure]
  );

  // Fetch user username on mount
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const response = await fetch(`/api/user/profile?fid=${userFid}`);
        if (response.ok) {
          const profileData = await response.json();
          setUserUsername(profileData.username);
        }
      } catch (error) {
        console.error('[OnboardingModal] Error fetching user profile:', error);
      }
    };
    fetchUserProfile();
  }, [userFid]);

  // Fetch all casts on mount (single snapshot)
  useEffect(() => {
    let isMounted = true;
    const fetchCasts = async () => {
      setLoadingCasts(true);
      try {
        const response = await fetch(`/api/user/casts/all?fid=${userFid}`);
        if (response.ok && isMounted) {
          const data = await response.json();
          const castsWithTotals: CastCard[] = data.casts.map((cast: any) => {
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
              username: cast.username,
            };
          });

          updateCasts(() => {
            const prevCasts = castsRef.current;
            const temporary = prevCasts.filter(
              (cast) =>
                cast.castState === 'valid' &&
                !castsWithTotals.find((apiCast) => apiCast.hash === cast.hash)
            );
            const combined = [...castsWithTotals, ...temporary];
            const unique: CastCard[] = [];
            const seen = new Set<string>();
            for (const cast of combined) {
              if (!seen.has(cast.hash)) {
                seen.add(cast.hash);
                unique.push(cast);
              }
            }
            return unique;
          });
        }
      } catch {
        // ignore, keep previous snapshot
      } finally {
        if (isMounted) {
          setLoadingCasts(false);
        }
      }
    };

    fetchCasts();
    return () => {
      isMounted = false;
    };
  }, [userFid, updateCasts]);

  // Reset activeCardIndex if it's out of bounds when casts change
  useEffect(() => {
    const currentCasts = castsRef.current;
    if (currentCasts.length > 0 && activeCardIndex >= currentCasts.length) {
      setActiveCardIndex(0);
    }
  }, [castsVersion, activeCardIndex]);

  // Navigate to previous card - memoized to prevent recreating CastCardsView
  const scrollToPrevious = useCallback(() => {
    setActiveCardIndex(prev => {
      if (prev > 0) {
        setSelectedCastIndex(null);
        setStakeAmount('');
        setLockupDuration('');
        setSelectedCastHash(null);
        setOtherUserCast(null);
        return prev - 1;
      }
      return prev;
    });
  }, []);

  const scrollToNext = useCallback(() => {
    setActiveCardIndex(prev => {
      const currentCasts = castsRef.current;
      if (prev < currentCasts.length - 1) {
        setSelectedCastIndex(null);
        setStakeAmount('');
        setLockupDuration('');
        setSelectedCastHash(null);
        setOtherUserCast(null);
        return prev + 1;
      }
      return prev;
    });
  }, []);

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
    // Create a unique key for this transaction based on params and store it for later lookup when hash is available
    const paramsKey = `${paramsToUse.amountWei.toString()}-${paramsToUse.unlockTime}`;
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
            selectedCastHash // Use selected cast hash as title
          ],
        });
      } catch (error: any) {
        const message = error?.message || 'Failed to create lockup';
        reportStakeError(message);
        reportTransactionFailure(message);
        setPendingCreateLockUp(false);
        hasScheduledCreateLockUp.current = false;
        // Clean up metadata on error
        pendingStakeMetadataRef.current.delete(paramsKey);
        pendingParamsKeyRef.current = null;
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

  // Move metadata from params key to hash key when transaction hash becomes available
  useEffect(() => {
    if (createLockUpHash) {
      let paramsKey: string | null = null;
      if (pendingParamsKeyRef.current) {
        paramsKey = pendingParamsKeyRef.current;
        pendingParamsKeyRef.current = null;
      } else if (createLockUpParams) {
        paramsKey = `${createLockUpParams.amountWei.toString()}-${createLockUpParams.unlockTime}`;
      }

      if (paramsKey) {
        const metadata = pendingStakeMetadataRef.current.get(paramsKey);
        if (metadata) {
          pendingStakeMetadataRef.current.set(createLockUpHash, metadata);
          pendingStakeMetadataRef.current.delete(paramsKey);
        }
      }
    }
  }, [createLockUpHash, createLockUpParams]);

  // Handle transaction success - now also send metadata for optimistic update
  useEffect(() => {
    if (isCreateLockUpSuccess && createLockUpHash) {
      // Check if we've already processed this transaction
      if (processedTxHash.current === createLockUpHash) {
        return;
      }
      
      // Mark this transaction as processed
      processedTxHash.current = createLockUpHash;
      
      const castHashForCallback = selectedCastHash || undefined;

      setPendingCreateLockUp(false);
      setCreateLockUpParams(null);
      setSelectedCastIndex(null);
      setStakeAmount('');
      setLockupDuration('');
      setSelectedCastHash(null);
      hasScheduledCreateLockUp.current = false;
      setStakeError(null);
      transactionErrorReportedRef.current = false;
      
      // Call parent callback with metadata for optimistic update
      const metadata = pendingStakeMetadataRef.current.get(createLockUpHash);
      if (metadata) {
        const tempLockupId = `temp-${createLockUpHash}`;
        onLockSuccess?.(createLockUpHash, castHashForCallback, metadata.amount, metadata.unlockTime, tempLockupId);
        pendingStakeMetadataRef.current.delete(createLockUpHash);
      } else {
        onLockSuccess?.(createLockUpHash, castHashForCallback);
      }
      onStakeSuccess?.();
    }
  }, [
    isCreateLockUpSuccess,
    createLockUpHash,
    onStakeSuccess,
    onLockSuccess,
    selectedCastHash,
  ]);

  // Error handling
  useEffect(() => {
    if (approveError || createLockUpError) {
      const message = (approveError || createLockUpError)?.message || 'Transaction failed';
      reportStakeError(message);

      // Only surface the transaction modal when the contract interaction has already started.
      if (pendingCreateLockUp || createLockUpParams) {
        if (!transactionErrorReportedRef.current) {
          reportTransactionFailure(message);
          transactionErrorReportedRef.current = true;
        }
      }

      setPendingCreateLockUp(false);
      hasScheduledCreateLockUp.current = false;
      setCreateLockUpParams(null);
      setSelectedCastHash(null);
    } else {
      transactionErrorReportedRef.current = false;
    }
  }, [
    approveError,
    createLockUpError,
    reportStakeError,
    reportTransactionFailure,
    pendingCreateLockUp,
    createLockUpParams,
    setSelectedCastHash,
  ]);

  // Define handlers before useMemo that depends on them
  const handleQuickCast = useCallback(async () => {
    try {
      const fullMessage = KEYPHRASE_TEXT + " " + customMessage;
      const result = await sdk.actions.composeCast({
        text: fullMessage,
        channelKey: "higher"
      });
      
      // If result contains cast hash, create temporary cast card
      if (result?.cast?.hash && result?.cast?.text) {
        
        // Normalize hash format (ensure 0x prefix)
        const castHash = normalizeHash(result.cast.hash);
        
        // Extract description from cast text using consolidated function
        const description = extractDescription(result.cast.text) || '';
        
        // Create temporary cast card
        const newCast: CastCard = {
          hash: castHash,
          text: result.cast.text,
          description: description,
          timestamp: new Date().toISOString(),
          castState: 'valid', // Not "higher" yet since not staked
          rank: null,
          totalHigherStaked: 0,
          totalCasterStaked: 0,
          totalSupporterStaked: 0,
          casterStakeLockupIds: [],
          casterStakeAmounts: [],
          casterStakeUnlockTimes: [],
          supporterStakeLockupIds: [],
          supporterStakeAmounts: [],
          supporterStakeFids: [],
          // Username not available from composeCast result
        };
        
        updateCasts(prevCasts => {
          const filtered = prevCasts.filter(c => c.hash !== newCast.hash);
          return [newCast, ...filtered];
        });
        setShowCreateCast(false);
        setCustomMessage('');
      }
    } catch (error) {
      // Silent fail - user can try again
    }
  }, [customMessage, userFid]);

  const handleBuyHigher = useCallback(async () => {
    try {
      const buyToken = "eip155:8453/erc20:0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe";
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = await sdk.actions.swapToken({
        buyToken,
      });
      
      if (!result.success && result.reason !== 'rejected_by_user') {
        alert('Swap failed. Please try again.');
      }
    } catch (error) {
      alert('Failed to open swap. Please try again.');
    }
  }, []);

  const handleValidateAndUseCastUrl = useCallback(async () => {
    setUrlValidationError(null);
    setValidatingUrl(true);
    
    try {
      let identifierToLookup = castUrl.trim();
      let isFullUrl = false;
      
      // Normalize and validate URL formats
      if (identifierToLookup.includes('farcaster.xyz')) {
        // Ensure it's a full URL
        if (!identifierToLookup.startsWith('http://') && !identifierToLookup.startsWith('https://')) {
          identifierToLookup = 'https://' + identifierToLookup;
        }
        isFullUrl = true;
      } else if (identifierToLookup.includes('warpcast.com')) {
        // Ensure it's a full URL
        if (!identifierToLookup.startsWith('http://') && !identifierToLookup.startsWith('https://')) {
          identifierToLookup = 'https://' + identifierToLookup;
        }
        isFullUrl = true;
      } else if (identifierToLookup.startsWith('http://') || identifierToLookup.startsWith('https://')) {
        // Generic URL - try as-is
        isFullUrl = true;
      } else {
        // Assume it's a hash - normalize format
        if (!identifierToLookup.startsWith('0x') && /^[a-fA-F0-9]+$/.test(identifierToLookup)) {
          identifierToLookup = '0x' + identifierToLookup;
        }
      }
      
      if (!identifierToLookup) {
        setUrlValidationError('Invalid cast URL format');
        setValidatingUrl(false);
        return;
      }
      
      // Validate the cast using API - pass URL directly for better handling
      const response = await fetch(`/api/validate-cast?hash=${encodeURIComponent(identifierToLookup)}&isUrl=${isFullUrl}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Network error' }));
        setUrlValidationError(errorData.error || 'Failed to validate cast');
        setValidatingUrl(false);
        return;
      }
      
      const data = await response.json();
      
      if (!data.valid) {
        setUrlValidationError(data.reason || 'Cast not found or invalid');
        setValidatingUrl(false);
        return;
      }

      setUrlValidationError(null);
      setCastUrl('');
      
      // Normalize hash format (ensure 0x prefix)
      const castHash = normalizeHash(data.hash);
      const isOtherUser = data.fid !== userFid;
      
      // Check if cast exists in HS DB to get full cast data including stakes
      try {
        const castCheckResponse = await fetch(`/api/cast/${encodeURIComponent(castHash)}${userFid ? `?userFid=${userFid}` : ''}`);
        if (castCheckResponse.ok) {
          const castData = await castCheckResponse.json();
          const hasActiveStakes = castData.state === 'higher';
          
          // If cast has active stakes, open SupporterModal (for any user)
          if (hasActiveStakes) {
            if (onOpenSupporterModal) {
              onOpenSupporterModal(castHash);
              setShowCreateCast(false);
              setValidatingUrl(false);
              setOtherUserCast(null);
              return;
            }
          }
          
          // If cast is from different user and has no active stakes, store for display
          if (isOtherUser && !hasActiveStakes) {
            setOtherUserCast({
              hash: castHash,
              state: castData.state || 'valid',
              hasActiveStakes: false,
              casterFid: castData.fid,
              casterUsername: castData.username,
              casterDisplayName: castData.displayName,
            });
            
            // Add to cast cards for display
            const newCast: CastCard = {
              hash: castHash,
              text: castData.castText || data.castText || '',
              description: castData.description || data.description || '',
              timestamp: castData.timestamp || data.timestamp || new Date().toISOString(),
              castState: castData.state || data.state || 'valid',
              rank: castData.rank || null,
              totalHigherStaked: parseFloat(castData.totalHigherStaked || '0'),
              totalCasterStaked: parseFloat(castData.totalCasterStaked || '0'),
              totalSupporterStaked: parseFloat(castData.totalSupporterStaked || '0'),
              casterStakeLockupIds: [],
              casterStakeAmounts: [],
              casterStakeUnlockTimes: [],
              supporterStakeLockupIds: [],
              supporterStakeAmounts: [],
              supporterStakeFids: [],
              username: castData.username || data.author?.username || data.username,
            };
            
            updateCasts(prevCasts => {
              const filtered = prevCasts.filter(c => c.hash !== newCast.hash);
              return [newCast, ...filtered];
            });
            setShowCreateCast(false);
            setValidatingUrl(false);
            return;
          }
        }
      } catch (error) {
        console.error('[OnboardingModal] Error checking cast in DB:', error);
      }
      
      // If cast is from same user, use existing flow
      if (!isOtherUser) {
        // Cast not in DB or check failed - create temporary cast card from validation response
        const newCast: CastCard = {
          hash: castHash,
          text: data.castText || '',
          description: data.description || '',
          timestamp: data.timestamp || new Date().toISOString(),
          castState: data.state || 'valid',
          rank: null,
          totalHigherStaked: 0,
          totalCasterStaked: 0,
          totalSupporterStaked: 0,
          casterStakeLockupIds: [],
          casterStakeAmounts: [],
          casterStakeUnlockTimes: [],
          supporterStakeLockupIds: [],
          supporterStakeAmounts: [],
          supporterStakeFids: [],
          username: data.author?.username || data.username,
        };
        
        updateCasts(prevCasts => {
          const filtered = prevCasts.filter(c => c.hash !== newCast.hash);
          return [newCast, ...filtered];
        });
        setShowCreateCast(false);
      } else {
        // Other user's cast not in DB - treat as valid but no stakes
        setOtherUserCast({
          hash: castHash,
          state: data.state || 'valid',
          hasActiveStakes: false,
          casterFid: data.fid,
          casterUsername: data.author?.username || data.username,
          casterDisplayName: data.author?.display_name,
        });
        
        const newCast: CastCard = {
          hash: castHash,
          text: data.castText || '',
          description: data.description || '',
          timestamp: data.timestamp || new Date().toISOString(),
          castState: data.state || 'valid',
          rank: null,
          totalHigherStaked: 0,
          totalCasterStaked: 0,
          totalSupporterStaked: 0,
          casterStakeLockupIds: [],
          casterStakeAmounts: [],
          casterStakeUnlockTimes: [],
          supporterStakeLockupIds: [],
          supporterStakeAmounts: [],
          supporterStakeFids: [],
          username: data.author?.username || data.username,
        };
        
        updateCasts(prevCasts => {
          const filtered = prevCasts.filter(c => c.hash !== newCast.hash);
          return [newCast, ...filtered];
        });
        setShowCreateCast(false);
      }
    } catch (error) {
      setUrlValidationError('Failed to validate cast URL. Please check the URL format and try again.');
    } finally {
      setValidatingUrl(false);
    }
  }, [castUrl, userFid, onOpenSupporterModal, normalizeHash, updateCasts]);

  // Handle "Ask to Stake" - opens cast composer with reply
  const handleAskToStake = useCallback(async (castHash: string) => {
    try {
      const message = "I want to support your cooking! Please add stake to your cast!";
      const result = await sdk.actions.composeCast({
        text: message,
        parent: { type: 'cast', hash: castHash },
      });
      
      if (result.cast) {
        console.log('[OnboardingModal] Reply cast created successfully');
        // Optionally close the modal or show success message
      } else {
        console.log('[OnboardingModal] User cancelled or cast composer closed');
      }
    } catch (error) {
      console.error('[OnboardingModal] Error opening cast composer:', error);
      alert('Failed to open cast composer. Please try again.');
    }
  }, []);


  const handleStake = async (castHash: string, inputStakeAmount: string, inputLockupDuration: string, inputLockupUnit: 'minute' | 'day' | 'week' | 'month' | 'year') => {
    if (!wagmiAddress) {
      reportStakeError('No wallet connected');
      return;
    }

    // Normalize hash format for comparison
    const normalizedCastHash = normalizeHash(castHash);

    // Check if cast exists in local state (for reference, but we'll still validate via Neynar)
    const localCast = castsRef.current.find(c => normalizeHash(c.hash) === normalizedCastHash);
    
    // Always validate via Neynar to ensure cast exists, belongs to user, and is valid
    try {
      const validateResponse = await fetch(`/api/validate-cast?hash=${encodeURIComponent(normalizedCastHash)}&isUrl=false`);
      
      if (!validateResponse.ok) {
        reportStakeError('Failed to validate cast. Please try again.');
        return;
      }

      const validateData = await validateResponse.json();
      
      if (!validateData.valid) {
        reportStakeError('Higher cast not found. Please create a valid cast first.');
        return;
      }

      // Validate ownership - only the caster can stake on their own cast
      if (validateData.fid !== userFid) {
        reportStakeError('Only the caster can stake on their own cast');
        return;
      }

      // Check cast state - must be 'valid' or 'higher' (expired casts can be re-staked)
      // Note: Neynar-validated casts will have state 'valid' since they're not in DB yet
      if (validateData.state && validateData.state !== 'valid' && validateData.state !== 'higher' && validateData.state !== 'expired') {
        reportStakeError('Cast is not valid for staking');
        return;
      }

      // If we have local cast state, sync it with the validated state from Neynar/DB
      // This ensures local state stays in sync with the source of truth
      if (localCast && localCast.castState !== validateData.state) {
        updateCasts(prevCasts =>
          prevCasts.map(c =>
            normalizeHash(c.hash) === normalizedCastHash
              ? { ...c, castState: validateData.state as 'valid' | 'higher' | 'expired' }
              : c
          )
        );
      }
    } catch (error) {
      reportStakeError('Failed to validate cast ownership. Please try again.');
      return;
    }

    // Validation
    const amountStr = (inputStakeAmount ?? '').toString();
    const durationStr = (inputLockupDuration ?? '').toString();
    const amountNum = parseFloat(amountStr.replace(/,/g, ''));
    const durationNum = parseFloat(durationStr);
    
    if (isNaN(amountNum) || amountNum <= 0) {
      reportStakeError('Please enter a valid stake amount');
      transactionErrorReportedRef.current = false;
      return;
    }
    
    if (isNaN(durationNum) || durationNum <= 0) {
      reportStakeError('Please enter a valid duration');
      transactionErrorReportedRef.current = false;
      return;
    }

    // Check balance
    if (amountNum > connectedWalletBalance) {
      reportStakeError('Amount exceeds wallet balance');
      transactionErrorReportedRef.current = false;
      return;
    }


    setStakeError(null);
    transactionErrorReportedRef.current = false;

    try {
      // Convert amount to wei (18 decimals)
      const amountWei = parseUnits(amountStr.replace(/,/g, ''), 18);
      
      // Calculate unlock time (current time + duration in seconds)
      const durationSeconds = durationToSeconds(durationNum, inputLockupUnit);
      const unlockTime = Math.floor(Date.now() / 1000) + durationSeconds;
      
      // Validate unlockTime fits in uint40
      if (unlockTime > 0xFFFFFFFF) {
        reportStakeError('Duration too long (exceeds maximum)');
        return;
      }

      // Store params for createLockUp (will be called after approve succeeds or if already approved)
      setCreateLockUpParams({ amountWei, unlockTime });
      setSelectedCastHash(normalizedCastHash);
      // Store metadata for optimistic update keyed by params (moved to hash when available)
      const paramsKey = `${amountWei.toString()}-${unlockTime}`;
      pendingStakeMetadataRef.current.set(paramsKey, {
        amount: amountStr.replace(/,/g, ''),
        unlockTime,
      });

      // Step 1: Check if we need to approve (only approve if current allowance is insufficient)
      const allowance = currentAllowance || BigInt(0);
      
      if (allowance >= amountWei) {
        // Sufficient allowance - simulate approve success to trigger createLockUp
        hasScheduledCreateLockUp.current = true;
        setPendingCreateLockUp(true);
        transactionErrorReportedRef.current = false;
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
                normalizedCastHash // Use normalized cast hash as title
              ],
            });
          } catch (error: any) {
            const message = error?.message || 'Failed to create lockup';
            reportStakeError(message);
            reportTransactionFailure(message);
            setPendingCreateLockUp(false);
            hasScheduledCreateLockUp.current = false;
          }
        }, 100);
        
        createLockUpTimeoutRef.current = delay;
        setCreateLockUpParams(null);
      } else {
        // Step 1: Approve the lockup contract to spend tokens
        transactionErrorReportedRef.current = false;
        writeContractApprove({
          address: HIGHER_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [LOCKUP_CONTRACT, amountWei],
        });
      }
    } catch (error: any) {
      const message = error?.message || 'Failed to initiate stake';
      reportStakeError(message);
      if (!transactionErrorReportedRef.current) {
        reportTransactionFailure(message);
        transactionErrorReportedRef.current = true;
      }
    }
  };

  const isLoadingTransaction = isApprovePending || isApproveConfirming || isCreateLockUpPending || isCreateLockUpConfirming || pendingCreateLockUp;

  // Create Cast Flow Component - memoized to prevent re-renders that cause focus loss
  const CreateCastFlow = useMemo(() => {
    return (
      <>
        <h2 className="text-xl font-bold mb-4 text-black border-b-2 border-black pb-2">
          Come cook with Higher!
        </h2>
        
        <div className="text-xs text-black/60 font-mono mb-2">
          <p>Ready to start working on your dream?</p>
          <p>Tell us what you're cooking up:</p>
        </div>
        
        <div className="bg-[#f9f7f1] p-4 border border-black/20 mb-4">
          <div className="text-xs text-black font-mono mb-2">
            <strong>{KEYPHRASE_TEXT}</strong>
          </div>
          <textarea
            key="custom-message-textarea"
            value={customMessage}
            onChange={(e) => {
              setCustomMessage(e.target.value);
            }}
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

        <div className="text-xs text-black/60 font-mono mb-2">
          Find a /higher cast to support. Valid casts begin with "{KEYPHRASE_TEXT}".
        </div>

        <div className="mb-4">
          <input
            ref={castUrlInputRef}
            key="cast-url-input"
            type="text"
            value={castUrl}
            onChange={(e) => {
              setCastUrl(e.target.value);
              setUrlValidationError(null);
            }}
            placeholder="Paste your cast URL here..."
            className="w-full text-xs font-mono bg-white border border-black/20 p-2 text-black placeholder-black/40 focus:outline-none focus:border-black"
            autoFocus={showCreateCast}
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
  }, [customMessage, castUrl, urlValidationError, validatingUrl, showCreateCast, handleQuickCast, handleValidateAndUseCastUrl]);

  // Commit handlers: only update parent state when committing
  const commitStakeAmount = useCallback((value: string) => {
    setStakeAmount(value);
    setStakeError(null);
    transactionErrorReportedRef.current = false;
  }, []);

  const commitLockupDuration = useCallback((value: string) => {
    setLockupDuration(value);
    setStakeError(null);
    transactionErrorReportedRef.current = false;
  }, []);

  const handleSetAmount = useCallback((percentage: number) => {
    const amount = percentage === 1 ? connectedWalletBalance : connectedWalletBalance * percentage;
    setStakeAmount(amount.toFixed(2));
    setStakeError(null);
    transactionErrorReportedRef.current = false;
    // Use setTimeout to ensure state update completes before focusing
    setTimeout(() => {
      stakeAmountInputRef.current?.focus();
    }, 0);
  }, [connectedWalletBalance]);

  const handleCancelStake = useCallback(() => {
    setSelectedCastIndex(null);
    setStakeAmount('');
    setLockupDuration('');
    setSelectedCastHash(null);
    setStakeError(null);
    transactionErrorReportedRef.current = false;
    // Clear other user cast state when canceling
    setOtherUserCast(null);
  }, []);

  const handleOpenStakeForm = useCallback((index: number, hash: string) => {
    setSelectedCastIndex(index);
    setSelectedCastHash(normalizeHash(hash));
    setStakeError(null);
    transactionErrorReportedRef.current = false;
    // Clear other user cast state when opening stake form (user is staking on their own cast)
    setOtherUserCast(null);
  }, [normalizeHash]);


  // Separate StakingForm component - memoized to prevent remounting
  const StakingForm = React.memo(({
    stakeAmount,
    lockupDuration,
    initialLockupUnit,
    isLoadingTransaction,
    connectedWalletBalance,
    castHash,
    stakeAmountInputRef,
    lockupDurationInputRef,
    onCommitStakeAmount,
    onCommitLockupDuration,
    onSetAmount,
    onStake,
    onCancel,
    errorMessage
  }: {
    stakeAmount: string;
    lockupDuration: string;
    initialLockupUnit: 'minute' | 'day' | 'week' | 'month' | 'year';
    isLoadingTransaction: boolean;
    connectedWalletBalance: number;
    castHash: string;
    stakeAmountInputRef: React.RefObject<HTMLInputElement>;
    lockupDurationInputRef: React.RefObject<HTMLInputElement>;
    onCommitStakeAmount: (value: string) => void;
    onCommitLockupDuration: (value: string) => void;
    onSetAmount: (percentage: number) => void;
    onStake: (hash: string, amount: string, duration: string, unit: 'minute' | 'day' | 'week' | 'month' | 'year') => void;
    onCancel: () => void;
    errorMessage: string | null;
  }) => {
    const [localStakeAmount, setLocalStakeAmount] = React.useState(stakeAmount);
    const [localLockupDuration, setLocalLockupDuration] = React.useState(lockupDuration);
    const [localLockupUnit, setLocalLockupUnit] = React.useState<'minute' | 'day' | 'week' | 'month' | 'year'>(initialLockupUnit);

    // Sync local inputs when parent resets due to active cast change or success/cancel
    useEffect(() => { setLocalStakeAmount(stakeAmount); }, [stakeAmount]);
    useEffect(() => { setLocalLockupDuration(lockupDuration); }, [lockupDuration]);

    const commitIfChanged = (prev: string, next: string, commit: (v: string) => void) => {
      if (prev !== next) commit(next);
    };

    return (
      <div className="mb-4">
        <div className="mb-3">
          <label className="text-xs text-black/70 mb-1 block">Amount (HIGHER)</label>
          <div className="flex gap-2">
            <input
              ref={stakeAmountInputRef}
              type="text"
              value={localStakeAmount}
              onChange={(e) => setLocalStakeAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 text-sm font-mono bg-white border border-black/20 p-2 text-black focus:outline-none focus:border-black"
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onSetAmount(0.25)}
                className="px-2 py-1 text-xs font-mono bg-white border border-black/20 hover:border-black text-black transition"
              >
                25%
              </button>
              <button
                type="button"
                onClick={() => onSetAmount(0.5)}
                className="px-2 py-1 text-xs font-mono bg-white border border-black/20 hover:border-black text-black transition"
              >
                50%
              </button>
              <button
                type="button"
                onClick={() => onSetAmount(1)}
                className="px-2 py-1 text-xs font-mono bg-white border border-black/20 hover:border-black text-black transition"
              >
                Max
              </button>
            </div>
          </div>
          <div className="text-xs text-black/50 mt-1">
            Available: {connectedWalletBalance.toFixed(2)} HIGHER
          </div>
        </div>

        <div className="mb-3">
          <label className="text-xs text-black/70 mb-1 block">Duration</label>
          <div className="flex gap-2">
            <input
              ref={lockupDurationInputRef}
              type="number"
              value={localLockupDuration}
              onChange={(e) => setLocalLockupDuration(e.target.value)}
              placeholder="1"
              min="1"
              className="flex-1 text-sm font-mono bg-white border border-black/20 p-2 text-black focus:outline-none focus:border-black"
            />
            <select
              value={localLockupUnit}
              onChange={(e) => setLocalLockupUnit(e.target.value as 'minute' | 'day' | 'week' | 'month' | 'year')}
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

        {/* {errorMessage && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs">
            {errorMessage}
          </div>
        )} */}

        <div className="text-xs text-black/60 mb-1 font-mono italic">
          <span className="not-italic">ⓘ</span> Uses <a href="https://mint.club/lockup/create" target="_blank" rel="noopener noreferrer" className="underline">mint.club lockups</a> for staking
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              // Ensure latest values are committed and used
              commitIfChanged(stakeAmount, localStakeAmount, onCommitStakeAmount);
              commitIfChanged(lockupDuration, localLockupDuration, onCommitLockupDuration);
              onStake(castHash, localStakeAmount, localLockupDuration, localLockupUnit);
            }}
            disabled={isLoadingTransaction}
            className="relative group flex-1 px-4 py-2.5 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingTransaction ? 'Staking...' : (
              <span className="flex items-center justify-center gap-1">
                Stake
              </span>
            )}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2.5 bg-white text-black border-2 border-black/20 hover:border-black transition text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }, (prevProps, nextProps) =>
    prevProps.stakeAmount === nextProps.stakeAmount &&
    prevProps.lockupDuration === nextProps.lockupDuration &&
    prevProps.isLoadingTransaction === nextProps.isLoadingTransaction &&
    prevProps.connectedWalletBalance === nextProps.connectedWalletBalance &&
    prevProps.castHash === nextProps.castHash &&
    prevProps.errorMessage === nextProps.errorMessage
  );

  // Cast Cards View Component - memoized to prevent recreation on every render
  const CastCardsView = useMemo(() => {
    const currentCast = castsRef.current[activeCardIndex];
    
    if (!currentCast) {
      return null;
    }
    
    // Check if this is an other user's cast with no active stakes
    const isOtherUserCast = otherUserCast && normalizeHash(otherUserCast.hash) === normalizeHash(currentCast.hash);
    const isOtherUserNoStakes = isOtherUserCast && !otherUserCast.hasActiveStakes;
    
    return (
      <>
        <h2 className="text-xl font-bold mb-4 text-black border-b-2 border-black pb-2">
          {isOtherUserCast && otherUserCast.casterUsername
            ? `Cook with ${otherUserCast.casterUsername}!`
            : "Now you're cooking 🔥"}
        </h2>

        <div className="text-xs text-black/60 font-mono mb-2">
          {isOtherUserCast && otherUserCast.casterUsername
            ? "Higher signals belief. Believe in something!"
            : "Higher signals belief. Believe in yourself!"}
        </div>
        
        {/* Single card display with navigation arrows */}
        <div className="mb-4 relative" style={{ overflow: 'visible' }}>
          {/* Left arrow button - positioned outside container, overlapping halfway */}
          {castsRef.current.length > 1 && activeCardIndex > 0 && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                scrollToPrevious();
              }}
              className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 bg-black/80 hover:bg-black text-white p-2 rounded-full transition shadow-lg"
              aria-label="Previous card"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
          )}
          
          {/* Single card */}
          <div className="bg-[#f9f7f1] p-4 border border-black/20 rounded-none relative z-10">
            <div className="text-xs text-black font-mono mb-2">
              <strong>{KEYPHRASE_TEXT}</strong>{' '}
              <a
                href={(isOtherUserCast && otherUserCast.casterUsername) 
                  ? `https://farcaster.xyz/${otherUserCast.casterUsername}/${currentCast.hash}`
                  : userUsername 
                  ? `https://farcaster.xyz/${userUsername}/${currentCast.hash}`
                  : `https://warpcast.com/~/conversations/${currentCast.hash}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-purple-700 hover:underline transition-colors"
              >
                {currentCast.description}
              </a>
            </div>
            {currentCast.timestamp && (
              <div className="text-xs text-black/50 font-mono mb-3">
                {formatTimestamp(currentCast.timestamp)}
              </div>
            )}
            
            <div className="border-t border-black/20 pt-3 mt-3">
              {currentCast.castState === 'higher' ? (
                <>
                  <div className="text-sm text-black font-bold mb-1">
                    Rank: {currentCast.rank ? `#${currentCast.rank}` : 'Unranked'}
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
                    <span>{currentCast.totalCasterStaked.toFixed(2)} staked</span>
                    <span className="text-black/40">+</span>
                    <span>{currentCast.totalSupporterStaked.toFixed(2)} supporting</span>
                  </div>
                </>
              ) : currentCast.castState === 'expired' ? (
                <div className="text-xs text-black/60 italic mb-2">
                  {isOtherUserNoStakes 
                    ? 'This cast has expired. The caster needs to add stake to cook!'
                    : 'This cast is expired, add stake to start cooking again!'}
                </div>
              ) : (
                <div className="text-xs text-black/60 mb-2">
                  {isOtherUserNoStakes
                    ? `${otherUserCast.casterUsername} needs to add stake to start cooking!`
                    : 'Add stake to start cooking!'}
                </div>
              )}
            </div>
          </div>
          
          {/* Right arrow button - positioned outside container, overlapping halfway */}
          {castsRef.current.length > 1 && activeCardIndex < castsRef.current.length - 1 && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                scrollToNext();
              }}
              className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 z-20 bg-black/80 hover:bg-black text-white p-2 rounded-full transition shadow-lg"
              aria-label="Next card"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          )}
        </div>
        
        {/* Add stake button - shown when staking form is not open */}
        {selectedCastIndex !== activeCardIndex && (
          <div className="mb-4 flex gap-3">
            {isOtherUserNoStakes ? (
              <button
                onClick={() => handleAskToStake(currentCast.hash)}
                className="flex-1 px-4 py-2 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition"
              >
                Ask to Stake
              </button>
            ) : (
              <button
                onClick={() => handleOpenStakeForm(activeCardIndex, currentCast.hash)}
                className="flex-1 px-4 py-2 bg-black text-white text-xs font-bold border-2 border-black hover:bg-white hover:text-black transition"
              >
                Add stake
              </button>
            )}
            <button
              onClick={handleBuyHigher}
              className="flex-1 px-4 py-2 bg-purple-600 text-white text-xs font-bold border-2 border-purple-600 hover:bg-purple-700 transition"
            >
              Buy HIGHER
            </button>
          </div>
        )}
        
      </>
    );
  }, [
    castsVersion,
    activeCardIndex,
    selectedCastIndex,
    handleOpenStakeForm,
    handleBuyHigher,
    handleAskToStake,
    scrollToPrevious,
    scrollToNext,
    showCreateCast,
    otherUserCast,
    userUsername,
    normalizeHash
  ]);

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
        
        <div className="overflow-y-auto flex-1 min-h-0 px-4 -mx-4">
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
        ) : showCreateCast || castsRef.current.length === 0 ? (
          CreateCastFlow
        ) : (
          <>
            {CastCardsView}
            {/* Staking Form - rendered outside CastCardsView to prevent re-renders when form state changes */}
            {selectedCastIndex === activeCardIndex && castsRef.current[activeCardIndex] && (
              <StakingForm
                key={`staking-form-${castsRef.current[activeCardIndex].hash}-${selectedCastIndex}`}
                stakeAmount={stakeAmount}
                lockupDuration={lockupDuration}
                initialLockupUnit="day"
                isLoadingTransaction={isLoadingTransaction}
                connectedWalletBalance={connectedWalletBalance}
                castHash={castsRef.current[activeCardIndex].hash}
                stakeAmountInputRef={stakeAmountInputRef}
                lockupDurationInputRef={lockupDurationInputRef}
                onCommitStakeAmount={commitStakeAmount}
                onCommitLockupDuration={commitLockupDuration}
                onSetAmount={handleSetAmount}
                onStake={handleStake}
                onCancel={handleCancelStake}
                errorMessage={stakeError}
              />
            )}
            {/* Card indicator (e.g., "1 of 3") - rendered outside CastCardsView */}
            {castsRef.current.length > 1 && (
              <div className="flex justify-center mt-2 text-xs text-black/60 mb-4">
                {activeCardIndex + 1} of {castsRef.current.length}
              </div>
            )}
            {/* Create new cast link - rendered outside CastCardsView */}
            <div className="mt-3 text-center">
              <button
                onClick={() => setShowCreateCast(true)}
                className="text-xs text-black/60 hover:text-black underline"
              >
                Or.. Create new cast
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
