'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import { OnboardingModal } from '@/components/OnboardingModal';
import { StakingModal } from '@/components/StakingModal';
import { ProfileSwitcher, SimulatedProfile, SIMULATED_PROFILES } from '@/components/ProfileSwitcher';

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
  const [stakingBalance, setStakingBalance] = useState<StakingBalance | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [onboardingState, setOnboardingState] = useState<'staked-no-cast' | 'has-enough' | 'needs-more' | null>(null);
  const [onboardingData, setOnboardingData] = useState<{
    stakedAmount?: string;
    walletAmount?: string;
    totalAmount?: string;
    minimumRequired?: string;
  }>({});
  const [showStakingModal, setShowStakingModal] = useState(false);
  const [stakingDetails, setStakingDetails] = useState<{
    lockups: LockupDetail[];
    wallets: WalletDetail[];
  } | null>(null);
  const [loadingStakingDetails, setLoadingStakingDetails] = useState(false);
  
  // Detect pixel density for ASCII art scaling
  const [pixelDensity, setPixelDensity] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  
  // Extract staking details and calculate staked balance from balance data (single source of truth)
  const updateStakingDetailsFromBalance = (balanceData: TokenBalance) => {
    if (balanceData.lockups && balanceData.wallets) {
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
          
          // Fetch token balance after getting user profile
          // Balance API now includes lockups and wallets (single source of truth)
          // Staking balance is calculated from lockups in the response
          fetchTokenBalance(fid);
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

    const fetchTokenBalance = async (fid: number) => {
      setLoadingBalance(true);
      setLoadingStakingDetails(true);
      try {
        const response = await fetch(`/api/user/balance?fid=${fid}`);
        if (response.ok) {
          const balanceData = await response.json();
          console.log('Balance data:', balanceData);
          console.log('Higher logo URL:', balanceData.higherLogoUrl);
          setBalance(balanceData);
          // Extract staking details from the same response (single source of truth)
          updateStakingDetailsFromBalance(balanceData);
        } else {
          console.error('Failed to fetch balance');
          setStakingDetails({ lockups: [], wallets: [] });
          setLoadingStakingDetails(false);
        }
      } catch (error) {
        console.error('Error fetching balance:', error);
        setStakingDetails({ lockups: [], wallets: [] });
        setLoadingStakingDetails(false);
      } finally {
        setLoadingBalance(false);
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

  // Check onboarding status after all data is loaded
  // DISABLED: Onboarding modal is disabled for now
  useEffect(() => {
    const checkOnboardingStatus = () => {
      // Onboarding modal disabled
      return;
      
      /* DISABLED CODE
      if (!user?.fid || loadingLeaderboard || loadingBalance) {
        return; // Wait for all data to load
      }

      // Check if user dismissed modal this session
      const dismissedKey = `higher-steaks-onboarding-dismissed-${user.fid}`;
      if (typeof window !== 'undefined' && sessionStorage.getItem(dismissedKey)) {
        return;
      }

      // 1. Check if user is already on leaderboard (or simulated profile says so)
      const isOnLeaderboard = isDevelopmentMode && simulatedProfile 
        ? simulatedProfile.isOnLeaderboard
        : leaderboard.some(entry => entry.fid === user.fid);
        
      if (isOnLeaderboard) {
        console.log('User is on leaderboard, skip onboarding modal');
        return; // Skip modal entirely
      }

      // Get balances
      const stakedAmount = parseFloat(stakingBalance?.totalStakedFormatted?.replace(/,/g, '') || '0');
      const walletAmount = parseFloat(balance?.totalBalanceFormatted?.replace(/,/g, '') || '0');
      const totalAmount = stakedAmount + walletAmount;
      
      // Get minimum leaderboard amount (10th place or 0 if leaderboard is empty)
      const minimumRequired = leaderboard.length > 0 
        ? parseFloat(leaderboard[leaderboard.length - 1]?.higherBalance?.replace(/,/g, '') || '0')
        : 0;

      console.log('Onboarding check:', {
        stakedAmount,
        walletAmount,
        totalAmount,
        minimumRequired,
        leaderboardLength: leaderboard.length,
      });

      // STATE 1: User has staked HIGHER but hasn't made a qualifying cast
      if (stakedAmount > 0) {
        setOnboardingState('staked-no-cast');
        setOnboardingData({
          stakedAmount: stakingBalance?.totalStakedFormatted || '0',
        });
        setShowOnboardingModal(true);
        console.log('Onboarding: State 1 - Staked but no cast');
        return;
      }

      // STATE 2: User is not staked enough
      // STATE 2a: User has enough HIGHER total but hasn't staked enough
      if (totalAmount >= minimumRequired && minimumRequired > 0) {
        setOnboardingState('has-enough');
        setOnboardingData({
          stakedAmount: stakingBalance?.totalStakedFormatted || '0',
          walletAmount: balance?.totalBalanceFormatted || '0',
          totalAmount: totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          minimumRequired: minimumRequired.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        });
        setShowOnboardingModal(true);
        console.log('Onboarding: State 2a - Has enough but not staked');
        return;
      }

      // STATE 2b: User does not have enough HIGHER total
      if (totalAmount < minimumRequired || minimumRequired === 0) {
        setOnboardingState('needs-more');
        setOnboardingData({
          totalAmount: totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          minimumRequired: minimumRequired > 0 
            ? minimumRequired.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '1,000.00', // Default minimum if leaderboard is empty
        });
        setShowOnboardingModal(true);
        console.log('Onboarding: State 2b - Needs more HIGHER');
        return;
      }
      */
    };

    checkOnboardingStatus();
  }, [user, balance, stakingBalance, leaderboard, loadingLeaderboard, loadingBalance]);

  const handleCloseOnboardingModal = () => {
    setShowOnboardingModal(false);
    // Remember dismissal for this session
    if (user?.fid && typeof window !== 'undefined') {
      sessionStorage.setItem(`higher-steaks-onboarding-dismissed-${user.fid}`, 'true');
    }
  };

  return (
    <>
      {/* Onboarding Modal */}
      {showOnboardingModal && onboardingState && (
        <OnboardingModal
          state={onboardingState}
          onClose={handleCloseOnboardingModal}
          data={onboardingData}
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
          onTransactionSuccess={async () => {
            // Refresh balance after successful transaction
            if (user?.fid) {
              // Refetch balance data
              try {
                const response = await fetch(`/api/user/balance?fid=${user.fid}`);
                if (response.ok) {
                  const balanceData = await response.json();
                  // Update balance and staking details
                  // The parent component will handle updating state
                  window.location.reload(); // Simple refresh for now - could be optimized later
                }
              } catch (error) {
                console.error('Error refreshing balance after transaction:', error);
              }
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
                <span className="text-[0.65rem] sm:text-xs">🥩</span>
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
              ) : leaderboard.length > 0 ? (
                // Leaderboard entries
                leaderboard.map((entry, index) => (
                  <div key={entry.fid} className="group">
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
    </main>
    </>
  );
}
