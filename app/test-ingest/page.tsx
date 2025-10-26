'use client';

import { useState } from 'react';

export default function TestIngestion() {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testIngestion = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/ingest/higher?pattern=^i want to aim higher&limit=100');
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch data');
      }
      
      setResults(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Test Neynar Ingestion</h1>
        
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-xl font-semibold mb-4">Higher Channel Cast Filtering</h2>
          <p className="text-gray-600 mb-4">
            Pattern: <code className="bg-gray-100 px-2 py-1 rounded">^i want to aim higher</code>
          </p>
          
          <button
            onClick={testIngestion}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? 'Fetching...' : 'Fetch Matching Casts'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded mb-4">
            Error: {error}
            <p className="text-sm mt-2">
              Make sure you have set your NEYNAR_API_KEY in .env.local
            </p>
          </div>
        )}

        {results && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-semibold mb-4">Results</h3>
            
            <div className="mb-4">
              <p className="text-gray-600">
                Total casts fetched: <span className="font-bold">{results.total}</span>
              </p>
              <p className="text-gray-600">
                Matching casts: <span className="font-bold text-green-600">{results.matched}</span>
              </p>
            </div>

            {results.casts && results.casts.length > 0 ? (
              <div className="space-y-4">
                <h4 className="font-semibold">Matching Casts:</h4>
                {results.casts.map((cast: any, index: number) => (
                  <div key={cast.hash || index} className="border-l-4 border-blue-500 pl-4 py-2">
                    <p className="font-medium">@{cast.author.username}</p>
                    <p className="text-gray-700">{cast.text}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(cast.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No matching casts found.</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

