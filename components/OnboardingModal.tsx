'use client';

import { useEffect, useState, useRef } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { parseUnits } from 'viem';
import { sdk } from '@farcaster/miniapp-sdk';
import { LOCKUP_CONTRACT, HIGHER_TOKEN_ADDRESS, LOCKUP_ABI, ERC20_ABI } from '@/lib/contracts';

interface OnboardingModalProps {
  onClose: () => void;
  userFid: number;
  castData: {
    hasCast: boolean;
    hash?: string;
    text?: string;
    description?: string;
    timestamp?: string;
    totalStaked: number;
    rank: number | null;
  } | null;
  walletBalance?: number;
  onCastUpdated?: () => void;
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

export function OnboardingModal({ onClose, userFid, castData, walletBalance = 0, onCastUpdated }: OnboardingModalProps) {
  const [customMessage, setCustomMessage] = useState('');
  const [castUrl, setCastUrl] = useState('');
  const [showStakingForm, setShowStakingForm] = useState(false);
  const [urlValidationError, setUrlValidationError] = useState<string | null>(null);
  const [validatingUrl, setValidatingUrl] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('');
  const [lockupDuration, setLockupDuration] = useState<string>('');
  const [lockupDurationUnit, setLockupDurationUnit] = useState<'day' | 'week' | 'month' | 'year'>('day');
  
  // Staking transaction state
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [pendingCreateLockUp, setPendingCreateLockUp] = useState(false);
  const [createLockUpParams, setCreateLockUpParams] = useState<{
    amountWei: bigint;
    unlockTime: number;
  } | null>(null);
  
  // Wagmi hooks
  const { address: wagmiAddress } = useAccount();
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
  const createLockUpTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    if (!isApproveSuccess || !approveReceipt || !createLockUpParams || !wagmiAddress || !castData?.hash || hasScheduledCreateLockUp.current) {
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
            castData.hash || 'Higher Steaks!' // Use cast hash as title
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
  }, [isApproveSuccess, approveReceipt, wagmiAddress, castData, writeContractCreateLockUp]);

  // Handle transaction success
  useEffect(() => {
    if (isCreateLockUpSuccess) {
      setPendingCreateLockUp(false);
      setCreateLockUpParams(null);
      setShowStakingForm(false);
      setStakeAmount('');
      setLockupDuration('');
      setLockupDurationUnit('day');
      hasScheduledCreateLockUp.current = false;
      
      // Refresh the page to update balance and cast data
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    }
  }, [isCreateLockUpSuccess]);

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
      
      // If result contains cast hash, we can use it immediately
      if (result?.cast?.hash) {
        console.log('Got cast hash from composeCast:', result.cast.hash);
        // Refresh cast data to pick up the new cast
        if (onCastUpdated) {
          onCastUpdated();
        }
      }
      
      // Close modal - user will see updated state when they reopen
      onClose();
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
        // Extract hash from farcaster.xyz URLs: https://farcaster.xyz/username/0x...
        const match = identifierToLookup.match(/farcaster\.xyz\/[^/]+\/(0x[a-fA-F0-9]+)$/);
        if (match && match[1]) {
          identifierToLookup = match[1];
          console.log('[Onboarding] Extracted hash from farcaster.xyz URL:', identifierToLookup);
        } else {
          setUrlValidationError('Invalid cast URL format (could not extract hash)');
          setValidatingUrl(false);
          return;
        }
      } else if (identifierToLookup.includes('warpcast.com')) {
        // For Warpcast URLs, extract the hash part
        const match = identifierToLookup.match(/warpcast\.com\/[^/]+\/([a-zA-Z0-9]+)$/);
        if (match && match[1]) {
          // Prepend 0x if it's a hex string
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
        // Assume it's already a hash - add 0x prefix if missing
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
        // Valid cast by this user - refresh cast data
        console.log('[Onboarding] Cast is valid, refreshing data');
        setUrlValidationError(null);
        setCastUrl('');
        if (onCastUpdated) {
          onCastUpdated();
        }
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

  const handleStake = async () => {
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
      console.error('Stake error:', error);
    }
  };

  const isLoadingTransaction = isApprovePending || isApproveConfirming || isCreateLockUpPending || isCreateLockUpConfirming || pendingCreateLockUp;

  // State A: No Cast Found
  if (!castData || !castData.hasCast) {
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
          
          <h2 className="text-xl font-bold mb-4 text-black border-b-2 border-black pb-2">
            How are you aiming higher?
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
                className="flex-1 px-4 py-2.5 bg-purple-600 text-white font-bold border-2 border-purple-600 hover:bg-purple-700 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {validatingUrl ? 'Validating...' : 'Use URL'}
              </button>
            )}
          </div>
          
          <div className="mt-3">
            <button
              onClick={onClose}
              className="text-xs text-black/60 hover:text-black underline"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State B: Cast Found
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
        
        <h2 className="text-xl font-bold mb-4 text-black border-b-2 border-black pb-2">
          You are aiming higher!
        </h2>
        
        <div className="bg-[#f9f7f1] p-4 border border-black/20 mb-4">
          <div className="text-xs text-black font-mono mb-2">
            <strong>started aiming higher and it worked out!</strong> {castData.description}
          </div>
          {castData.timestamp && (
            <div className="text-xs text-black/50 font-mono">
              {formatTimestamp(castData.timestamp)}
            </div>
          )}
        </div>

        <div className="mb-4 text-sm">
          <div className="text-black font-bold">
            Rank: {castData.rank ? `#${castData.rank}` : 'Unranked'}
          </div>
          <div className="text-black/80">
            {castData.totalStaked.toFixed(2)} HIGHER staked on this cast
          </div>
        </div>

        {!showStakingForm ? (
          <div className="flex gap-3 border-t border-black/20 pt-4">
            <button
              onClick={() => setShowStakingForm(true)}
              className="flex-1 px-4 py-2.5 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm"
            >
              Add stake
            </button>
            <button
              onClick={handleSwapToHigher}
              className="flex-1 px-4 py-2.5 bg-purple-600 text-white font-bold border-2 border-purple-600 hover:bg-purple-700 transition text-sm"
            >
              Buy HIGHER
            </button>
          </div>
        ) : (
          <div className="border-t border-black/20 pt-4">
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
                  onChange={(e) => setLockupDurationUnit(e.target.value as 'day' | 'week' | 'month' | 'year')}
                  className="text-sm font-mono bg-white border border-black/20 p-2 text-black focus:outline-none focus:border-black"
                >
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
                onClick={handleStake}
                disabled={isLoadingTransaction}
                className="flex-1 px-4 py-2.5 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingTransaction ? 'Staking...' : 'Stake'}
              </button>
              <button
                onClick={() => {
                  setShowStakingForm(false);
                  setStakeError(null);
                  setStakeAmount('');
                  setLockupDuration('');
                  setLockupDurationUnit('day');
                }}
                className="px-4 py-2.5 bg-white text-black border-2 border-black/20 hover:border-black transition text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
