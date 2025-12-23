'use client';

import { useEffect, useState } from 'react';

interface NetworkModalProps {
  onClose: () => void;
}

interface NetworkStats {
  totalHigherStaked: string;
  totalCasterStaked: string;
  totalSupporterStaked: string;
  totalCastsStakedOn: number;
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

export function NetworkModal({ onClose }: NetworkModalProps) {
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch('/api/network/stats');
        
        if (!response.ok) {
          throw new Error('Failed to fetch network stats');
        }

        const networkData = await response.json();
        setNetworkStats(networkData);
      } catch (err: any) {
        console.error('[NetworkModal] Error fetching stats:', err);
        setError(err?.message || 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

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
          Higher Network Stats
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
        )}
      </div>
    </div>
  );
}

