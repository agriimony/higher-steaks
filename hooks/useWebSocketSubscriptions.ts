'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { keccak256, toHex } from 'viem';
import { LOCKUP_CONTRACT, LOCKUP_ABI, HIGHER_TOKEN_ADDRESS, ERC20_ABI } from '@/lib/contracts';

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
  unlockEvent: {
    lockUpId: string;
    token: string;
    receiver: string;
  } | null;
  transferEvent: {
    from: string;
    to: string;
    value: string;
  } | null;
  isConnected: boolean;
  error: string | null;
}

/**
 * React hook to manage Alchemy WebSocket subscriptions for real-time blockchain events
 * - Subscribes to new block headers (newHeads) for freshness monitoring
 * - Subscribes to LockUpCreated events from the lockup contract
 * - Subscribes to Unlock events from the lockup contract
 * - Subscribes to Transfer events from the HIGHER token contract
 */
export function useWebSocketSubscriptions(enabled: boolean = true): WebSocketSubscriptionState {
  const [state, setState] = useState<WebSocketSubscriptionState>({
    latestBlock: null,
    latestBlockAge: null,
    newLockupEvent: null,
    unlockEvent: null,
    transferEvent: null,
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

  // Get Unlock event topic from ABI
  const unlockTopic = useCallback(() => {
    try {
      // Find Unlock event in ABI
      const eventAbi = LOCKUP_ABI.find((item: any) => item.type === 'event' && item.name === 'Unlock');
      if (!eventAbi || eventAbi.type !== 'event') {
        console.error('Unlock event not found in ABI');
        return null;
      }

      // Generate keccak256 hash of event signature: Unlock(uint256,address,address)
      const signature = `${eventAbi.name}(${eventAbi.inputs.map((inp: any) => inp.internalType || inp.type).join(',')})`;
      const hash = keccak256(toHex(signature));
      console.log('[WebSocket] Unlock event signature:', signature);
      console.log('[WebSocket] Unlock topic:', hash);
      return hash;
    } catch (error) {
      console.error('[WebSocket] Error generating Unlock event topic:', error);
      return null;
    }
  }, []);

  // Get Transfer event topic from ERC20 ABI
  const transferTopic = useCallback(() => {
    try {
      // Find Transfer event in ABI
      const eventAbi = ERC20_ABI.find((item: any) => item.type === 'event' && item.name === 'Transfer');
      if (!eventAbi || eventAbi.type !== 'event') {
        console.error('Transfer event not found in ABI');
        return null;
      }

      // Generate keccak256 hash of event signature: Transfer(address,address,uint256)
      const signature = `${eventAbi.name}(${eventAbi.inputs.map((inp: any) => inp.internalType || inp.type).join(',')})`;
      const hash = keccak256(toHex(signature));
      console.log('[WebSocket] Transfer event signature:', signature);
      console.log('[WebSocket] Transfer topic:', hash);
      return hash;
    } catch (error) {
      console.error('[WebSocket] Error generating Transfer event topic:', error);
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
        const createdTopic = lockUpCreatedTopic();
        if (createdTopic) {
          const createLogsSub = {
            jsonrpc: '2.0',
            id: 2,
            method: 'eth_subscribe',
            params: [
              'logs',
              {
                address: LOCKUP_CONTRACT,
                topics: [createdTopic],
              },
            ],
          };
          ws.send(JSON.stringify(createLogsSub));
          console.log('[WebSocket] Subscribed to LockUpCreated events');
        } else {
          console.error('[WebSocket] Failed to subscribe to LockUpCreated events');
        }

        // Subscribe to logs for Unlock events
        const unlockEventTopic = unlockTopic();
        if (unlockEventTopic) {
          const unlockLogsSub = {
            jsonrpc: '2.0',
            id: 3,
            method: 'eth_subscribe',
            params: [
              'logs',
              {
                address: LOCKUP_CONTRACT,
                topics: [unlockEventTopic],
              },
            ],
          };
          ws.send(JSON.stringify(unlockLogsSub));
          console.log('[WebSocket] Subscribed to Unlock events');
        } else {
          console.error('[WebSocket] Failed to subscribe to Unlock events');
        }

        // Subscribe to logs for Transfer events
        const transferEventTopic = transferTopic();
        if (transferEventTopic) {
          const transferLogsSub = {
            jsonrpc: '2.0',
            id: 4,
            method: 'eth_subscribe',
            params: [
              'logs',
              {
                address: HIGHER_TOKEN_ADDRESS,
                topics: [transferEventTopic],
              },
            ],
          };
          ws.send(JSON.stringify(transferLogsSub));
          console.log('[WebSocket] Subscribed to Transfer events');
        } else {
          console.error('[WebSocket] Failed to subscribe to Transfer events');
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

            // Handle logs (events)
            if (result && result.topics && result.data) {
              const eventTopic = result.topics[0];
              const createdTopicHash = lockUpCreatedTopic();
              const unlockTopicHash = unlockTopic();
              const transferTopicHash = transferTopic();

              console.log('[WebSocket] Processing log event:', {
                eventTopic,
                subscription,
                address: result.address,
                blockNumber: result.blockNumber,
                transactionHash: result.transactionHash
              });

              // Handle LockUpCreated events
              if (createdTopicHash && eventTopic === createdTopicHash) {
                console.log('[WebSocket] LockUpCreated event detected:', result);

                // Decode event data (simplified - topics[0] is event signature, topics[1-3] are indexed params)
                // For now, just extract what we can from the log
                const lockUpId = result.topics[1] || '0x0';
                const token = result.topics[2] ? `0x${result.topics[2].substring(26)}` : '0x0';
                const receiver = result.topics[3] ? `0x${result.topics[3].substring(26)}` : '0x0';

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

              // Handle Unlock events
              if (unlockTopicHash && eventTopic === unlockTopicHash) {
                console.log('[WebSocket] Unlock event detected (raw):', result);

                // Decode event data (simplified - topics[0] is event signature, topics[1-3] are indexed params)
                const lockUpId = result.topics[1] || '0x0';
                const token = result.topics[2] ? `0x${result.topics[2].substring(26)}` : '0x0';
                const receiver = result.topics[3] ? `0x${result.topics[3].substring(26)}` : '0x0';

                console.log('[WebSocket] Unlock decoded:', { 
                  lockUpId, 
                  token, 
                  receiver,
                  rawTopics: result.topics 
                });

                setState(prev => ({
                  ...prev,
                  unlockEvent: {
                    lockUpId,
                    token,
                    receiver,
                  },
                }));

                console.log('[WebSocket] Unlock state updated:', { lockUpId, receiver });
              }

              // Handle Transfer events
              if (transferTopicHash && eventTopic === transferTopicHash) {
                console.log('[WebSocket] Transfer event detected:', result);

                // Decode event data: Transfer(address indexed from, address indexed to, uint256 value)
                const from = result.topics[1] ? `0x${result.topics[1].substring(26)}` : '0x0';
                const to = result.topics[2] ? `0x${result.topics[2].substring(26)}` : '0x0';
                const value = result.data || '0x0';

                setState(prev => ({
                  ...prev,
                  transferEvent: {
                    from,
                    to,
                    value,
                  },
                }));

                console.log('[WebSocket] Transfer:', { from, to });
              }
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
  }, [enabled, lockUpCreatedTopic, unlockTopic, transferTopic]);

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
