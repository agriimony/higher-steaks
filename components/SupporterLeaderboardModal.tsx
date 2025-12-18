'use client';

import { useEffect, useState } from 'react';

interface SupporterLeaderboardModalProps {
  castHash: string;
  userFid: number | null;
  onClose: () => void;
}

interface CasterInfo {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  weightedStake: number;
}

interface SupporterEntry {
  fid: number;
  username: string;
  displayName: string;
  pfp: string;
  weightedStake: number;
  rank: number;
}

interface LeaderboardData {
  caster: CasterInfo;
  supporters: SupporterEntry[];
  totalPages: number;
  currentPage: number;
  totalSupporters: number;
}

export function SupporterLeaderboardModal({
  castHash,
  userFid,
  onClose,
}: SupporterLeaderboardModalProps) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const url = `/api/cast/${encodeURIComponent(castHash)}/leaderboard?page=${currentPage}${userFid ? `&userFid=${userFid}` : ''}`;
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error('Failed to fetch leaderboard');
        }
        
        const leaderboardData = await response.json();
        setData(leaderboardData);
      } catch (err: any) {
        console.error('[SupporterLeaderboardModal] Error fetching leaderboard:', err);
        setError(err?.message || 'Failed to load leaderboard');
      } finally {
        setLoading(false);
      }
    };

    if (castHash) {
      fetchLeaderboard();
    }
  }, [castHash, currentPage, userFid]);

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

  const handlePreviousPage = () => {
    if (data && currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (data && currentPage < data.totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // Format weighted stake with 2 decimal places
  const formatWeightedStake = (stake: number): string => {
    return stake.toFixed(2);
  };

  if (loading) {
    return (
      <div 
        className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <div 
          className="bg-[#fefdfb] border-2 border-black rounded-none p-6 max-w-2xl w-full relative font-mono"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center text-black">Loading leaderboard...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div 
        className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <div 
          className="bg-[#fefdfb] border-2 border-black rounded-none p-6 max-w-2xl w-full relative font-mono"
          onClick={(e) => e.stopPropagation()}
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
          <div className="text-center text-red-600">
            {error || 'Failed to load leaderboard'}
          </div>
        </div>
      </div>
    );
  }

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

        {/* Top Section: Caster Info + Weighted Stake */}
        <div className="flex items-center justify-between mb-4 pb-4 border-b-2 border-black gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {data.caster.pfpUrl && (
              <a 
                href={`https://farcaster.xyz/${data.caster.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:opacity-80 transition-opacity flex-shrink-0"
              >
                <img 
                  src={data.caster.pfpUrl} 
                  alt={data.caster.username}
                  className="w-12 h-12 rounded-full border border-black/20"
                />
              </a>
            )}
            <div className="min-w-0 flex-1">
              <a 
                href={`https://farcaster.xyz/${data.caster.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-black hover:text-purple-700 transition-colors block truncate"
                title={`@${data.caster.username}`}
              >
                @{data.caster.username}
              </a>
              {data.caster.displayName && data.caster.displayName !== data.caster.username && (
                <div className="text-xs text-black/60 truncate">{data.caster.displayName}</div>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-xs text-black/60 mb-1">Cumulative Weighted Stake</div>
            <div className="font-bold text-black">
              {formatWeightedStake(data.caster.weightedStake)} higher-days
            </div>
          </div>
        </div>

        {/* Middle Section: Supporter Leaderboard */}
        <div className="mb-4">
          
          {data.supporters.length === 0 ? (
            <div className="text-center text-black/60 py-8">
              No supporters yet
            </div>
          ) : (
            <div className="space-y-2">
              {data.supporters.map((supporter) => {
                const isConnectedUser = userFid !== null && supporter.fid === userFid;
                return (
                  <div
                    key={supporter.fid}
                    className={`flex items-center gap-3 p-2 rounded border ${
                      isConnectedUser 
                        ? 'bg-purple-50 border-purple-300' 
                        : 'border-black/20'
                    }`}
                  >
                    <div className="text-xs font-bold text-black/60 w-4 text-right">
                      #{supporter.rank}
                    </div>
                    <img 
                      src={supporter.pfp || ''} 
                      alt={supporter.username}
                      className="w-8 h-8 rounded-full border border-black/20 flex-shrink-0"
                    />
                    <div className="text-s flex-1 min-w-0">
                      <a
                        href={`https://farcaster.xyz/${supporter.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`font-bold hover:text-purple-700 transition-colors block truncate ${
                          isConnectedUser ? 'text-purple-700' : 'text-black'
                        }`}
                        title={`@${supporter.username}`}
                      >
                        @{supporter.username}
                      </a>
                      {supporter.displayName && supporter.displayName !== supporter.username && (
                        <div className="text-xs text-black/60 truncate">{supporter.displayName}</div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-bold text-black">
                        {formatWeightedStake(supporter.weightedStake)} higher-days
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Section: Pagination Controls */}
        {data.totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-black/20">
            <button
              onClick={handlePreviousPage}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-white text-black font-bold border-2 border-black hover:bg-black hover:text-white transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <div className="text-sm text-black font-bold">
              Page {currentPage} of {data.totalPages}
            </div>
            <button
              onClick={handleNextPage}
              disabled={currentPage >= data.totalPages}
              className="px-4 py-2 bg-white text-black font-bold border-2 border-black hover:bg-black hover:text-white transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

