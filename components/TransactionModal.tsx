'use client';

import { useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

type TransactionModalVariant = 'failure' | 'lock-success' | 'unlock-success';

interface TransactionModalProps {
  variant: TransactionModalVariant;
  onClose: () => void;
  errorMessage?: string;
  txHash?: string;
  castHash?: string;
}

const MODAL_TITLE: Record<TransactionModalVariant, string> = {
  failure: 'Transaction Failed',
  'lock-success': 'Stake Confirmed',
  'unlock-success': 'Unstake Confirmed',
};

export function TransactionModal({
  variant,
  onClose,
  errorMessage,
  txHash,
  castHash,
}: TransactionModalProps) {
  const [isSignaling, setIsSignaling] = useState(false);
  const [signalError, setSignalError] = useState<string | null>(null);

  const handleOverlayClick = () => {
    if (!isSignaling) {
      onClose();
    }
  };

  const handleSignal = async () => {
    if (!castHash) return;

    setIsSignaling(true);
    setSignalError(null);

    try {
      const basescanLink = txHash ? `\nhttps://basescan.org/tx/${txHash}` : '';
      await sdk.actions.composeCast({
        text: `🥩${basescanLink}`,
        parent: {
          type: 'cast',
          hash: castHash,
        },
      });
      onClose();
    } catch (error: any) {
      const message =
        error?.message || 'Unable to open compose cast. Please try again.';
      setSignalError(message);
    } finally {
      setIsSignaling(false);
    }
  };

  const renderContent = () => {
    switch (variant) {
      case 'failure':
        return (
          <>
            <p className="text-xs text-red-700 font-mono whitespace-pre-wrap">
              {errorMessage || 'Something went wrong with your transaction.'}
            </p>
          </>
        );
      case 'lock-success':
        return (
          <>
            <p className="text-sm text-black font-mono">
              Your stake is locked in. Nice work.
            </p>
            <p className="text-xs text-gray-500 font-mono">
              Cooking takes time. Check back in a bit!
            </p>
            {txHash && (
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs font-mono text-purple-600 underline hover:text-purple-700"
              >
                View on Basescan
              </a>
            )}
            {signalError && (
              <div className="mt-3 text-xs text-red-600 font-mono">
                {signalError}
              </div>
            )}
          </>
        );
      case 'unlock-success':
        return (
          <>
            <p className="text-sm text-black font-mono">
              Unlock confirmed. Funds are back in your wallet.
            </p>
            {txHash && (
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs font-mono text-purple-600 underline hover:text-purple-700"
              >
                View on Basescan
              </a>
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      <div
        className="bg-[#fefdfb] border-2 border-black max-w-md w-full p-6 relative font-mono shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        style={{
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 10px 25px rgba(0, 0, 0, 0.3)',
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-black/40 hover:text-black transition"
          aria-label="Close"
          disabled={isSignaling}
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

        <div className="mb-4 border-b-2 border-black pb-3">
          <h2 className="text-lg font-bold text-black">{MODAL_TITLE[variant]}</h2>
        </div>

        <div className="space-y-3">{renderContent()}</div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white text-black font-bold border-2 border-black hover:bg-black hover:text-white transition text-sm"
            disabled={isSignaling}
          >
            OK
          </button>

          {variant === 'lock-success' && castHash && (
            <button
              onClick={handleSignal}
              className="px-4 py-2 bg-black text-white font-bold border-2 border-black hover:bg-white hover:text-black transition text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={isSignaling}
            >
              {isSignaling ? 'Opening…' : 'Signal'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

