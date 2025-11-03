// Shared event store for CDP webhook events and SSE broadcasting
// Note: This uses in-memory storage which works within a single serverless function instance
// For production at scale, consider using Redis or a proper pub/sub system

interface EventStore {
  events: Array<{
    id: string;
    timestamp: number;
    type: 'lockup_created' | 'unlock' | 'transfer';
    data: any;
  }>;
  subscriptions: Map<string, () => void>;
}

export const eventStore: EventStore = {
  events: [],
  subscriptions: new Map(),
};

