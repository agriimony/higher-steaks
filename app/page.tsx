'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

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
  usdValue: string;
  pricePerToken: number;
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

export default function HigherSteakMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);
  
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
      try {
        const response = await fetch(`/api/user/balance?fid=${fid}`);
        if (response.ok) {
          const balanceData = await response.json();
          console.log('Balance data:', balanceData);
          setBalance(balanceData);
        } else {
          console.error('Failed to fetch balance');
        }
      } catch (error) {
        console.error('Error fetching balance:', error);
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

  const handleGetToken = async () => {
    try {
      const { token } = await sdk.quickAuth.getToken();
      console.log('Token:', token);
      alert(`Authenticated! Token: ${token.substring(0, 20)}...`);
    } catch (error) {
      console.error('Auth error:', error);
    }
  };

  return (
    <main className="min-h-screen bg-[#f9f7f1] text-black p-2 sm:p-4 md:p-6 font-mono">
      <div className="max-w-4xl mx-auto bg-[#fefdfb] shadow-lg p-3 sm:p-4 md:p-8 border border-[#e5e3db]">
        {/* Header Row - Balance left, Profile right */}
        <div className="flex justify-between items-center gap-2 mb-3 sm:mb-4">
          {/* Token Balance Pill - Left */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-full px-3 py-1.5 shadow-sm">
            {loadingBalance ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin h-3 w-3 border-2 border-purple-600 border-t-transparent rounded-full"></div>
                <span className="text-[0.65rem] sm:text-xs text-gray-600">Loading...</span>
              </div>
            ) : balance ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[0.65rem] sm:text-xs font-bold text-purple-700">
                  {formatTokenAmount(balance.totalBalanceFormatted)} HIGHER
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

          {/* Profile Pill - Right */}
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
        </div>

        <div className="border-2 border-black p-2 sm:p-3 md:p-4">
          <div className="text-center mb-6 md:mb-10">
            <div className="flex justify-center overflow-x-auto">
              <pre className="text-[0.25rem] leading-[0.28rem] xs:text-[0.3rem] xs:leading-[0.33rem] sm:text-[0.4rem] sm:leading-[0.45rem] md:text-[0.5rem] md:leading-[0.55rem] lg:text-[0.6rem] lg:leading-[0.65rem] xl:text-[0.7rem] xl:leading-[0.75rem] whitespace-pre">
                {` @@@@@@@@   @@@@@@@@@ @@@@@@@@        @@@@@@   @   @@@@@@@@   @@@@@@@@ @@@@@@@@@@@@@@@  @@@@@@@@@@              
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
                        href={`https://warpcast.com/${entry.username}`}
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
                      href={`https://warpcast.com/${entry.username}/${entry.castHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block mt-1 text-[0.65rem] sm:text-xs text-gray-600 hover:text-gray-900 transition-colors italic"
                    >
                      {entry.description}
                    </a>
                  </div>
                ))
              ) : (
                // Fallback menu if leaderboard is empty
                fallbackMenuItems.map((item, index) => (
                  <div key={index}>
                    <div className="flex items-baseline text-xs sm:text-sm md:text-base">
                      <span className="flex-shrink-0 font-bold">{item.name}</span>
                      <span className="flex-grow mx-2 border-b border-dotted border-black/30 mb-1"></span>
                      <span className="flex-shrink-0 font-bold tracking-wider">{item.price}</span>
                    </div>
                    <p className="mt-1 text-[0.65rem] sm:text-xs text-gray-600 italic">
                      {item.description}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="mt-8 md:mt-10 text-center text-[0.65rem] xs:text-[0.7rem] sm:text-xs md:text-sm border-t border-black/20 pt-4">
              <p className="tracking-wide">All steaks served with choice of two sides</p>
              <p className="mt-3 tracking-wider">* Prices subject to market availability *</p>
            </div>
          </div>
        </div>

        <div className="text-center mt-3 md:mt-4">
          <p className="text-[0.65rem] xs:text-[0.7rem] sm:text-xs tracking-wide opacity-60">Open Daily · 5PM – 11PM</p>
        </div>

        {/* Test Authentication Button (for development) */}
        <div className="mt-6 text-center">
          <button
            onClick={handleGetToken}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Test Quick Auth
          </button>
        </div>
      </div>
    </main>
  );
}
