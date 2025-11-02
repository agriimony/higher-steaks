'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { keccak256, toHex } from 'viem';
import { LOCKUP_CONTRACT, LOCKUP_ABI } from '@/lib/contracts';

interface WebSocketSubscriptionState {
  latestBlock: { number: bigint; timestamp: bigint } | null;
  latestBlockAge: number | null; // seconds
  newLockupEvent: {
    lockUpId: string;
    token: string;
    receiver: string;
    amount: string;
    unlockTime: string;
    title: string;
  } | null;
  isConnected: boolean;
  error: string | null;
}

/**
 * React hook to manage Alchemy WebSocket subscriptions for real-time blockchain events
 * - Subscribes to new block headers (newHeads) for freshness monitoring
 * - Subscribes to LockUpCreated events from the lockup contract
 */
export function useWebSocketSubscriptions(enabled: boolean = true): WebSocketSubscriptionState {
  const [state, setState] = useState<WebSocketSubscriptionState>({
    latestBlock: null,
    latestBlockAge: null,
    newLockupEvent: null,
    isConnected: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isMountedRef = useRef(true);

  // Get event topic from ABI
  const lockUpCreatedTopic = useCallback(() => {
    try {
      // Find LockUpCreated event in ABI
      const eventAbi = LOCKUP_ABI.find((item: any) => item.type === 'event' && item.name === 'LockUpCreated');
      if (!eventAbi || eventAbi.type !== 'event') {
        console.error('LockUpCreated event not found in ABI');
        return null;
      }

      // Generate keccak256 hash of event signature: LockUpCreated(uint256,address,address,uint256,uint40,string)
      const signature = `${eventAbi.name}(${eventAbi.inputs.map((inp: any) => inp.internalType || inp.type).join(',')})`;
      const hash = keccak256(toHex(signature));
      console.log('[WebSocket] LockUpCreated event signature:', signature);
      console.log('[WebSocket] LockUpCreated topic:', hash);
      return hash;
    } catch (error) {
      console.error('[WebSocket] Error generating event topic:', error);
      return null;
    }
  }, []);

  // WebSocket connection and management
  const connect = useCallback(() => {
    if (!enabled) {
      console.log('[WebSocket] Subscriptions disabled');
      return;
    }

    const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (!alchemyApiKey) {
      console.log('[WebSocket] NEXT_PUBLIC_ALCHEMY_API_KEY not set, WebSocket disabled');
      setState(prev => ({ ...prev, error: 'Alchemy API key not configured' }));
      return;
    }

    // Clean up existing connection
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    try {
      const wsUrl = `wss://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`;
      console.log('[WebSocket] Connecting to:', wsUrl.replace(alchemyApiKey, '***'));
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        reconnectAttemptsRef.current = 0;
        setState(prev => ({ ...prev, isConnected: true, error: null }));

        // Subscribe to newHeads (new blocks)
        const newHeadsSub = {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_subscribe',
          params: ['newHeads'],
        };
        ws.send(JSON.stringify(newHeadsSub));

        // Subscribe to logs for LockUpCreated events
        const eventTopic = lockUpCreatedTopic();
        if (eventTopic) {
          const logsSub = {
            jsonrpc: '2.0',
            id: 2,
            method: 'eth_subscribe',
            params: [
              'logs',
              {
                address: LOCKUP_CONTRACT,
                topics: [eventTopic],
              },
            ],
          };
          ws.send(JSON.stringify(logsSub));
          console.log('[WebSocket] Subscribed to LockUpCreated events');
        } else {
          console.error('[WebSocket] Failed to subscribe to LockUpCreated events');
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WebSocket] Message received:', data.method);

          // Handle subscription notifications
          if (data.method === 'eth_subscription' && data.params) {
            const { subscription, result } = data.params;

            // Handle newHeads (block headers)
            if (result && result.number && result.timestamp) {
              const blockNumber = BigInt(result.number);
              const blockTimestamp = BigInt(result.timestamp);
              const currentTime = BigInt(Math.floor(Date.now() / 1000));
              const blockAge = Number(currentTime - blockTimestamp);

              setState(prev => ({
                ...prev,
                latestBlock: { number: blockNumber, timestamp: blockTimestamp },
                latestBlockAge: blockAge,
              }));

              console.log(`[WebSocket] New block #${blockNumber}, age: ${blockAge}s`);
            }

            // Handle logs (LockUpCreated events)
            if (result && result.topics && result.data) {
              console.log('[WebSocket] LockUpCreated event detected:', result);

              // Decode event data (simplified - topics[0] is event signature, topics[1-3] are indexed params)
              // For now, just extract what we can from the log
              const lockUpId = result.topics[1] || '0x0';
              const token = result.topics[2] || '0x0';
              const receiver = result.topics[3] || '0x0';

              // Note: amount, unlockTime, and title are in result.data as a hex string
              // Full decoding would require ABI decoding, but for detection purposes this is sufficient
              setState(prev => ({
                ...prev,
                newLockupEvent: {
                  lockUpId,
                  token,
                  receiver,
                  amount: '0x0', // Would need full decoding
                  unlockTime: '0x0',
                  title: '',
                },
              }));

              console.log('[WebSocket] LockUpCreated:', { lockUpId, receiver });
            }
          }

          // Handle subscription confirmations
          if (data.result && typeof data.result === 'string' && data.result.startsWith('0x')) {
            console.log(`[WebSocket] Subscription confirmed: ${data.result}`);
          }
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        setState(prev => ({ ...prev, error: 'WebSocket error occurred', isConnected: false }));
      };

      ws.onclose = () => {
        console.log('[WebSocket] Connection closed');
        setState(prev => ({ ...prev, isConnected: false }));

        // Attempt reconnection with exponential backoff
        if (isMountedRef.current && enabled) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 60000);
          reconnectAttemptsRef.current += 1;
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              connect();
            }
          }, delay);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      setState(prev => ({ ...prev, error: 'Failed to create WebSocket connection' }));
    }
  }, [enabled, lockUpCreatedTopic]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Connect when enabled changes
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      if (wsRef.current) {
        wsRef.current.close();
      }
    }
  }, [enabled, connect]);

  return state;
}
