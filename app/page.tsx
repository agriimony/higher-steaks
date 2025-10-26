'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

interface User {
  fid: number;
  username?: string;
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
    // Call ready() to hide splash screen and show content
    const initApp = async () => {
      try {
        await sdk.actions.ready();
        console.log('✅ MiniApp ready - splash screen hidden');
      } catch (error) {
        console.log('Running in browser mode (not in Farcaster client)');
      }
      
      // Try to authenticate with Farcaster Quick Auth
      try {
        // Get the session token from Quick Auth
        const { token } = await sdk.quickAuth.getToken();
        console.log('✅ Authenticated with Farcaster');
        
        // You can decode and use the token here
        // For now, just set a mock user
        setUser({ fid: 1234 }); // TODO: decode JWT token to get real FID
      } catch (error) {
        console.log('Running in browser mode (not in Farcaster client)');
        // In browser, authentication might not be available
      }
    };

    initApp();
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
    <main className="min-h-screen bg-[#f9f7f1] text-black p-4 md:p-8 font-mono">
      <div className="max-w-4xl mx-auto bg-[#fefdfb] shadow-lg p-6 md:p-12 border border-[#e5e3db]">
        {/* Authentication Status */}
        {user && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
            <p className="text-sm text-blue-800">✓ Authenticated as Farcaster user</p>
          </div>
        )}
        
        <div className="border-2 border-black p-4 md:p-6">
          <div className="text-center mb-6 md:mb-10">
            <div className="flex justify-center">
              <pre className="text-[0.4rem] leading-[0.45rem] sm:text-[0.5rem] sm:leading-[0.55rem] md:text-[0.6rem] md:leading-[0.65rem] lg:text-[0.7rem] lg:leading-[0.75rem] whitespace-pre">
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
            <div className="text-xs sm:text-sm tracking-[0.3em] mt-3 md:mt-5 uppercase">
              <div className="mb-1">═══════════════════════════════════</div>
              <div>Est. 2025</div>
              <div className="mt-1">═══════════════════════════════════</div>
            </div>
          </div>

          <div className="px-2 md:px-4">
            <div className="text-center mb-6 md:mb-8 border-t-2 border-b-2 border-black py-3">
              <p className="text-xs sm:text-sm tracking-[0.2em] uppercase font-bold">═ Premium Cuts & Fine Dining ═</p>
            </div>

            <div className="space-y-3 md:space-y-4">
              {menuItems.map((item, index) => (
                <div key={index} className="flex items-baseline text-sm md:text-base">
                  <span className="flex-shrink-0">{item.name}</span>
                  <span className="flex-grow mx-2 border-b border-dotted border-black/30 mb-1"></span>
                  <span className="flex-shrink-0 font-bold tracking-wider">{item.price}</span>
                </div>
              ))}
            </div>

            <div className="mt-8 md:mt-10 text-center text-xs md:text-sm border-t-2 border-black pt-4">
              <p className="tracking-wide">All steaks served with choice of two sides</p>
              <p className="mt-3 tracking-wider">* Prices subject to market availability *</p>
            </div>
          </div>
        </div>

        <div className="text-center mt-6 md:mt-8 text-xs tracking-[0.25em] uppercase">
          <p>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</p>
          <p className="my-2">Open Daily 5-11PM</p>
          <p>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</p>
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
