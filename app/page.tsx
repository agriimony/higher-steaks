'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import { OnboardingModal } from '@/components/OnboardingModal';
import { StakingModal } from '@/components/StakingModal';
import { ProfileSwitcher, SimulatedProfile, SIMULATED_PROFILES } from '@/components/ProfileSwitcher';
import { BlockLivenessIndicator } from '@/components/BlockLivenessIndicator';
import { useEventSubscriptions } from '@/hooks/useEventSubscriptions';
import { useAccount } from 'wagmi';

interface User {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  walletAddress: string | null;
  bio?: string;
}

interface TokenBalance {
  totalBalanceFormatted: string;
  lockedBalanceFormatted: string;
  usdValue: string;
  pricePerToken: number;
  higherLogoUrl?: string;
  lockups?: LockupDetail[];
  wallets?: WalletDetail[];
}

interface StakingBalance {
  totalStakedFormatted: string;
}

interface LeaderboardEntry {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  castHash: string;
  castText: string;
  description: string;
  higherBalance: string;
  usdValue: string;
  rank: number;
}

interface LockupDetail {
  lockupId: string;
  amount: string;
  amountFormatted: string;
  unlockTime: number;
  timeRemaining: number;
  receiver: string;
  title: string;
}

interface WalletDetail {
  address: string;
  balance: string;
  balanceFormatted: string;
}

export default function HigherSteakMenu() {
  // Development mode: Enable to test with simulated profiles
  const [isDevelopmentMode, setIsDevelopmentMode] = useState(false);
  const [simulatedProfile, setSimulatedProfile] = useState<SimulatedProfile | null>(null);
  
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [stakingBalance, setStakingBalance] = useState<StakingBalance | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [castData, setCastData] = useState<{
    hasCast: boolean;
    hash?: string;
    text?: string;
    description?: string;
    timestamp?: string;
    totalStaked: number;
    rank: number | null;
  } | null>(null);
  const [showStakingModal, setShowStakingModal] = useState(false);
  const [stakingDetails, setStakingDetails] = useState<{
    lockups: LockupDetail[];
    wallets: WalletDetail[];
  } | null>(null);
  const [loadingStakingDetails, setLoadingStakingDetails] = useState(false);
  
  // Detect pixel density for ASCII art scaling
  const [pixelDensity, setPixelDensity] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  
  // Global countdown timer state - persists across modal opens/closes
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  
  // Event subscriptions for real-time updates (via SSE/CDP webhooks)
  const { address: wagmiAddress } = useAccount();
  const wsEnabled = user !== null && !isDevelopmentMode;
  const ws = useEventSubscriptions(wsEnabled);
  const lastEventRef = useRef<string | null>(null);
  
  // Global countdown timer - runs continuously
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Extract staking details and calculate staked balance from balance data (single source of truth)
  const updateStakingDetailsFromBalance = (balanceData: TokenBalance) => {
    if (balanceData.lockups && balanceData.wallets) {
      console.log('[Staking Details Update] Updating with lockups:', {
        lockupCount: balanceData.lockups.length,
        lockupIds: balanceData.lockups.map(l => l.lockupId),
        walletCount: balanceData.wallets.length
      });
      
      setStakingDetails({
        lockups: balanceData.lockups,
        wallets: balanceData.wallets,
      });
      setLoadingStakingDetails(false);
      
      // Calculate total staked balance from lockups (sum of all locked amounts)
      // Use the raw amount string (in wei) for precision
      const totalStaked = balanceData.lockups.reduce((sum, lockup) => {
        const amountWei = BigInt(lockup.amount || '0');
        const divisor = BigInt(10 ** 18);
        const wholePart = Number(amountWei / divisor);
        const fractionalPart = Number(amountWei % divisor) / Number(divisor);
        return sum + wholePart + fractionalPart;
      }, 0);
      
      setStakingBalance({
        totalStakedFormatted: totalStaked.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      });
    }
  };
  
  // Handle stake success: adjust timers, reset elapsed seconds, and refresh balance
  const handleStakeSuccess = useCallback(() => {
    console.log('[Stake Success] Adjusting timers, elapsed:', elapsedSeconds);
    
    // Subtract elapsed time from all existing lockups
    if (stakingDetails?.lockups) {
      const updatedLockups = stakingDetails.lockups.map(lockup => ({
        ...lockup,
        timeRemaining: Math.max(0, lockup.timeRemaining - elapsedSeconds),
      }));
      
      setStakingDetails({
        lockups: updatedLockups,
        wallets: stakingDetails.wallets,
      });
    }
    
    // Reset the elapsed counter
    setElapsedSeconds(0);
    
    // Refresh balance and staking details from API to get the new lockup
    if (user?.fid) {
      console.log('[Stake Success] Refreshing balance and staking details');
      fetchTokenBalance(user.fid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSeconds, stakingDetails, user?.fid]);

  const fetchTokenBalance = async (fid: number) => {
    console.log('[fetchTokenBalance] Called for fid:', fid);
    setLoadingBalance(true);
    setLoadingStakingDetails(true);
    setBalanceError(null);
    try {
      const response = await fetch(`/api/user/balance?fid=${fid}`);
      if (response.ok) {
        const balanceData = await response.json();
        console.log('[fetchTokenBalance] Balance data received:', {
          hasLockups: !!balanceData.lockups,
          lockupCount: balanceData.lockups?.length,
          higherLogoUrl: balanceData.higherLogoUrl
        });
        setBalance(balanceData);
        // Extract staking details from the same response (single source of truth)
        updateStakingDetailsFromBalance(balanceData);
      } else {
        console.error('[fetchTokenBalance] Failed to fetch balance, status:', response.status);
        setBalanceError(null);
        setBalance(null);
        setStakingDetails({ lockups: [], wallets: [] });
        setLoadingStakingDetails(false);
      }
    } catch (error) {
      console.error('[fetchTokenBalance] Error:', error);
      setBalanceError(null);
      setBalance(null);
      setStakingDetails({ lockups: [], wallets: [] });
      setLoadingStakingDetails(false);
    } finally {
      setLoadingBalance(false);
    }
  };

  const fetchCastData = async (fid: number) => {
    try {
      const response = await fetch(`/api/user/casts?fid=${fid}`);
      if (response.ok) {
        const data = await response.json();
        console.log('Cast data:', data);
        setCastData(data);
      } else {
        console.error('Failed to fetch cast data');
        setCastData({ hasCast: false, totalStaked: 0, rank: null });
      }
    } catch (error) {
      console.error('Error fetching cast data:', error);
      setCastData({ hasCast: false, totalStaked: 0, rank: null });
    }
  };
  
  // Format large numbers with K/M/B suffixes
  const formatTokenAmount = (amount: string): string => {
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
  };
  
  // Fallback menu items (shown if leaderboard is empty)
  const fallbackMenuItems = [
    { name: "The Ribeye Supreme", price: "$48.00", description: "Perfectly aged and grilled to perfection" },
    { name: "Filet Mignon Deluxe", price: "$52.00", description: "Tender cut with signature seasoning" },
    { name: "New York Strip Classic", price: "$44.00", description: "Bold flavor, classic preparation" },
    { name: "Porterhouse for Two", price: "$89.00", description: "A sharing experience for true steak lovers" },
    { name: "Wagyu Sirloin Experience", price: "$76.00", description: "Premium marbling, unmatched richness" },
    { name: "Grilled Salmon Steak", price: "$38.00", description: "Fresh catch with lemon butter" },
    { name: "Bone-In Tomahawk", price: "$95.00", description: "Showstopper presentation, unforgettable taste" },
    { name: "Surf & Turf Combo", price: "$68.00", description: "Best of land and sea" },
    { name: "Prime Skirt Steak", price: "$36.00", description: "Flavorful and perfectly charred" },
    { name: "Vegetarian Portobello Stack", price: "$28.00", description: "Hearty mushrooms with seasonal vegetables" },
  ];

  // Detect pixel density and viewport width for responsive ASCII art
  useEffect(() => {
    const updateDisplayMetrics = () => {
      if (typeof window !== 'undefined') {
        setPixelDensity(window.devicePixelRatio || 1);
        setViewportWidth(window.innerWidth);
      }
    };

    updateDisplayMetrics();
    window.addEventListener('resize', updateDisplayMetrics);
    return () => window.removeEventListener('resize', updateDisplayMetrics);
  }, []);

  // Calculate dynamic scale based on pixel density and viewport width
  // Seems to work fine with just a 1x1 scale
  const getAsciiScale = () => {

    return { scaleX: 1/Math.sqrt(pixelDensity), scaleY: 1 };

  };

  const asciiScale = getAsciiScale();

  useEffect(() => {
    // IMPORTANT: Call ready() FIRST to hide splash screen immediately
    const hideSplash = async () => {
      try {
        await sdk.actions.ready();
        console.log('✅ Splash screen hidden');
      } catch (error) {
        console.log('Not in Farcaster client - ready() failed:', error);
      }
    };

    // Hide splash immediately
    hideSplash();

    // Then try to get user context (this can happen after splash is hidden)
    const fetchUserProfile = async () => {
      try {
        // Get context from Farcaster SDK
        const context = await sdk.context;
        
        if (!context?.user?.fid) {
          console.log('Not in Farcaster client or no user context');
          return;
        }

        const fid = context.user.fid;
        console.log('✅ User FID from context:', fid);

        // Fetch full profile from backend
        const response = await fetch(`/api/user/profile?fid=${fid}`);

        if (response.ok) {
          const profileData = await response.json();
          console.log('Profile data:', profileData);
          setUser(profileData);
          
          // Fetch token balance and cast data after getting user profile
          // Balance API now includes lockups and wallets (single source of truth)
          // Staking balance is calculated from lockups in the response
          fetchTokenBalance(fid);
          fetchCastData(fid);
        } else {
          console.error('Failed to fetch profile');
          // Fallback to just FID if profile fetch fails
          setUser({
            fid,
            username: `user-${fid}`,
            displayName: `User ${fid}`,
            pfpUrl: '',
            walletAddress: null,
          });
        }
      } catch (error) {
        console.log('Not in Farcaster client:', error);
      }
    };


    const fetchLeaderboard = async () => {
      setLoadingLeaderboard(true);
      try {
        const response = await fetch('/api/leaderboard/top');
        console.log('Leaderboard response status:', response.status, response.ok);
        
        if (response.ok) {
          const data = await response.json();
          console.log('Leaderboard data received:', data);
          console.log('Entries array:', data.entries);
          console.log('Entries length:', data.entries?.length);
          
          if (data.entries && data.entries.length > 0) {
            console.log('First entry:', data.entries[0]);
          }
          
          setLeaderboard(data.entries || []);
        } else {
          console.error('Failed to fetch leaderboard, status:', response.status);
          const errorText = await response.text();
          console.error('Error response:', errorText);
        }
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
      } finally {
        setLoadingLeaderboard(false);
      }
    };

    fetchUserProfile();
    fetchLeaderboard();
  }, []);

  // Handle simulated profile changes in development mode
  useEffect(() => {
    if (isDevelopmentMode && simulatedProfile) {
      // Set simulated user data
      setUser({
        fid: simulatedProfile.fid,
        username: simulatedProfile.username,
        displayName: simulatedProfile.displayName,
        pfpUrl: simulatedProfile.pfpUrl,
        walletAddress: null,
      });
      
      // Set simulated balance
      setBalance({
        totalBalanceFormatted: simulatedProfile.walletBalance,
        lockedBalanceFormatted: '0.00',
        usdValue: '$0.00',
        pricePerToken: 0,
      });
      
      // Set simulated staking balance
      setStakingBalance({
        totalStakedFormatted: simulatedProfile.stakedBalance,
      });
      
      setLoadingBalance(false);
      setLoadingLeaderboard(false);
    }
  }, [isDevelopmentMode, simulatedProfile]);

  // Handle balance pill click
  const handleBalancePillClick = () => {
    if (user?.fid && balance) {
      setShowStakingModal(true);
      // Staking details are already loaded on initial connection, no need to fetch again
    }
  };


  const handleCloseOnboardingModal = () => {
    setShowOnboardingModal(false);
  };

  const handleFabClick = () => {
    // Close any other open modals first
    setShowStakingModal(false);
    // Then open onboarding modal
    setShowOnboardingModal(true);
  };

  const getWalletBalance = (): number => {
    if (!balance?.wallets || balance.wallets.length === 0) return 0;
    return parseFloat(balance.wallets[0].balanceFormatted.replace(/,/g, ''));
  };

  // Filter leaderboard to show only one cast per creator (first/highest ranked)
  const getFilteredLeaderboard = () => {
    const seenFids = new Set<number>();
    return leaderboard.filter(entry => {
      if (seenFids.has(entry.fid)) {
        return false;
      }
      seenFids.add(entry.fid);
      return true;
    });
  };

  const filteredLeaderboard = getFilteredLeaderboard();

  // Handle lockup events (via CDP webhooks)
  useEffect(() => {
    if (ws.newLockupEvent && user?.fid && wagmiAddress) {
      // Generate event ID based on what data is available
      // For Transfer-based events: use from/to/value
      // For native LockUpCreated events: use lockUpId/receiver
      const eventId = ws.newLockupEvent.from && ws.newLockupEvent.to 
        ? `lockup-transfer-${ws.newLockupEvent.from}-${ws.newLockupEvent.to}-${ws.newLockupEvent.value}`
        : `${ws.newLockupEvent.lockUpId}-${ws.newLockupEvent.receiver}`;
      
      // Avoid processing duplicate events
      if (eventId === lastEventRef.current) {
        return;
      }
      lastEventRef.current = eventId;

      console.log('[Event] New lockup detected:', ws.newLockupEvent);

      // Check if this event is relevant to the current user
      // For Transfer-based: from should be user's wallet
      // For native LockUpCreated: receiver should be user's wallet
      const isRelevant = ws.newLockupEvent.from 
        ? ws.newLockupEvent.from.toLowerCase() === wagmiAddress.toLowerCase()
        : ws.newLockupEvent.receiver?.toLowerCase() === wagmiAddress.toLowerCase();
      
      console.log('[Event] Relevance check:', {
        isRelevant,
        eventFrom: ws.newLockupEvent.from,
        eventReceiver: ws.newLockupEvent.receiver,
        wagmiAddress,
        isFromBased: !!ws.newLockupEvent.from
      });
      
      if (isRelevant) {
        console.log('[Event] Lockup involves current user, refreshing balance and leaderboard');
        
        // Refresh balance
        fetchTokenBalance(user.fid);
        
        // Refresh leaderboard
        fetch('/api/leaderboard/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }).catch(err => {
          console.error('Failed to refresh leaderboard:', err);
        });
      } else {
        console.log('[Event] Lockup not relevant to current user');
      }
    }
  }, [ws.newLockupEvent, user?.fid, wagmiAddress]);

  // Handle unlock events (via CDP webhooks)
  useEffect(() => {
    console.log('[Unlock Event Handler] Effect triggered:', {
      hasUnlockEvent: !!ws.unlockEvent,
      unlockEvent: ws.unlockEvent,
      hasUser: !!user?.fid,
      hasWagmiAddress: !!wagmiAddress,
      wagmiAddress
    });
    
    if (ws.unlockEvent && user?.fid && wagmiAddress) {
      // Generate event ID based on what data is available
      // For Transfer-based events: use from/to/value
      // For native Unlock events: use lockUpId/receiver
      const eventId = ws.unlockEvent.from && ws.unlockEvent.to 
        ? `unlock-transfer-${ws.unlockEvent.from}-${ws.unlockEvent.to}-${ws.unlockEvent.value}`
        : `unlock-${ws.unlockEvent.lockUpId}-${ws.unlockEvent.receiver}`;
      
      console.log('[Unlock Event] Event received:', {
        eventId,
        currentLastEvent: lastEventRef.current,
        lockUpId: ws.unlockEvent.lockUpId,
        receiver: ws.unlockEvent.receiver,
        from: ws.unlockEvent.from,
        to: ws.unlockEvent.to,
        value: ws.unlockEvent.value,
        wagmiAddress
      });
      
      // Avoid processing duplicate events
      if (eventId === lastEventRef.current) {
        console.log('[Unlock Event] Duplicate event, skipping');
        return;
      }
      lastEventRef.current = eventId;

      console.log('[Event] Unlock detected:', ws.unlockEvent);

      // Check if this event is relevant to the current user
      // For Transfer-based: to should be user's wallet (funds moving FROM lockup TO user)
      // For native Unlock: receiver should be user's wallet
      const eventTo = ws.unlockEvent.to?.toLowerCase();
      const eventReceiver = ws.unlockEvent.receiver?.toLowerCase();
      const userAddress = wagmiAddress.toLowerCase();
      
      const isRelevant = eventTo 
        ? eventTo === userAddress
        : eventReceiver === userAddress;
      
      console.log('[Unlock Event] Relevance check:', {
        eventTo,
        eventReceiver,
        userAddress,
        isRelevant,
        eventType: eventTo ? 'Transfer-based' : 'Native Unlock'
      });
      
      if (isRelevant) {
        console.log('[Event] Unlock involves current user, refreshing balance');
        
        // Refresh balance (unlock doesn't affect leaderboard, only individual balance)
        fetchTokenBalance(user.fid);
      } else {
        console.log('[Unlock Event] Event not relevant to current user');
      }
    } else if (ws.unlockEvent) {
      console.log('[Unlock Event] Missing required data:', {
        hasUser: !!user?.fid,
        hasWagmiAddress: !!wagmiAddress,
        unlockEvent: ws.unlockEvent
      });
    }
  }, [ws.unlockEvent, user?.fid, wagmiAddress]);

  // Handle transfer events (via CDP webhooks)
  useEffect(() => {
    if (ws.transferEvent && user?.fid && wagmiAddress) {
      const eventId = `transfer-${ws.transferEvent.from}-${ws.transferEvent.to}`;
      
      // Avoid processing duplicate events
      if (eventId === lastEventRef.current) {
        return;
      }
      lastEventRef.current = eventId;

      console.log('[Event] Transfer detected:', ws.transferEvent);

      // Check if this transfer involves the current user's wallet
      const lowerWagmiAddr = wagmiAddress.toLowerCase();
      const isRelevant = 
        ws.transferEvent.from.toLowerCase() === lowerWagmiAddr ||
        ws.transferEvent.to.toLowerCase() === lowerWagmiAddr;

      if (isRelevant) {
        console.log('[Event] Transfer involves current user, refreshing balance');
        
        // Refresh wallet balance
        fetchTokenBalance(user.fid);
      }
    }
  }, [ws.transferEvent, user?.fid, wagmiAddress]);

  // Block freshness indicator removed - no longer needed with webhooks

  return (
    <>
      {/* Onboarding Modal */}
      {showOnboardingModal && user && castData !== null && (
        <OnboardingModal
          onClose={handleCloseOnboardingModal}
          userFid={user.fid}
          castData={castData}
          walletBalance={getWalletBalance()}
          onCastUpdated={(newCastData) => {
            // Update cast data when user creates/validates a cast
            setCastData(newCastData);
          }}
          onStakeSuccess={handleStakeSuccess}
        />
      )}

      {/* Staking Modal */}
      {showStakingModal && balance && (
        <StakingModal
          onClose={() => setShowStakingModal(false)}
          balance={balance}
          lockups={stakingDetails?.lockups || []}
          wallets={stakingDetails?.wallets || []}
          loading={loadingStakingDetails || !stakingDetails}
          elapsedSeconds={elapsedSeconds}
          onTransactionSuccess={async () => {
            // CDP webhook will automatically detect the transaction and refresh the balance
            // No manual refresh needed
          }}
          onRefresh={() => {
            if (user?.fid) {
              fetchTokenBalance(user.fid);
            }
          }}
        />
      )}

      <main className="min-h-screen bg-[#f9f7f1] text-black p-2 sm:p-4 md:p-6 font-mono">
        <div className="max-w-4xl mx-auto bg-[#fefdfb] shadow-lg p-3 sm:p-4 md:p-8 border border-[#e5e3db]">
        {/* Header Row - Balance left, Profile right */}
        <div className="flex justify-between items-center gap-2 mb-3 sm:mb-4">
          {/* Token Balance Pill - Left */}
          <div 
            className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-full px-3 py-1.5 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
            onClick={handleBalancePillClick}
          >
            {loadingBalance ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin h-3 w-3 border-2 border-purple-600 border-t-transparent rounded-full"></div>
                <span className="text-[0.65rem] sm:text-xs text-gray-600">Loading...</span>
              </div>
            ) : balance ? (
              <div className="flex items-center gap-1.5">
                <img 
                  src={balance.higherLogoUrl || '/higher-logo.png'} 
                  alt="HIGHER" 
                  className="w-4 h-4 sm:w-5 sm:h-5 rounded-full"
                  onError={(e) => {
                    console.error('Failed to load HIGHER logo:', e);
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <span className="text-[0.65rem] sm:text-xs font-bold text-purple-700">
                  {formatTokenAmount(balance.lockedBalanceFormatted)}/{formatTokenAmount(balance.totalBalanceFormatted)}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-[0.65rem] sm:text-xs text-gray-600">
                  {balance.usdValue}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-[0.65rem] sm:text-xs text-gray-400">...</span>
              </div>
            )}
          </div>

          {/* Profile Pill - Right (with dev mode switcher) */}
          {isDevelopmentMode ? (
            <ProfileSwitcher
              currentProfile={simulatedProfile}
              onProfileChange={(profile) => {
                setSimulatedProfile(profile);
                // Clear session dismissal to force modal to show
                if (typeof window !== 'undefined') {
                  sessionStorage.removeItem(`higher-steaks-onboarding-dismissed-${profile.fid}`);
                }
                setShowOnboardingModal(false); // Reset modal state
              }}
              isDevelopmentMode={isDevelopmentMode}
            />
          ) : (
            <div className="flex items-center gap-2 bg-white/95 backdrop-blur-sm border border-black/10 rounded-full px-2 py-1.5 shadow-sm hover:shadow-md transition-shadow">
              {user ? (
                <>
                  <img 
                    src={user.pfpUrl} 
                    alt={user.username}
                    className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border border-black/10"
                  />
                  <span className="text-[0.65rem] sm:text-xs font-medium text-gray-800 pr-1.5">
                    @{user.username}
                  </span>
                </>
              ) : (
                <>
                  <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border border-black/10 bg-gray-100 flex items-center justify-center">
                    <span className="text-gray-400 text-xs font-bold">?</span>
                  </div>
                  <span className="text-[0.65rem] sm:text-xs font-medium text-gray-400 pr-1.5">
                    Not Connected
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="border-2 border-black p-2 sm:p-3 md:p-4">
          <div className="text-center mb-6 md:mb-10">
            <div className="flex justify-center overflow-x-hidden">
              <pre 
                className="text-[0.28rem] leading-[0.32rem] sm:text-[0.4rem] sm:leading-[0.45rem] md:text-[0.5rem] md:leading-[0.55rem] lg:text-[0.6rem] lg:leading-[0.65rem] xl:text-[0.7rem] xl:leading-[0.75rem] whitespace-pre origin-center transform"
                style={{
                  transform: `scaleX(${asciiScale.scaleX}) scaleY(${asciiScale.scaleY})`
                }}
              >
                {` 
        @@@@@@@@   @@@@@@@@@ @@@@@@@@       @@@@@@@       @@@@@@@@   @@@@@@@@ @@@@@@@@@@@@@@@  @@@@@@@@@@              
          @@@        @@@      @@@        @@        @@@     +@@         @@@      @@        @@     @@     @@@@          
          @@@        @@@      @@@      @@@           @      @@         @@       @@         @     @@      @@@@         
          @@@        @@@      @@@     @@@                   @@         @@       @@       %       @@      @@@@         
          @@*        @@@      @@@    @@@                    @@         @@       @@       @       @@      @@@          
          @@@@@@@@@@@@@@      @@@    @@@           @@@@     @@@@@@@@@@@@@       @@@@@@@@@@       @@@@@@@@             
          @@*        @@@      @@@    @@@@          @@@      @@         @@       @@       @       @@   @@@             
          @@@        @@@      @@@     @@@          @@@      @@         @@       @@     @@        @@@    @@@           
          @@@        @@@      @@@      @@@         @@@      @@         @@       @@@   @#@@@@@@@@-@@@  @  @@@          
          @@@        @@@      @@@       @@@@       @@@     #@@         @@@     @@@@ =.     @-#:  @@@-  @  @@@         
       @@@@@@@@   @@@@@@@@@ @@@@@@@@        @@@@@@@      @@@@@@@@   @@@@@@@@@@@@@@@@@@@@@@@@  @@@@@@@@ @@   @@@@@     
                                                                       @   @         .@       @ @   -   @@            
                                       @     @      @               @@@@@@@# ::-=-- @.         #@=+=@  @@@@           
                                   @ @@@@@@@@@@@@@@   @@@@@@@@@@@@@@@#+:.::-===-- @@@   @ @@ @@@*++@@  @@*@           
                                   @@@:..::-=-::. @@@@@  @@@-  .::::::-=====-:.:@@@  @@@@@@@@@%*+*@@   @**@@          
                               @ @@@.--==========-:..:@@@@  @@@=.:-======--:.@@@@  @@@*%%.:::..#+@@   @@***@          
                              @ @@#.-================-::.@@@#@ @@@# :::::.*@@@   @@@%#.::-====.%@@   @@#**#@          
                                @#=-====================-::.+@@@@ @@@@@=@@@@  @@@@+.:-=======-:@@   @@%***#@          
                             @ @*#.=========================-::.@@@   @@@   @@@+.:-========-::@@   @@-%***@@          
                             @ @@#+-===========================-:.@@@      @@ :-==========-:@@@   @@+=%**#@           
                             @  @%%.-=============================-.@@  . @@ -==========-- @@    @@*+=%**@@           
                             @@ #@+%:-=============================-.@@   @@:+========-:.@@@   @@@**+@#*@@            
                             @@  @@@%.-=============================:@@:  @%:=======--.@@@    @@+**++%*@@             
                             @@@   @@#+.-===========================--@@  @%.=====-:.@@@+   @@@***+=%@@@              
                             @*@@   @@@%#.:-=========================:#@  @*.==--.+@@@@    @@+***+=%@@@               
                             @#*@@@   @@@*@-.::-=====================:%@  @@#...%@@@     @@@****+=%@@                 
                             @@***@@@   @@@@#%@.::::-================.#@   @+@@@@@    @@@@******+@@@                  
                              @@#*##@@@    @@@@@@#%%-:::::::::::::::.+@@ . @@@=     @@@******++*@@                    
                               @@##%=+@@@       @@@@@@@@@@@=--=#@@@@@@@- .       @@@@+******+=@@@                     
                                @@*#%=+*@@@@@            .@@@@@@#            @@@@@+*******++@@@                       
                                 @@@#%+****+@@@@@@@@                   @@@@@@@+*********++@@@                         
                                   @@@%=++*******+#@@@@@@@@@@@@@@@@@@@@@*+***********+++@@@                           
                                     @@@@=++**************************************++=@@@@                             
                                       @@@@*=++*******************************++==@@@@                                
                                          @@@@@@===++*******************++===#@@@@@                                   
                                               @@@@@@@@%==============@@@@@@@@@-                                       
                                                       @@@@@@@@@@@@@@@@                                               `}
              </pre>
            </div>
            <div className="text-sm sm:text-base md:text-lg lg:text-xl mt-4 md:mt-6 opacity-70">
              <p className="mb-1">Premium Cuts & Fine Dining</p>
              <p className="text-xs sm:text-sm md:text-base lg:text-lg mb-3 md:mb-4 font-bold">Est. 2025</p>
              <div className="border-t-2 border-black/30"></div>
            </div>
          </div>

          <div className="px-1 sm:px-2 md:px-4 mt-4 sm:mt-6 md:mt-8">

            <div className="space-y-4 md:space-y-5">
              {loadingLeaderboard ? (
                // Loading state
                <div className="text-center py-8">
                  <div className="animate-spin h-8 w-8 border-3 border-black border-t-transparent rounded-full mx-auto mb-3"></div>
                  <p className="text-xs sm:text-sm text-gray-600">Loading menu...</p>
                </div>
              ) : filteredLeaderboard.length > 0 ? (
                // Leaderboard entries
                filteredLeaderboard.map((entry, index) => (
                  <div key={entry.castHash} className="group">
                    <div className="flex items-baseline text-xs sm:text-sm md:text-base">
                      <a 
                        href={`https://farcaster.xyz/${entry.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 font-bold hover:text-purple-700 transition-colors"
                      >
                        @{entry.username}
                      </a>
                      <span className="flex-grow mx-2 border-b border-dotted border-black/30 mb-1"></span>
                      <span className="flex-shrink-0 font-bold tracking-wider">{entry.usdValue}</span>
                    </div>
                    <a
                      href={`https://farcaster.xyz/${entry.username}/${entry.castHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block mt-1 text-[0.65rem] sm:text-xs text-gray-600 hover:text-gray-900 transition-colors italic"
                    >
                      {entry.description}
                    </a>
                  </div>
                ))
              ) : (
                // Sold Out if leaderboard is empty
                <div className="text-center py-8">
                  <p className="text-base sm:text-lg md:text-xl font-bold">Sold Out</p>
                </div>
              )}
            </div>

            <div className="mt-8 md:mt-10 text-center text-[0.65rem] xs:text-[0.7rem] sm:text-xs md:text-sm border-t border-black/20 pt-4">
              <p className="tracking-wide">All steaks served with choice of two sides</p>
              <p className="mt-3 tracking-wider">* Prices subject to market availability *</p>
            </div>
          </div>
        </div>

        <div className="text-center mt-3 md:mt-4">
          <p className="text-[0.65rem] xs:text-[0.7rem] sm:text-xs tracking-wide opacity-60">Menu Changes Daily · 12PM UTC</p>
        </div>
      </div>

      {/* Floating Action Button */}
      <button
        onClick={handleFabClick}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-black text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-110 flex items-center justify-center border-2 border-white"
        aria-label="Open onboarding"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    </main>
    <BlockLivenessIndicator />
    </>
  );
}
