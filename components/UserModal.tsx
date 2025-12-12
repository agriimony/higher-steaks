'use client';

import { useEffect, useState } from 'react';

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
  }, [userFid]);

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
        className="bg-[#fefdfb] border-2 border-black rounded-none p-6 max-w-2xl w-full relative font-mono shadow-2xl max-h-[90vh] overflow-y-auto"
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

        <h2 className="text-xl font-bold mb-6 text-black border-b-2 border-black pb-2">
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
            <div className="mb-8 pb-6 border-b-2 border-black">
              <h3 className="text-lg font-bold mb-4 text-black">
                Network Stats
              </h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-black/70">Total HIGHER Staked</span>
                  <div className="flex items-center gap-2">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-4 h-4 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-sm font-bold text-black">
                      {networkStats ? formatTokenAmount(networkStats.totalHigherStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pl-4">
                  <span className="text-xs text-black/60">Caster Stakes</span>
                  <div className="flex items-center gap-2">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-3 h-3 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {networkStats ? formatTokenAmount(networkStats.totalCasterStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pl-4">
                  <span className="text-xs text-black/60">Supporter Stakes</span>
                  <div className="flex items-center gap-2">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-3 h-3 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {networkStats ? formatTokenAmount(networkStats.totalSupporterStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-black/20">
                  <span className="text-sm text-black/70">Total Casts with Active Stakes</span>
                  <span className="text-sm font-bold text-black">
                    {networkStats?.totalCastsStakedOn ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* User Stats Section */}
            <div>
              <h3 className="text-lg font-bold mb-4 text-black">
                Your Stats
              </h3>
              
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-black/70">Total HIGHER Staked</span>
                  <div className="flex items-center gap-2">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-4 h-4 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-sm font-bold text-black">
                      {userStats ? formatTokenAmount(userStats.totalUserStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pl-4">
                  <span className="text-xs text-black/60">Caster Stakes</span>
                  <div className="flex items-center gap-2">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-3 h-3 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {userStats ? formatTokenAmount(userStats.totalCasterStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pl-4">
                  <span className="text-xs text-black/60">Supporter Stakes</span>
                  <div className="flex items-center gap-2">
                    <img 
                      src="/higher-logo.png" 
                      alt="HIGHER" 
                      className="w-3 h-3 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs font-bold text-black">
                      {userStats ? formatTokenAmount(userStats.totalSupporterStaked) : '0.00'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-black/20">
                  <span className="text-sm text-black/70">Higher Builders Supported</span>
                  <span className="text-sm font-bold text-black">
                    {userStats?.totalBuildersSupported ?? 0}
                  </span>
                </div>
              </div>

              {/* Top Supported FIDs */}
              {userStats && userStats.topSupportedFids.length > 0 && (
                <div className="mt-6 pt-6 border-t border-black/20">
                  <h4 className="text-sm font-bold mb-3 text-black">
                    Top Supported Builders
                  </h4>
                  <div className="space-y-2">
                    {userStats.topSupportedFids.map((builder) => (
                      <a
                        key={builder.fid}
                        href={`https://farcaster.xyz/${builder.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-2 hover:bg-gray-50 transition-colors rounded"
                      >
                        {builder.pfpUrl && (
                          <img 
                            src={builder.pfpUrl} 
                            alt={builder.username}
                            className="w-8 h-8 rounded-full border border-black/20"
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
                            className="w-3 h-3 rounded-full"
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}

