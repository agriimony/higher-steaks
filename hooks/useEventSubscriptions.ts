'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

export interface EventSubscriptionState {
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
 * React hook to manage Server-Sent Events (SSE) subscriptions for real-time blockchain events
 * - Subscribes to LockUpCreated events from the lockup contract
 * - Subscribes to Unlock events from the lockup contract
 * - Subscribes to Transfer events from the HIGHER token contract
 */
export function useEventSubscriptions(enabled: boolean = true): EventSubscriptionState {
  const [state, setState] = useState<EventSubscriptionState>({
    newLockupEvent: null,
    unlockEvent: null,
    transferEvent: null,
    isConnected: false,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!enabled) {
      console.log('[SSE] Subscriptions disabled');
      return;
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      console.log('[SSE] Connecting to event stream...');
      const eventSource = new EventSource('/api/events/stream');
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[SSE] Connected');
        reconnectAttemptsRef.current = 0;
        setState(prev => ({ ...prev, isConnected: true, error: null }));
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle initial connection message
          if (data.type === 'connected') {
            console.log('[SSE] Connection established with clientId:', data.clientId);
            return;
          }

          // Handle event arrays from webhook broadcasts
          if (Array.isArray(data) && data.length > 0) {
            const latestEvent = data[data.length - 1];
            
            console.log('[SSE] Received event:', latestEvent.type);
            
            // Map event types to state properties
            switch (latestEvent.type) {
              case 'lockup_created':
                setState(prev => ({
                  ...prev,
                  newLockupEvent: latestEvent.data,
                }));
                break;
              
              case 'unlock':
                setState(prev => ({
                  ...prev,
                  unlockEvent: latestEvent.data,
                }));
                break;
              
              case 'transfer':
                setState(prev => ({
                  ...prev,
                  transferEvent: latestEvent.data,
                }));
                break;
              
              default:
                console.log('[SSE] Unknown event type:', latestEvent.type);
            }
          }
        } catch (error) {
          console.error('[SSE] Error parsing message:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('[SSE] Connection error:', error);
        setState(prev => ({ ...prev, isConnected: false, error: 'Connection error' }));
        
        // Clean up
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        
        // Implement exponential backoff reconnection
        const retryDelay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        
        console.log(`[SSE] Reconnecting in ${retryDelay}ms (attempt ${reconnectAttemptsRef.current})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, retryDelay);
      };

    } catch (error) {
      console.error('[SSE] Failed to create EventSource:', error);
      setState(prev => ({ ...prev, isConnected: false, error: 'Failed to connect' }));
    }
  }, [enabled]);

  useEffect(() => {
    connect();

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  // Reset state after events are processed (to allow same event to trigger again)
  useEffect(() => {
    if (state.newLockupEvent) {
      const timer = setTimeout(() => {
        setState(prev => ({ ...prev, newLockupEvent: null }));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [state.newLockupEvent]);

  useEffect(() => {
    if (state.unlockEvent) {
      const timer = setTimeout(() => {
        setState(prev => ({ ...prev, unlockEvent: null }));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [state.unlockEvent]);

  useEffect(() => {
    if (state.transferEvent) {
      const timer = setTimeout(() => {
        setState(prev => ({ ...prev, transferEvent: null }));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [state.transferEvent]);

  return state;
}

