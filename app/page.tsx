'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import * as jose from 'jose';

interface User {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  walletAddress: string | null;
  bio?: string;
}

export default function HigherSteakMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [menuItems] = useState([
    { name: "The Ribeye Supreme", price: "$48.00" },
    { name: "Filet Mignon Deluxe", price: "$52.00" },
    { name: "New York Strip Classic", price: "$44.00" },
    { name: "Porterhouse for Two", price: "$89.00" },
    { name: "Wagyu Sirloin Experience", price: "$76.00" },
    { name: "Grilled Salmon Steak", price: "$38.00" },
    { name: "Bone-In Tomahawk", price: "$95.00" },
    { name: "Surf & Turf Combo", price: "$68.00" },
    { name: "Prime Skirt Steak", price: "$36.00" },
    { name: "Vegetarian Portobello Stack", price: "$28.00" },
  ]);

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

    // Then try to authenticate (this can happen after splash is hidden)
    const authenticate = async () => {
      try {
        const { token } = await sdk.quickAuth.getToken();
        console.log('✅ Authenticated with Farcaster');
        
        // Decode JWT to get FID immediately
        const decoded = jose.decodeJwt(token);
        const fid = decoded.sub as number;
        console.log('FID from token:', fid);

        // Fetch full profile from backend
        const response = await fetch('/api/user/profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
        });

        if (response.ok) {
          const profileData = await response.json();
          console.log('Profile data:', profileData);
          setUser(profileData);
        } else {
          console.error('Failed to fetch profile:', await response.text());
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
        console.log('No authentication available:', error);
      }
    };

    authenticate();
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
        {/* Authentication Status */}
        {user && (
          <div className="mb-4 p-3 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
            <div className="flex items-center gap-3">
              {user.pfpUrl && (
                <img 
                  src={user.pfpUrl} 
                  alt={user.displayName}
                  className="w-10 h-10 rounded-full border-2 border-white shadow-sm"
                />
              )}
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800">
                  {user.displayName}
                  <span className="text-purple-600 ml-2">@{user.username}</span>
                </p>
                <p className="text-xs text-gray-600">
                  FID: {user.fid}
                  {user.walletAddress && (
                    <span className="ml-2">
                      • {user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-4)}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-green-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
        )}
        
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

            <div className="space-y-3 md:space-y-4">
              {menuItems.map((item, index) => (
                <div key={index} className="flex items-baseline text-xs sm:text-sm md:text-base">
                  <span className="flex-shrink-0">{item.name}</span>
                  <span className="flex-grow mx-2 border-b border-dotted border-black/30 mb-1"></span>
                  <span className="flex-shrink-0 font-bold tracking-wider">{item.price}</span>
                </div>
              ))}
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
