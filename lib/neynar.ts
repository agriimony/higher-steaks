import { NeynarAPIClient } from '@neynar/nodejs-sdk';

// Initialize Neynar client
const getNeynarClient = () => {
  const apiKey = process.env.NEYNAR_API_KEY;
  
  if (!apiKey) {
    throw new Error('NEYNAR_API_KEY is not set in environment variables');
  }
  
  return new NeynarAPIClient(apiKey);
};

export { getNeynarClient };

