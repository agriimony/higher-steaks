'use client';

import { useState } from 'react';

export default function TestCronPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState('');

  const runCronJob = async () => {
    if (!secret.trim()) {
      setResult({ error: 'Please enter a CRON_SECRET' });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      console.log('Running cron test...');
      const response = await fetch('/api/test-cron', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secret }),
      });
      const data = await response.json();
      setResult(data);
      console.log('Test result:', data);
    } catch (error: any) {
      console.error('Error:', error);
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Cron Job Test Dashboard</h1>

        {/* Control Section */}
        <div className="mb-8 p-6 bg-zinc-900 border border-zinc-700 rounded">
          <p className="mb-4 text-sm text-zinc-400">
            Enter your CRON_SECRET to run the cron job and check all endpoints.
          </p>
          <div className="mb-4">
            <label htmlFor="secret" className="block text-sm font-medium mb-2">
              CRON_SECRET
            </label>
            <input
              id="secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter CRON_SECRET"
              className="w-full px-4 py-2 bg-black border border-zinc-700 rounded text-white placeholder-zinc-500 focus:outline-none focus:border-white"
            />
          </div>
          <button
            onClick={runCronJob}
            disabled={loading}
            className="px-6 py-3 bg-white text-black font-bold rounded hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {loading ? 'Running Tests...' : '🚀 Run Cron Job & Check All Endpoints'}
          </button>
        </div>

        {/* Results Grid */}
        {result && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cron Result */}
            <div className="p-6 bg-zinc-900 border border-zinc-700 rounded">
              <h2 className="text-xl font-bold mb-4 text-green-500">1. Cron Job Result</h2>
              {result.results?.cron ? (
                <pre className="text-xs overflow-auto max-h-96 bg-black p-4 rounded">
                  {JSON.stringify(result.results.cron, null, 2)}
                </pre>
              ) : (
                <p className="text-zinc-500">No results</p>
              )}
            </div>

            {/* Verify Result */}
            <div className="p-6 bg-zinc-900 border border-zinc-700 rounded">
              <h2 className="text-xl font-bold mb-4 text-blue-500">2. Verify Endpoint</h2>
              {result.results?.verify ? (
                <div>
                  <div className="mb-2 text-sm">
                    <strong>Total Entries:</strong> {result.results.verify.totalEntries}
                  </div>
                  <div className="mb-2 text-sm">
                    <strong>Timestamp:</strong> {result.results.verify.timestamp}
                  </div>
                  <pre className="text-xs overflow-auto max-h-80 bg-black p-4 rounded">
                    {JSON.stringify(result.results.verify.entries, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-zinc-500">No results</p>
              )}
            </div>

            {/* Debug Result */}
            <div className="p-6 bg-zinc-900 border border-zinc-700 rounded">
              <h2 className="text-xl font-bold mb-4 text-yellow-500">3. Debug Endpoint</h2>
              {result.results?.debug ? (
                <div>
                  <div className="mb-2 text-sm">
                    <strong>Total Entries:</strong> {result.results.debug.totalEntries}
                  </div>
                  <div className="mb-2 text-sm">
                    <strong>Top Query Results:</strong> {result.results.debug.topQueryResults}
                  </div>
                  <pre className="text-xs overflow-auto max-h-80 bg-black p-4 rounded">
                    {JSON.stringify(result.results.debug.allEntries, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-zinc-500">No results</p>
              )}
            </div>

            {/* Top Endpoint Result */}
            <div className="p-6 bg-zinc-900 border border-zinc-700 rounded">
              <h2 className="text-xl font-bold mb-4 text-purple-500">4. Top 10 Endpoint (Frontend)</h2>
              {result.results?.top ? (
                <div>
                  <div className="mb-2 text-sm">
                    <strong>Entries Returned:</strong> {result.results.top.entries?.length || 0}
                  </div>
                  {result.results.top.entries && result.results.top.entries.length > 0 ? (
                    <div className="space-y-4">
                      {result.results.top.entries.map((entry: any, i: number) => (
                        <div key={i} className="p-3 bg-black rounded border border-zinc-800">
                          <div className="font-bold">{entry.username}</div>
                          <div className="text-sm text-zinc-400">{entry.description}</div>
                          <div className="text-sm text-green-500">{entry.usdValue}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <pre className="text-xs overflow-auto max-h-80 bg-black p-4 rounded">
                      {JSON.stringify(result.results.top, null, 2)}
                    </pre>
                  )}
                </div>
              ) : (
                <p className="text-zinc-500">No results</p>
              )}
            </div>
          </div>
        )}

        {/* Comparison Summary */}
        {result?.summary && (
          <div className="mt-8 p-6 bg-zinc-900 border border-zinc-700 rounded">
            <h2 className="text-xl font-bold mb-4">📊 Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-black rounded">
                <div className="text-xs text-zinc-500">Cron Stored</div>
                <div className="text-2xl font-bold text-green-500">
                  {result.summary.cronStored || 0}
                </div>
              </div>
              <div className="p-4 bg-black rounded">
                <div className="text-xs text-zinc-500">Verify Count</div>
                <div className="text-2xl font-bold text-blue-500">
                  {result.summary.verifyCount || 0}
                </div>
              </div>
              <div className="p-4 bg-black rounded">
                <div className="text-xs text-zinc-500">Debug Count</div>
                <div className="text-2xl font-bold text-yellow-500">
                  {result.summary.debugCount || 0}
                </div>
              </div>
              <div className="p-4 bg-black rounded">
                <div className="text-xs text-zinc-500">Top Returned</div>
                <div className="text-2xl font-bold text-purple-500">
                  {result.summary.topReturned || 0}
                </div>
              </div>
            </div>
            
            {/* Status Indicator */}
            <div className="mt-4 p-4 bg-black rounded">
              {result.summary.allSynced ? (
                <div className="text-green-500 font-bold">✅ All endpoints synchronized!</div>
              ) : (
                <div className="text-red-500 font-bold">⚠️ Mismatch detected - check individual results above</div>
              )}
            </div>
          </div>
        )}

        {/* Error Display */}
        {result?.error && (
          <div className="mt-8 p-6 bg-red-900/20 border border-red-700 rounded">
            <h2 className="text-xl font-bold mb-4 text-red-500">❌ Error</h2>
            <p className="text-red-300 mb-2">{result.error}</p>
            {result.stack && (
              <pre className="text-xs overflow-auto max-h-40 bg-black p-4 rounded text-red-400">
                {result.stack}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
