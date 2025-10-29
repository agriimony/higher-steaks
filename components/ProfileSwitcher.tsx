'use client';

import { useState, useRef, useEffect } from 'react';

export interface SimulatedProfile {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  walletBalance: string; // formatted, e.g. "500.00"
  stakedBalance: string; // formatted, e.g. "1000.00"
  isOnLeaderboard: boolean;
  description: string;
}

export const SIMULATED_PROFILES: SimulatedProfile[] = [
  {
    fid: 999001,
    username: "test-staker",
    displayName: "Test Staker",
    pfpUrl: "https://i.imgur.com/placeholder1.png",
    walletBalance: "200.00",
    stakedBalance: "800.00", // Has staked but not on leaderboard (no cast)
    isOnLeaderboard: false,
    description: "State 1: Staked but no qualifying cast"
  },
  {
    fid: 999002,
    username: "test-holder",
    displayName: "Test Holder",
    pfpUrl: "https://i.imgur.com/placeholder2.png",
    walletBalance: "1500.00",
    stakedBalance: "0.00", // Has enough to stake but hasn't
    isOnLeaderboard: false,
    description: "State 2a: Has enough HIGHER but not staked"
  },
  {
    fid: 999003,
    username: "test-newbie",
    displayName: "Test Newbie",
    pfpUrl: "https://i.imgur.com/placeholder3.png",
    walletBalance: "0.00",
    stakedBalance: "0.00", // Needs HIGHER
    isOnLeaderboard: false,
    description: "State 2b: Needs more HIGHER to compete"
  }
];

interface ProfileSwitcherProps {
  currentProfile: SimulatedProfile | null;
  onProfileChange: (profile: SimulatedProfile) => void;
  isDevelopmentMode: boolean;
}

export function ProfileSwitcher({ currentProfile, onProfileChange, isDevelopmentMode }: ProfileSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Only show in development mode
  if (!isDevelopmentMode) {
    return null;
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gradient-to-r from-green-50 to-teal-50 border border-green-200 rounded-full px-3 py-1.5 shadow-sm hover:shadow-md transition flex items-center gap-1.5"
      >
        {currentProfile ? (
          <>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-xs font-bold">
              {currentProfile.username.substring(0, 2).toUpperCase()}
            </div>
            <span className="text-[0.65rem] sm:text-xs font-medium text-gray-800">
              @{currentProfile.username}
            </span>
            <svg 
              className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        ) : (
          <span className="text-[0.65rem] sm:text-xs text-gray-600">Select Test Profile</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 bg-white border border-zinc-300 rounded-lg shadow-lg z-50 min-w-[280px] overflow-hidden">
          <div className="bg-zinc-100 px-3 py-2 border-b border-zinc-300">
            <p className="text-xs font-bold text-zinc-700">🧪 Test Profiles</p>
            <p className="text-[0.6rem] text-zinc-500">Switch to test modal states</p>
          </div>
          
          {SIMULATED_PROFILES.map((profile) => (
            <button
              key={profile.fid}
              onClick={() => {
                onProfileChange(profile);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2.5 hover:bg-zinc-50 transition border-b border-zinc-100 last:border-b-0 ${
                currentProfile?.fid === profile.fid ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {profile.username.substring(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-zinc-800">@{profile.username}</p>
                  <p className="text-[0.6rem] text-zinc-600 truncate">{profile.description}</p>
                  <div className="mt-1 flex gap-2 text-[0.55rem] text-zinc-500">
                    <span>💰 {profile.walletBalance}</span>
                    <span>🔒 {profile.stakedBalance}</span>
                  </div>
                </div>
                {currentProfile?.fid === profile.fid && (
                  <div className="text-blue-500">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

