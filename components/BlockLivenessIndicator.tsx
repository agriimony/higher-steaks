'use client';

import { useEffect, useState } from 'react';

interface BlockLiveness {
  blockNumber: string;
  timestamp: number;
  ageSeconds: number;
  status: 'fresh' | 'stale' | 'very_stale';
}

export function BlockLivenessIndicator() {
  const [liveness, setLiveness] = useState<BlockLiveness | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLiveness = async () => {
    try {
      const response = await fetch('/api/block/liveness');
      if (response.ok) {
        const data = await response.json();
        setLiveness(data);
        setError(null);
      } else {
        setError('Failed to fetch');
      }
    } catch (err) {
      setError('Network error');
    }
  };

  useEffect(() => {
    // Fetch immediately
    fetchLiveness();

    // Then fetch every 30 seconds
    const interval = setInterval(fetchLiveness, 30000);

    return () => clearInterval(interval);
  }, []);

  // Determine circle color based on status
  const getColor = () => {
    if (!liveness) return 'bg-gray-400';
    switch (liveness.status) {
      case 'fresh':
        return 'bg-green-500';
      case 'stale':
        return 'bg-yellow-500';
      case 'very_stale':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  // Format age for tooltip
  const formatAge = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  return (
    <>
      <style>{`
        @keyframes slow-pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
        .slow-pulse {
          animation: slow-pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
      <div
        className={`w-2 h-2 rounded-full ${getColor()} transition-colors duration-300 ${
          liveness?.status === 'fresh' 
            ? 'slow-pulse shadow-lg shadow-green-500/50' 
            : liveness?.status === 'stale'
            ? 'slow-pulse shadow-lg shadow-yellow-500/50'
            : liveness?.status === 'very_stale'
            ? 'slow-pulse shadow-lg shadow-red-500/50'
            : ''
        }`}
        title={
          error
            ? 'Error fetching block status'
            : liveness
            ? `Block #${liveness.blockNumber} (${formatAge(liveness.ageSeconds)} old)`
            : 'Loading...'
        }
      />
    </>
  );
}
