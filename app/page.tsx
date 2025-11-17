'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import { OnboardingModal } from '@/components/OnboardingModal';
import { StakingModal } from '@/components/StakingModal';
import { SupporterModal } from '@/components/SupporterModal';
import { TransactionModal } from '@/components/TransactionModal';
import { ProfileSwitcher, SimulatedProfile, SIMULATED_PROFILES } from '@/components/ProfileSwitcher';
import { BlockLivenessIndicator } from '@/components/BlockLivenessIndicator';
import { useAccount } from 'wagmi';
import { HIGHER_TOKEN_ADDRESS } from '@/lib/contracts';

interface User {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  walletAddress: string | null;
  bio?: string;
}

interface BlockInfo {
  number: string;
  timestamp: number;
  iso: string;
  ageSeconds: number;
}

interface TokenBalance {
  totalBalance?: string;
  totalBalanceFormatted: string;
  lockedBalance?: string;
  lockedBalanceFormatted: string;
  walletBalance?: string;
  walletBalanceFormatted?: string;
  usdValue: string;
  pricePerToken: number;
  higherLogoUrl?: string;
  lockups?: LockupDetail[];
  wallets?: WalletDetail[];
  block?: BlockInfo;
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
  receiver: string;
  title: string;
  unlocked?: boolean;
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
  const [showSupporterModal, setShowSupporterModal] = useState(false);
  const [selectedCastHash, setSelectedCastHash] = useState<string | null>(null);
  const [simulatedFid, setSimulatedFid] = useState<number | null>(null); // For testing supporter vs caster view
  const [showFidSwitcher, setShowFidSwitcher] = useState(false);
  const fidSwitcherRef = useRef<HTMLDivElement>(null);
  const [transactionModal, setTransactionModal] = useState<{
    variant: 'failure' | 'lock-success' | 'unlock-success';
    errorMessage?: string;
    txHash?: string;
    castHash?: string;
  } | null>(null);
  
  // Detect pixel density for ASCII art scaling
  const [pixelDensity, setPixelDensity] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  
  // Event subscriptions for real-time updates (via SSE/CDP webhooks)
  const { address: wagmiAddress } = useAccount();
  
  // Close FID switcher when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fidSwitcherRef.current && !fidSwitcherRef.current.contains(event.target as Node)) {
        setShowFidSwitcher(false);
      }
    };

    if (showFidSwitcher) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFidSwitcher]);
  
  // Handle stake success: refresh balance and staking details to get the new lockup
  const handleStakeSuccess = useCallback(() => {
    console.log('[Stake Success] Refreshing balance');

    if (user?.fid) {
      fetchTokenBalance(user.fid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.fid]);

  const closeTransactionModal = useCallback(() => {
    setTransactionModal(null);
  }, []);

  const showTransactionFailure = useCallback((message?: string) => {
    setTransactionModal({
      variant: 'failure',
      errorMessage: message,
    });
  }, []);

  const showLockSuccess = useCallback((txHash?: string, castHash?: string) => {
    setTransactionModal({
      variant: 'lock-success',
      txHash,
      castHash,
    });
  }, []);

  const showUnlockSuccess = useCallback((txHash?: string) => {
    setTransactionModal({
      variant: 'unlock-success',
      txHash,
    });
  }, []);

  const fetchTokenBalance = async (fid: number) => {
    console.log('[fetchTokenBalance] Called for fid:', fid);
    setLoadingBalance(true);
    setBalanceError(null);
    try {
      const response = await fetch(`/api/user/balance?fid=${fid}`);
      if (response.ok) {
        const balanceData: TokenBalance = await response.json();
        console.log('[fetchTokenBalance] Balance data received:', {
          hasLockups: !!balanceData.lockups,
          lockupCount: balanceData.lockups?.length,
          higherLogoUrl: balanceData.higherLogoUrl,
          blockNumber: balanceData.block?.number,
        });
        setBalance(balanceData);
      } else {
        console.error('[fetchTokenBalance] Failed to fetch balance, status:', response.status);
        setBalanceError('Failed to fetch balance');
        setBalance(null);
      }
    } catch (error) {
      console.error('[fetchTokenBalance] Error:', error);
      setBalanceError('Unexpected error');
      setBalance(null);
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

  const { pillStaked, pillWallet, pillTotal } = useMemo(() => {
    const staked = parseFloat(balance?.lockedBalanceFormatted ?? '0') || 0;
    const wallet = parseFloat(balance?.walletBalanceFormatted ?? '0') || 0;
    const total = staked + wallet;
    return {
      pillStaked: formatTokenAmount(staked.toString()),
      pillWallet: formatTokenAmount(wallet.toString()),
      pillTotal: formatTokenAmount(total.toString()),
    };
  }, [balance]);
  
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
      const now = Math.floor(Date.now() / 1000);
      setBalance({
        totalBalanceFormatted: simulatedProfile.walletBalance,
        lockedBalanceFormatted: '0.00',
        usdValue: '$0.00',
        pricePerToken: 0,
        lockups: [],
        wallets: [],
        block: {
          number: 'simulated',
          timestamp: now,
          iso: new Date(now * 1000).toISOString(),
          ageSeconds: 0,
        },
      });
      
      setLoadingBalance(false);
      setLoadingLeaderboard(false);
    }
  }, [isDevelopmentMode, simulatedProfile]);

  // Handle balance pill click
  const handleBalancePillClick = () => {
    if (user?.fid) {
      fetchTokenBalance(user.fid);
      setShowStakingModal(true);
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
    return balance.wallets.reduce((acc, wallet) => {
      const numeric = parseFloat(wallet.balanceFormatted.replace(/,/g, ''));
      return acc + (Number.isFinite(numeric) ? numeric : 0);
    }, 0);
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

  // Check if there are any unstakeable positions (unlockTime <= currentTime)
  const hasUnstakeablePositions = useMemo(() => {
    if (!balance?.lockups || balance.lockups.length === 0) return false;
    const currentTime = Math.floor(Date.now() / 1000);
    return balance.lockups.some((lockup) => lockup.unlockTime <= currentTime);
  }, [balance?.lockups]);


  return (
    <>
      {transactionModal && (
        <TransactionModal
          variant={transactionModal.variant}
          errorMessage={transactionModal.errorMessage}
          txHash={transactionModal.txHash}
          castHash={transactionModal.castHash}
          onClose={closeTransactionModal}
        />
      )}

      {/* Onboarding Modal */}
      {showOnboardingModal && user && (
        <OnboardingModal
          onClose={handleCloseOnboardingModal}
          userFid={user.fid}
          walletBalance={getWalletBalance()}
          onStakeSuccess={handleStakeSuccess}
          onTransactionFailure={showTransactionFailure}
          onLockSuccess={showLockSuccess}
        />
      )}

      {/* Staking Modal */}
      {showStakingModal && balance && (
        <StakingModal
          onClose={() => setShowStakingModal(false)}
          balance={balance}
          lockups={balance.lockups || []}
          wallets={balance.wallets || []}
          loading={loadingBalance}
          onTransactionSuccess={async () => {
            // CDP webhook will automatically detect the transaction and refresh the balance
            // No manual refresh needed
          }}
          onTransactionFailure={showTransactionFailure}
          onUnlockSuccess={showUnlockSuccess}
        />
      )}

      {/* Supporter Modal */}
      {showSupporterModal && selectedCastHash && (
        <SupporterModal
          castHash={selectedCastHash}
          onClose={() => {
            setShowSupporterModal(false);
            setSelectedCastHash(null);
          }}
          userFid={simulatedFid !== null ? simulatedFid : (user?.fid || null)}
          walletBalance={getWalletBalance()}
          onStakeSuccess={() => {
            // Refresh balance and leaderboard
            if (user?.fid) {
              fetchTokenBalance(user.fid);
            }
            // Refresh leaderboard
            fetch('/api/leaderboard/refresh', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
            }).catch(err => {
              console.error('[SupporterModal] Error refreshing leaderboard:', err);
            });
          }}
          onTransactionFailure={showTransactionFailure}
          onLockSuccess={showLockSuccess}
        />
      )}

      <main className="min-h-screen bg-[#f9f7f1] text-black p-2 sm:p-4 md:p-6 font-mono">
        <div className="max-w-4xl mx-auto bg-[#fefdfb] shadow-lg p-3 sm:p-4 md:p-8 border border-[#e5e3db]">
        {/* Header Row - Balance left, Profile right */}
        <div className="flex justify-between items-center gap-2 mb-3 sm:mb-4 relative z-[100]">
          {/* Token Balance Pill - Left */}
          <div 
            className="relative bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-full px-3 py-1.5 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
            onClick={handleBalancePillClick}
          >
            {/* Unstake notification indicator */}
            {hasUnstakeablePositions && (
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse border-2 border-white shadow-lg shadow-red-500/50" title="You have positions ready to unstake" />
            )}
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
                <span
                  className="text-[0.65rem] sm:text-xs font-bold text-purple-700"
                  title={`Wallet: ${pillWallet} HIGHER`}
                >
                  {pillStaked}/{pillTotal}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-[0.65rem] sm:text-xs text-gray-600">
                  {balance.usdValue || '$0.00'}
                </span>
                <span className="text-gray-400">•</span>
                <div className="flex items-center gap-1">
                  <BlockLivenessIndicator
                    blockNumber={balance.block?.number}
                    blockTimestamp={balance.block?.timestamp}
                  />
                  {typeof balance.block?.ageSeconds === 'number' && (
                    <span className="text-[0.55rem] text-gray-500 hidden sm:inline">
                      {balance.block.ageSeconds < 60
                        ? `${balance.block.ageSeconds}s ago`
                        : `${Math.floor(balance.block.ageSeconds / 60)}m ago`}
                    </span>
                  )}
                </div>
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
            <div 
              ref={fidSwitcherRef}
              className="relative flex items-center gap-2 bg-white/95 backdrop-blur-sm border border-black/10 rounded-full px-2 py-1.5 shadow-sm hover:shadow-md transition-shadow cursor-pointer z-[100]"
              onClick={() => setShowFidSwitcher(!showFidSwitcher)}
            >
              {user ? (
                <>
                  <img 
                    src={user.pfpUrl} 
                    alt={user.username}
                    className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border border-black/10"
                  />
                  <span className="text-[0.65rem] sm:text-xs font-medium text-gray-800">
                    @{user.username}
                    {simulatedFid !== null && simulatedFid !== user.fid && (
                      <span className="text-purple-600 ml-1">(FID: {simulatedFid})</span>
                    )}
                  </span>
                  {showFidSwitcher && (
                    <div 
                      className="absolute top-full mt-2 right-0 bg-white border border-black/20 rounded-lg shadow-lg z-[100] min-w-[200px] p-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="text-xs font-bold text-black mb-2">Switch FID for Testing</div>
                      <div className="mb-2">
                        <input
                          type="number"
                          placeholder="Enter FID"
                          value={simulatedFid || ''}
                          onChange={(e) => {
                            const fid = e.target.value ? parseInt(e.target.value, 10) : null;
                            setSimulatedFid(fid);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-xs border border-black/20 p-2 rounded"
                        />
                      </div>
                      <div className="text-xs text-gray-600 mb-2">Or select from leaderboard:</div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {leaderboard.slice(0, 10).map((entry) => (
                          <button
                            key={entry.fid}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSimulatedFid(entry.fid);
                              setShowFidSwitcher(false);
                            }}
                            className={`w-full text-left px-2 py-1 text-xs hover:bg-gray-100 rounded ${
                              simulatedFid === entry.fid ? 'bg-purple-50 border border-purple-200' : ''
                            }`}
                          >
                            @{entry.username} (FID: {entry.fid})
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t border-black/20">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSimulatedFid(null);
                            setShowFidSwitcher(false);
                          }}
                          className="w-full text-xs text-gray-600 hover:text-black underline"
                        >
                          Reset to real FID
                        </button>
                      </div>
                    </div>
                  )}
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
                    <button
                      onClick={() => {
                        setSelectedCastHash(entry.castHash);
                        setShowSupporterModal(true);
                      }}
                      className="block mt-1 text-[0.65rem] sm:text-xs text-gray-600 hover:text-gray-900 transition-colors italic text-left w-full"
                    >
                      {entry.description}
                    </button>
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

       {/* Footer */}
       <div className="text-center mt-4 md:mt-8 pt-4 border-t border-black/10">
           <p className="text-[0.65rem] xs:text-[0.7rem] sm:text-xs text-gray-600 mb-1">
             Built by{' '}
             <a
               href="https://farcaster.xyz/agrimony.eth"
               target="_blank"
               rel="noopener noreferrer"
               className="text-purple-600 hover:text-purple-700 underline transition-colors"
             >
               @agrimony.eth
             </a>
             {' '}with love
           </p>
           <button
             onClick={async () => {
               try {
                 // Base chain ID is 8453, format as CAIP-19
                 const higherTokenCAIP = `eip155:8453/erc20:${HIGHER_TOKEN_ADDRESS}`;
                 const result = await sdk.actions.sendToken({
                   token: higherTokenCAIP,
                   recipientFid: 191780,
                 });
                 if (!result.success) {
                   console.error('Send token failed:', result);
                 }
               } catch (error) {
                 console.error('Error sending token:', error);
               }
             }}
             className="text-[0.65rem] xs:text-[0.7rem] sm:text-xs text-gray-600 hover:text-purple-600 transition-colors underline"
           >
             Donate a ☕
           </button>
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
     </>
   );
 }
