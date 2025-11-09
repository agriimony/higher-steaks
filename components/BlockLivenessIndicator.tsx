'use client';

import { useEffect, useMemo, useState } from 'react';

interface BlockLivenessIndicatorProps {
  blockNumber?: string | number | bigint | null;
  blockTimestamp?: number | null;
  className?: string;
}

type BlockStatus = 'fresh' | 'stale' | 'very_stale' | 'unknown';

function getStatus(ageSeconds: number | null): BlockStatus {
  if (ageSeconds === null || Number.isNaN(ageSeconds)) {
    return 'unknown';
  }
  if (ageSeconds < 5 * 60) return 'fresh';
  if (ageSeconds < 30 * 60) return 'stale';
  return 'very_stale';
}

function formatAge(ageSeconds: number | null): string {
  if (ageSeconds === null || Number.isNaN(ageSeconds)) {
    return 'Unknown';
  }
  if (ageSeconds < 60) return `${ageSeconds}s`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h`;
  return `${Math.floor(ageSeconds / 86400)}d`;
}

export function BlockLivenessIndicator({
  blockNumber,
  blockTimestamp,
  className = '',
}: BlockLivenessIndicatorProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const ageSeconds = useMemo(() => {
    if (!blockTimestamp && blockTimestamp !== 0) {
      return null;
    }
    return Math.max(0, now - blockTimestamp);
  }, [blockTimestamp, now]);

  const status = getStatus(ageSeconds);

  const color = (() => {
    switch (status) {
      case 'fresh':
        return 'bg-green-500';
      case 'stale':
        return 'bg-yellow-500';
      case 'very_stale':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  })();

  const tooltip =
    status === 'unknown'
      ? 'Awaiting block data'
      : `Block #${blockNumber ?? 'unknown'} (${formatAge(ageSeconds)} old)`;

  return (
    <>
      <style>{`
        @keyframes slow-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .slow-pulse {
          animation: slow-pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
      <div
        className={`w-2 h-2 rounded-full transition-colors duration-300 ${color} ${
          status === 'unknown'
            ? ''
            : 'slow-pulse'
        } ${className}`}
        title={tooltip}
      />
    </>
  );
}
