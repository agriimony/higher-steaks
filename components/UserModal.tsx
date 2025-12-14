'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

interface UserModalProps {
  onClose: () => void;
  userFid: number;
}

interface NetworkStats {
  totalHigherStaked: string;
  totalCasterStaked: string;
  totalSupporterStaked: string;
  totalCastsStakedOn: number;
}

interface UserStats {
  totalUserStaked: string;
  totalCasterStaked: string;
  totalSupporterStaked: string;
  totalBuildersSupported: number;
  topSupportedFids: Array<{
    fid: number;
    username: string;
    displayName: string;
    pfpUrl: string;
    totalAmount: string;
  }>;
  totalStakedOnUserCasts?: string;
  totalCasterStakesOnUserCasts?: string;
  totalSupporterStakesOnUserCasts?: string;
  totalSupporters?: number;
}

// Format token amount with K/M/B suffixes
function formatTokenAmount(amount: string): string {
  const safe = (amount ?? '0').toString();
  const num = parseFloat(safe.replace(/,/g, ''));
  if (isNaN(num)) return safe;
  
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(2) + 'B';
  } else if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + 'M';
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + 'K';
  } else {
    return num.toFixed(2);
  }
}

export function UserModal({ onClose, userFid }: UserModalProps) {
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Fetch both stats in parallel
        const [networkResponse, userResponse] = await Promise.all([
          fetch('/api/network/stats'),
          fetch(`/api/user/stats?fid=${userFid}`),
        ]);

        if (!networkResponse.ok) {
          throw new Error('Failed to fetch network stats');
        }
        if (!userResponse.ok) {
          throw new Error('Failed to fetch user stats');
        }

        const networkData = await networkResponse.json();
        const userData = await userResponse.json();

        setNetworkStats(networkData);
        setUserStats(userData);
      } catch (err: any) {
        console.error('[UserModal] Error fetching stats:', err);
        setError(err?.message || 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    fetchNotificationStatus();
  }, [userFid]);

  const fetchNotificationStatus = async () => {
    try {
      const response = await fetch(`/api/user/notifications/status?fid=${userFid}`);
      if (response.ok) {
        const data = await response.json();
        setNotificationsEnabled(data.enabled || false);
      }
    } catch (err) {
      console.error('[UserModal] Error fetching notification status:', err);
      setNotificationsEnabled(false);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    setLoadingNotifications(true);
    try {
      if (enabled) {
        // Check if miniapp is added first
        try {
          await sdk.actions.addMiniApp();
          // After adding miniapp, wait a bit for webhook to process
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err: any) {
          // If user cancels or error, show prompt
          if (err?.message?.includes('cancelled') || err?.message?.includes('rejected')) {
            setShowNotificationPrompt(true);
            setLoadingNotifications(false);
            return;
          }
          console.error('[UserModal] Error adding miniapp:', err);
        }
      }

      // Update notification status
      const response = await fetch('/api/user/notifications/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid: userFid, enabled }),
      });

      if (response.ok) {
        setNotificationsEnabled(enabled);
        // Refresh status to get actual state from Neynar
        await fetchNotificationStatus();
      }
    } catch (err) {
      console.error('[UserModal] Error toggling notifications:', err);
    } finally {
      setLoadingNotifications(false);
    }
  };

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

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#fefdfb] border-2 border-black rounded-none p-4 max-w-2xl w-full relative font-mono shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={{
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 10px 25px rgba(0, 0, 0, 0.3)'
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-black/40 hover:text-black transition"
          aria-label="Close"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="18" 
            height="18" 
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

        <h2 className="text-lg font-bold mb-3 text-black border-b-2 border-black pb-1.5">
          Stats
        </h2>

        {loading ? (
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
        ) : error ? (
          <div className="text-center text-red-600 py-12">
            {error}
          </div>
        ) : (
          <>
            {/* Network Stats Section */}
            <div className="mb-4 pb-3 border-b-2 border-black">
              <h3 className="text-base font-bold mb-2 text-black">
                Network Stats
              </h3>
              
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-black/70">Total Belief in the Network</span>
                  <div className="flex items-center gap-1.5">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-3 h-3 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {networkStats ? formatTokenAmount(networkStats.totalHigherStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pl-3">
                  <span className="text-xs text-black/60">Belief in self</span>
                  <div className="flex items-center gap-1.5">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-2.5 h-2.5 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {networkStats ? formatTokenAmount(networkStats.totalCasterStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pl-3">
                  <span className="text-xs text-black/60">Belief in others</span>
                  <div className="flex items-center gap-1.5">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-2.5 h-2.5 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {networkStats ? formatTokenAmount(networkStats.totalSupporterStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-black/20">
                  <span className="text-xs text-black/70">Total Casts Cooking</span>
                  <span className="text-xs font-bold text-black">
                    {networkStats?.totalCastsStakedOn ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* User Stats Section */}
            <div>
              <h3 className="text-base font-bold mb-2 text-black">
                Your Stats
              </h3>
              
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-black/70">You have staked</span>
                  <div className="flex items-center gap-1.5">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-3 h-3 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {userStats ? formatTokenAmount(userStats.totalUserStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pl-3">
                  <span className="text-xs text-black/60">On yourself</span>
                  <div className="flex items-center gap-1.5">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-2.5 h-2.5 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {userStats ? formatTokenAmount(userStats.totalCasterStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pl-3">
                  <span className="text-xs text-black/60">On <span className="text-xs font-bold text-black">{userStats?.totalBuildersSupported ?? 0}</span> others</span>
                  <div className="flex items-center gap-1.5">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-2.5 h-2.5 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {userStats ? formatTokenAmount(userStats.totalSupporterStaked) : '0.00'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stakes on User's Casts Section */}
              <div className="mt-3 pt-3 border-t border-black/20">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-black/70">Staked on you</span>
                    <div className="flex items-center gap-1.5">
                      <img 
                        src="/higher-logo.png" 
                        alt="HIGHER" 
                        className="w-3 h-3 rounded-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <span className="text-xs font-bold text-black">
                        {userStats?.totalStakedOnUserCasts ? formatTokenAmount(userStats.totalStakedOnUserCasts) : '0.00'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pl-3">
                    <span className="text-xs text-black/60">By yourself</span>
                    <div className="flex items-center gap-1.5">
                      <img 
                        src="/higher-logo.png" 
                        alt="HIGHER" 
                        className="w-2.5 h-2.5 rounded-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <span className="text-xs font-bold text-black">
                        {userStats?.totalCasterStakesOnUserCasts ? formatTokenAmount(userStats.totalCasterStakesOnUserCasts) : '0.00'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pl-3">
                  <span className="text-xs text-black/60">By <span className="text-xs font-bold text-black">{userStats?.totalSupporters ?? 0}</span> others</span>
                    <div className="flex items-center gap-1.5">
                      <img 
                        src="/higher-logo.png" 
                        alt="HIGHER" 
                        className="w-2.5 h-2.5 rounded-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <span className="text-xs font-bold text-black">
                        {userStats?.totalSupporterStakesOnUserCasts ? formatTokenAmount(userStats.totalSupporterStakesOnUserCasts) : '0.00'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Supported FIDs */}
              {userStats && userStats.topSupportedFids.length > 0 && (
                <div className="mt-3 pt-3 border-t border-black/20">
                  <h4 className="text-xs font-bold mb-2 text-black">
                    Top Supported Builders
                  </h4>
                  <div className="space-y-1">
                    {userStats.topSupportedFids.map((builder) => (
                      <a
                        key={builder.fid}
                        href={`https://farcaster.xyz/${builder.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 p-1.5 hover:bg-gray-50 transition-colors rounded"
                      >
                        {builder.pfpUrl && (
                          <img 
                            src={builder.pfpUrl} 
                            alt={builder.username}
                            className="w-6 h-6 rounded-full border border-black/20"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-black truncate">
                            @{builder.username}
                          </div>
                          {builder.displayName && builder.displayName !== builder.username && (
                            <div className="text-xs text-black/60 truncate">
                              {builder.displayName}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <img 
                            src="/higher-logo.png" 
                            alt="HIGHER" 
                            className="w-2.5 h-2.5 rounded-full"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                          <span className="text-xs font-bold text-black">
                            {formatTokenAmount(builder.totalAmount)}
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Notifications Toggle */}
              <div className="mt-3 pt-3 border-t border-black/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-black">Notifications</span>
                    {notificationsEnabled === null ? (
                      <span className="text-xs text-black/40">Loading...</span>
                    ) : notificationsEnabled ? (
                      <span className="text-xs text-green-600">On</span>
                    ) : (
                      <span className="text-xs text-black/40">Off</span>
                    )}
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notificationsEnabled === true}
                      onChange={(e) => handleNotificationToggle(e.target.checked)}
                      disabled={loadingNotifications || notificationsEnabled === null}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-black/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black"></div>
                  </label>
                </div>
                <p className="text-xs text-black/60 mt-1">
                  Get notified when your stakes expire or supporters add stakes to your casts
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Notification Prompt Modal */}
      {showNotificationPrompt && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div 
            className="bg-[#fefdfb] border-2 border-black rounded-none p-4 max-w-md w-full relative font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowNotificationPrompt(false)}
              className="absolute top-2 right-2 text-black/40 hover:text-black transition"
              aria-label="Close"
            >
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                width="18" 
                height="18" 
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
            <h3 className="text-base font-bold mb-2 text-black">
              Add Mini App Required
            </h3>
            <p className="text-xs text-black/70 mb-4">
              To enable notifications, you need to add the Higher Steaks mini app to your Farcaster client first.
            </p>
            <button
              onClick={async () => {
                try {
                  await sdk.actions.addMiniApp();
                  setShowNotificationPrompt(false);
                  // Retry enabling notifications
                  await handleNotificationToggle(true);
                } catch (err) {
                  console.error('[UserModal] Error adding miniapp:', err);
                }
              }}
              className="w-full bg-black text-white text-xs font-bold py-2 px-4 hover:bg-black/80 transition"
            >
              Add Mini App
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

