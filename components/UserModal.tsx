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
  const [notificationThreshold, setNotificationThreshold] = useState<number>(10);
  const [miniappAdded, setMiniappAdded] = useState<boolean | null>(null);
  const [updatingThreshold, setUpdatingThreshold] = useState(false);
  const [isOptimistic, setIsOptimistic] = useState(false);

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
    checkMiniappAdded();
  }, [userFid]);

  // Check if miniapp is added via SDK context (client-side only)
  const checkMiniappAdded = async () => {
    try {
      const context = await sdk.context;
      setMiniappAdded(context?.client?.added || false);
    } catch (err) {
      console.error('[UserModal] Error checking miniapp added status:', err);
      setMiniappAdded(false);
    }
  };

  const fetchNotificationStatus = async () => {
    try {
      // Query our API endpoint which checks our database
      const response = await fetch(`/api/user/notifications/status?fid=${userFid}`);
      if (response.ok) {
        const data = await response.json();
        // Only update if we're not in an optimistic state, or if database confirms enabled
        // This prevents reverting optimistic state while waiting for webhook
        if (!isOptimistic || data.enabled === true) {
          setNotificationsEnabled(data.enabled || false);
          if (data.enabled && data.threshold !== undefined) {
            setNotificationThreshold(data.threshold);
          }
          // If database confirms enabled, clear optimistic flag
          if (data.enabled === true) {
            setIsOptimistic(false);
          }
        }
      }
    } catch (err) {
      console.error('[UserModal] Error fetching notification status:', err);
      // Only set to false if not optimistic
      if (!isOptimistic) {
        setNotificationsEnabled(false);
      }
    }
  };

  const handleAddMiniApp = async (e?: React.MouseEvent) => {
    // Prevent any default behavior or event bubbling
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    console.log('[UserModal] Add Mini App clicked');
    
    // Check if SDK is available
    if (!sdk || !sdk.actions) {
      console.error('[UserModal] SDK not available');
      return;
    }
    
    setUpdatingThreshold(true);
    
    // Optimistically set both states immediately when button is pressed
    // This ensures the UI updates right away, even before the SDK call completes
    setMiniappAdded(true);
    setNotificationsEnabled(true);
    setIsOptimistic(true);
    
    try {
      console.log('[UserModal] Calling sdk.actions.addMiniApp()...');
      const result = await sdk.actions.addMiniApp();
      console.log('[UserModal] addMiniApp result:', result);
      
      if (result && 'added' in result && result.added) {
        console.log('[UserModal] Mini app added, waiting for webhook confirmation...');
        
        // Wait for webhook to process (database update might be delayed)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Refresh miniapp added status from context
        await checkMiniappAdded();
        
        // Retry fetching notification status a few times in case webhook is delayed
        // Keep optimistic state until we get confirmation
        let retries = 5;
        let confirmed = false;
        while (retries > 0 && !confirmed) {
          console.log('[UserModal] Checking notification status, attempt', 6 - retries);
          const response = await fetch(`/api/user/notifications/status?fid=${userFid}`);
          if (response.ok) {
            const data = await response.json();
            console.log('[UserModal] Status response:', data);
            if (data.enabled === true) {
              // Database confirmed notifications are enabled
              setNotificationsEnabled(true);
              setIsOptimistic(false); // Clear optimistic flag since we have confirmation
              if (data.threshold !== undefined) {
                setNotificationThreshold(data.threshold);
              }
              confirmed = true;
              break;
            }
            // If database says disabled, keep optimistic state and retry
            // (webhook might still be processing)
          } else {
            console.warn('[UserModal] Status fetch failed with status', response.status);
          }
          // Wait before retrying
          if (retries > 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          retries--;
        }
        
        // If we never got confirmation after retries, keep the optimistic state
        // The webhook will eventually update, and the next time the modal opens
        // it will show the correct state
        if (!confirmed) {
          console.log('[UserModal] Did not get DB confirmation, keeping optimistic state');
        }
      } else if (result && 'added' in result && !result.added) {
        // User rejected or failed to add - revert optimistic state
        console.log('[UserModal] addMiniApp returned added: false', result);
        setMiniappAdded(false);
        setNotificationsEnabled(false);
        setIsOptimistic(false);
      } else {
        // Unexpected result format - refresh state to be safe
        console.warn('[UserModal] Unexpected addMiniApp result format:', result);
        await checkMiniappAdded();
        // Don't call fetchNotificationStatus here as it might revert optimistic state
        // Instead, keep optimistic state and let it sync naturally
      }
    } catch (err: any) {
      // Revert optimistic state on error
      setMiniappAdded(false);
      setNotificationsEnabled(false);
      setIsOptimistic(false);
      
      // Only log actual errors (not user cancellations)
      const errorMessage = String(err?.message || '').toLowerCase();
      const errorName = String(err?.name || '').toLowerCase();
      
      const isUserCancellation = 
        errorMessage.includes('user cancelled') ||
        errorMessage.includes('user rejected') ||
        errorMessage.includes('rejected by user') ||
        errorName === 'usercancellederror' ||
        errorName === 'userrejectederror';
      
      if (isUserCancellation) {
        console.log('[UserModal] User cancelled addMiniApp');
      } else {
        console.error('[UserModal] Error adding miniapp:', err);
      }
    } finally {
      setUpdatingThreshold(false);
      console.log('[UserModal] addMiniApp flow complete');
    }
  };

  const handleThresholdUpdate = async (newThreshold: number) => {
    if (newThreshold <= 0 || isNaN(newThreshold)) {
      return;
    }

    setUpdatingThreshold(true);
    try {
      const response = await fetch('/api/user/notifications/threshold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fid: userFid,
          threshold: newThreshold,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setNotificationThreshold(data.threshold);
      } else {
        const error = await response.json();
        console.error('[UserModal] Failed to update threshold:', error);
      }
    } catch (err) {
      console.error('[UserModal] Error updating threshold:', err);
    } finally {
      setUpdatingThreshold(false);
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

              {/* Notifications Section */}
              <div className="mt-3 pt-3 border-t border-black/20">
                {miniappAdded === null ? (
                  <div className="text-xs text-black/40">Loading...</div>
                ) : !miniappAdded ? (
                  // State 1: Miniapp not added
                  <div>
                    <p className="text-xs text-black/60 mb-2">
                      Get notified on stake expiry and new support
                    </p>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleAddMiniApp(e);
                      }}
                      disabled={updatingThreshold}
                      className="w-full bg-purple-600 text-white text-xs font-bold py-2 px-4 hover:bg-black/80 transition rounded disabled:bg-gray-400 disabled:cursor-not-allowed"
                      type="button"
                    >
                      {updatingThreshold ? 'Adding...' : 'Add Mini App & Enable Notifications'}
                    </button>
                  </div>
                ) : notificationsEnabled ? (
                  // State 2: Miniapp added + notifications enabled
                  <div>
                    <label className="text-xs font-bold text-black mb-1 block">
                      Notification Threshold (USD)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={notificationThreshold}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value);
                          if (!isNaN(value) && value >= 0) {
                            setNotificationThreshold(value);
                          }
                        }}
                        onBlur={(e) => {
                          const value = parseFloat(e.target.value);
                          if (!isNaN(value) && value > 0) {
                            handleThresholdUpdate(value);
                          } else {
                            setNotificationThreshold(10);
                          }
                        }}
                        disabled={updatingThreshold}
                        className="flex-1 border border-black/20 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black/20 disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder="10.00"
                      />
                      {updatingThreshold && (
                        <span className="text-xs text-black/40">Saving...</span>
                      )}
                    </div>
                    <p className="text-xs text-black/60 mt-1">
                      Get notified when new support is added
                    </p>
                  </div>
                ) : (
                  // State 3: Miniapp added + notifications disabled
                  <div>
                    <label className="text-xs font-bold text-black mb-1 block">
                      Notifications Disabled
                    </label>
                    <input
                      type="text"
                      value="N.A."
                      disabled
                      className="w-full border border-black/10 rounded px-2 py-1 text-xs font-mono bg-gray-100 text-gray-500 cursor-not-allowed"
                    />
                    <p className="text-xs text-black/60 mt-1 italic">
                      Please re-enable notifications in client
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  );
}

