'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import { OnboardingModal } from '@/components/OnboardingModal';
import { StakingModal } from '@/components/StakingModal';
import { SupporterModal } from '@/components/SupporterModal';
import { TransactionModal } from '@/components/TransactionModal';
import { UserModal } from '@/components/UserModal';
import { LandingPage } from '@/components/LandingPage';
import { ProfileSwitcher, SimulatedProfile, SIMULATED_PROFILES } from '@/components/ProfileSwitcher';
import { useAccount } from 'wagmi';
import { HIGHER_TOKEN_ADDRESS } from '@/lib/contracts';
import { ALLOWED_FIDS } from '@/config/allowed-fids';

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
  castHash?: string | null;
  stakeType?: 'caster' | 'supporter' | null;
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
  
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [duneStakedData, setDuneStakedData] = useState<{
    totalStaked: string;
    lockups: LockupDetail[];
    loading: boolean;
  } | null>(null);
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
  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedCastHash, setSelectedCastHash] = useState<string | null>(null);
  const [simulatedFid, setSimulatedFid] = useState<number | null>(null); // For testing supporter vs caster view
  // FID switcher removed; simulatedFid now unused in UI (could be set via dev tools if needed)
  const [transactionModal, setTransactionModal] = useState<{
    variant: 'failure' | 'lock-success' | 'unlock-success';
    errorMessage?: string;
    txHash?: string;
    castHash?: string;
  } | null>(null);
  
  // Detect pixel density for ASCII art scaling
  const [pixelDensity, setPixelDensity] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  
  const { address: wagmiAddress } = useAccount();
  
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

  const showLockSuccess = useCallback((txHash?: string, castHash?: string, amount?: string, unlockTime?: number, lockupId?: string) => {
    setTransactionModal({
      variant: 'lock-success',
      txHash,
      castHash,
    });
    // Optimistically update: add new lockup to list and add to total
    if (amount && unlockTime && lockupId && wagmiAddress) {
      setDuneStakedData(prev => {
        if (!prev) {
          return {
            totalStaked: amount,
            lockups: [{
              lockupId,
              amount,
              amountFormatted: formatTokenAmount(amount),
              unlockTime,
              receiver: wagmiAddress,
              title: castHash || '',
              castHash: castHash || null,
              unlocked: false,
            }],
            loading: false,
          };
        }
        const currentTotal = parseFloat(prev.totalStaked);
        const amountNum = parseFloat(amount);
        const newTotal = currentTotal + amountNum;
        const newLockup: LockupDetail = {
          lockupId,
          amount,
          amountFormatted: formatTokenAmount(amount),
          unlockTime,
          receiver: wagmiAddress,
          title: castHash || '',
          castHash: castHash || null,
          unlocked: false,
        };
        return {
          ...prev,
          totalStaked: newTotal.toString(),
          lockups: [...prev.lockups, newLockup],
        };
      });
    }
  }, [wagmiAddress]);

  const showUnlockSuccess = useCallback((txHash?: string, lockupId?: string, amount?: string) => {
    setTransactionModal({
      variant: 'unlock-success',
      txHash,
    });
    // Optimistically update: remove lockup from list and subtract from total
    if (lockupId && amount) {
      setDuneStakedData(prev => {
        if (!prev) return prev;
        const filteredLockups = prev.lockups.filter(l => l.lockupId !== lockupId);
        const currentTotal = parseFloat(prev.totalStaked);
        const amountNum = parseFloat(amount);
        const newTotal = Math.max(0, currentTotal - amountNum);
        return {
          ...prev,
          totalStaked: newTotal.toString(),
          lockups: filteredLockups,
        };
      });
    }
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

  const fetchDuneStakes = async (fid: number, connectedAddress?: string) => {
    console.log('[fetchDuneStakes] Called for fid:', fid, 'address:', connectedAddress);
    setDuneStakedData(prev => prev ? { ...prev, loading: true } : { totalStaked: '0', lockups: [], loading: true });
    
    try {
      const url = `/api/user/stakes?fid=${fid}${connectedAddress ? `&connectedAddress=${connectedAddress}` : ''}&offset=0`;
      const response = await fetch(url, { cache: 'no-store' });
      
      if (response.ok) {
        const data = await response.json();
        const items = data.items || [];
        
        // Filter to only include lockups where unlocked === false
        const lockedLockups = items.filter((item: LockupDetail) => !item.unlocked);
        
        // Calculate totalStaked by summing amounts of locked lockups
        const totalStaked = lockedLockups.reduce((sum: number, lockup: LockupDetail) => {
          const amount = parseFloat(lockup.amount || '0');
          return sum + (Number.isFinite(amount) ? amount : 0);
        }, 0);
        
        console.log('[fetchDuneStakes] Locked lockups:', lockedLockups.length, 'Total staked:', totalStaked);
        
        setDuneStakedData({
          totalStaked: totalStaked.toString(),
          lockups: lockedLockups,
          loading: false,
        });
      } else {
        console.error('[fetchDuneStakes] Failed to fetch stakes, status:', response.status);
        setDuneStakedData(prev => prev ? { ...prev, loading: false } : { totalStaked: '0', lockups: [], loading: false });
      }
    } catch (error) {
      console.error('[fetchDuneStakes] Error:', error);
      setDuneStakedData(prev => prev ? { ...prev, loading: false } : { totalStaked: '0', lockups: [], loading: false });
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
    const staked = parseFloat(duneStakedData?.totalStaked ?? balance?.lockedBalanceFormatted ?? '0') || 0;
    const wallet = parseFloat(balance?.walletBalanceFormatted ?? '0') || 0;
    const total = staked + wallet;
    return {
      pillStaked: formatTokenAmount(staked.toString()),
      pillWallet: formatTokenAmount(wallet.toString()),
      pillTotal: formatTokenAmount(total.toString()),
    };
  }, [balance, duneStakedData]);

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
          setHasAccess(false);
          return;
        }

        const fid = context.user.fid;
        console.log('✅ User FID from context:', fid);

        // Check if FID is in allowed list
        const isAllowed = ALLOWED_FIDS.includes(fid);
        setHasAccess(isAllowed);

        if (!isAllowed) {
          console.log('❌ User FID not in allowed list:', fid);
          return;
        }

        console.log('✅ User FID is allowed, fetching profile...');

        // Fetch full profile from backend
        const response = await fetch(`/api/user/profile?fid=${fid}`);

        if (response.ok) {
          const profileData = await response.json();
          console.log('Profile data:', profileData);
          setUser(profileData);
          // Fetch token balance and cast data after getting user profile
          fetchTokenBalance(fid);
          fetchCastData(fid);
          fetchDuneStakes(fid, wagmiAddress);
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
        setHasAccess(false);
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
      // Check if simulated FID is allowed
      const isAllowed = ALLOWED_FIDS.includes(simulatedProfile.fid);
      setHasAccess(isAllowed);
      
      if (!isAllowed) {
        return;
      }
      
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

  // Check if there are any unstakeable positions (unlockTime <= currentTime and not already unlocked)
  const hasUnstakeablePositions = useMemo(() => {
    if (!balance?.lockups || balance.lockups.length === 0) return false;
    const currentTime = Math.floor(Date.now() / 1000);
    return balance.lockups.some((lockup) => 
      lockup.unlockTime <= currentTime && !lockup.unlocked
    );
  }, [balance?.lockups]);

  // Conditional rendering based on access
  if (hasAccess === false) {
    return <LandingPage />;
  }

  if (hasAccess === null) {
    // Loading state - show nothing or minimal loading indicator
    return null;
  }

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
          onOpenSupporterModal={(castHash) => {
            setSelectedCastHash(castHash);
            setShowOnboardingModal(false);
            setShowSupporterModal(true);
          }}
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
          duneStakedData={duneStakedData ? {
            totalStaked: duneStakedData.totalStaked,
            lockups: duneStakedData.lockups,
          } : null}
          onTransactionSuccess={async () => {
            // Balance will be refreshed on next fetch
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
          userFid={user?.fid || null}
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

      {/* User Modal */}
      {showUserModal && user && (
        <UserModal
          onClose={() => setShowUserModal(false)}
          userFid={user.fid}
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
                {balance.block?.iso && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-[0.55rem] text-gray-500 hidden sm:inline">
                      {new Date(balance.block.iso).toLocaleString()}
                    </span>
                  </>
                )}
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
              className="relative flex items-center gap-2 bg-white/95 backdrop-blur-sm border border-black/10 rounded-full px-2 py-1.5 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setShowUserModal(true)}
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
              <p className="mb-1">Premium Cuts from the Higher Network</p>
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
                  <button
                    key={entry.castHash}
                    onClick={() => {
                      setSelectedCastHash(entry.castHash);
                      setShowSupporterModal(true);
                    }}
                    className="w-full text-left group hover:bg-gray-50/50 transition-colors cursor-pointer rounded-sm p-1 -m-1"
                  >
                    <div className="flex items-baseline text-xs sm:text-sm md:text-base">
                      <span className="flex-shrink-0 font-bold">@{entry.username}</span>
                      <span className="flex-grow mx-2 border-b border-dotted border-black/30 mb-1"></span>
                      <span className="flex-shrink-0 font-bold tracking-wider">{entry.usdValue}</span>
                    </div>
                    <div className="mt-1 text-[0.65rem] sm:text-xs text-gray-600 italic">
                      {entry.description}
                    </div>
                  </button>
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
           <p className="text-[0.65rem] xs:text-[0.7rem] sm:text-xs tracking-wide opacity-60 font-bold">Est. 2025</p>
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
