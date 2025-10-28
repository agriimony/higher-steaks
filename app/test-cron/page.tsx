'use client';

import { useState } from 'react';

export default function TestCronPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const triggerCron = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/cron/update-leaderboard');
      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
      } else {
        setError(`Error ${response.status}: ${data.error || data.message || 'Unknown error'}`);
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Cron Job Tester</h1>
        
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <p className="text-gray-600 mb-4">
            This page lets you manually trigger the leaderboard update cron job.
          </p>
          
          <button
            onClick={triggerCron}
            disabled={loading}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
          >
            {loading ? 'Running...' : 'Trigger Cron Job'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <h2 className="text-red-800 font-semibold mb-2">Error</h2>
            <p className="text-red-700 whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {result && (
          <div className={`border rounded-lg p-4 ${error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
            <h2 className={`font-semibold mb-2 ${error ? 'text-red-800' : 'text-green-800'}`}>
              Response
            </h2>
            <pre className="bg-gray-900 text-green-400 p-4 rounded overflow-x-auto text-sm">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-800 mb-2">⚠️ Prerequisites</h3>
          <ul className="text-sm text-yellow-700 space-y-1 list-disc list-inside">
            <li>Vercel Postgres database must be enabled</li>
            <li>Database schema must be created (run sql/schema.sql)</li>
            <li>NEYNAR_API_KEY must be set in environment variables</li>
            <li>This may take 30-60 seconds to complete</li>
          </ul>
        </div>

        <div className="mt-6 text-center">
          <a
            href="/"
            className="text-blue-600 hover:text-blue-800 underline"
          >
            ← Back to Menu
          </a>
        </div>
      </div>
    </div>
  );
}

