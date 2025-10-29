'use client';

import { useState } from 'react';

export default function TestCronPage() {
  const [cronResult, setCronResult] = useState<any>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [debugResult, setDebugResult] = useState<any>(null);
  const [topResult, setTopResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [cronSecret, setCronSecret] = useState('');

  const runCronJob = async () => {
    if (!cronSecret) {
      alert('Please enter your cron secret');
      return;
    }

    setLoading(true);
    setCronResult(null);
    setVerifyResult(null);
    setDebugResult(null);
    setTopResult(null);

    try {
      // Step 1: Run the cron job
      console.log('Running cron job...');
      const cronResponse = await fetch(`/api/cron/update-staking-leaderboard?secret=${cronSecret}`);
      const cronData = await cronResponse.json();
      setCronResult(cronData);
      console.log('Cron result:', cronData);

      // Wait 2 seconds for database to settle
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 2: Check verify endpoint
      console.log('Checking verify endpoint...');
      const verifyResponse = await fetch('/api/leaderboard/verify');
      const verifyData = await verifyResponse.json();
      setVerifyResult(verifyData);
      console.log('Verify result:', verifyData);

      // Step 3: Check debug endpoint
      console.log('Checking debug endpoint...');
      const debugResponse = await fetch('/api/leaderboard/debug');
      const debugData = await debugResponse.json();
      setDebugResult(debugData);
      console.log('Debug result:', debugData);

      // Step 4: Check top endpoint
      console.log('Checking top endpoint...');
      const topResponse = await fetch('/api/leaderboard/top');
      const topData = await topResponse.json();
      setTopResult(topData);
      console.log('Top result:', topData);

    } catch (error: any) {
      console.error('Error:', error);
      setCronResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Cron Job Test Dashboard</h1>

        {/* Input Section */}
        <div className="mb-8 p-6 bg-zinc-900 border border-zinc-700 rounded">
          <label className="block mb-2 text-sm font-medium">Cron Secret:</label>
          <input
            type="password"
            value={cronSecret}
            onChange={(e) => setCronSecret(e.target.value)}
            placeholder="Enter your CRON_SECRET"
            className="w-full p-3 bg-black border border-zinc-700 rounded text-white mb-4"
          />
          <button
            onClick={runCronJob}
            disabled={loading || !cronSecret}
            className="px-6 py-3 bg-white text-black font-bold rounded hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {loading ? 'Running...' : 'Run Cron Job & Check Results'}
          </button>
        </div>

        {/* Results Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cron Result */}
          <div className="p-6 bg-zinc-900 border border-zinc-700 rounded">
            <h2 className="text-xl font-bold mb-4 text-green-500">1. Cron Job Result</h2>
            {cronResult ? (
              <pre className="text-xs overflow-auto max-h-96 bg-black p-4 rounded">
                {JSON.stringify(cronResult, null, 2)}
              </pre>
            ) : (
              <p className="text-zinc-500">No results yet</p>
            )}
          </div>

          {/* Verify Result */}
          <div className="p-6 bg-zinc-900 border border-zinc-700 rounded">
            <h2 className="text-xl font-bold mb-4 text-blue-500">2. Verify Endpoint</h2>
            {verifyResult ? (
              <div>
                <div className="mb-2 text-sm">
                  <strong>Total Entries:</strong> {verifyResult.totalEntries}
                </div>
                <div className="mb-2 text-sm">
                  <strong>Timestamp:</strong> {verifyResult.timestamp}
                </div>
                <pre className="text-xs overflow-auto max-h-80 bg-black p-4 rounded">
                  {JSON.stringify(verifyResult.entries, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-zinc-500">No results yet</p>
            )}
          </div>

          {/* Debug Result */}
          <div className="p-6 bg-zinc-900 border border-zinc-700 rounded">
            <h2 className="text-xl font-bold mb-4 text-yellow-500">3. Debug Endpoint</h2>
            {debugResult ? (
              <div>
                <div className="mb-2 text-sm">
                  <strong>Total Entries:</strong> {debugResult.totalEntries}
                </div>
                <div className="mb-2 text-sm">
                  <strong>Top Query Results:</strong> {debugResult.topQueryResults}
                </div>
                <pre className="text-xs overflow-auto max-h-80 bg-black p-4 rounded">
                  {JSON.stringify(debugResult.allEntries, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-zinc-500">No results yet</p>
            )}
          </div>

          {/* Top Endpoint Result */}
          <div className="p-6 bg-zinc-900 border border-zinc-700 rounded">
            <h2 className="text-xl font-bold mb-4 text-purple-500">4. Top 10 Endpoint (Frontend)</h2>
            {topResult ? (
              <div>
                <div className="mb-2 text-sm">
                  <strong>Entries Returned:</strong> {topResult.entries?.length || 0}
                </div>
                {topResult.entries && topResult.entries.length > 0 ? (
                  <div className="space-y-4">
                    {topResult.entries.map((entry: any, i: number) => (
                      <div key={i} className="p-3 bg-black rounded border border-zinc-800">
                        <div className="font-bold">{entry.username}</div>
                        <div className="text-sm text-zinc-400">{entry.description}</div>
                        <div className="text-sm text-green-500">{entry.usdValue}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="text-xs overflow-auto max-h-80 bg-black p-4 rounded">
                    {JSON.stringify(topResult, null, 2)}
                  </pre>
                )}
              </div>
            ) : (
              <p className="text-zinc-500">No results yet</p>
            )}
          </div>
        </div>

        {/* Comparison Summary */}
        {cronResult && verifyResult && debugResult && topResult && (
          <div className="mt-8 p-6 bg-zinc-900 border border-zinc-700 rounded">
            <h2 className="text-xl font-bold mb-4">📊 Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-black rounded">
                <div className="text-xs text-zinc-500">Cron Stored</div>
                <div className="text-2xl font-bold text-green-500">
                  {cronResult.stored || 0}
                </div>
              </div>
              <div className="p-4 bg-black rounded">
                <div className="text-xs text-zinc-500">Verify Count</div>
                <div className="text-2xl font-bold text-blue-500">
                  {verifyResult.totalEntries || 0}
                </div>
              </div>
              <div className="p-4 bg-black rounded">
                <div className="text-xs text-zinc-500">Debug Count</div>
                <div className="text-2xl font-bold text-yellow-500">
                  {debugResult.totalEntries || 0}
                </div>
              </div>
              <div className="p-4 bg-black rounded">
                <div className="text-xs text-zinc-500">Top Returned</div>
                <div className="text-2xl font-bold text-purple-500">
                  {topResult.entries?.length || 0}
                </div>
              </div>
            </div>
            
            {/* Status Indicator */}
            <div className="mt-4 p-4 bg-black rounded">
              {cronResult.stored === verifyResult.totalEntries && 
               verifyResult.totalEntries === debugResult.totalEntries &&
               topResult.entries?.length > 0 ? (
                <div className="text-green-500 font-bold">✅ All endpoints synchronized!</div>
              ) : (
                <div className="text-red-500 font-bold">⚠️ Mismatch detected - check individual results above</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
