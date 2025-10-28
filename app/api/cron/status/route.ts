import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = {
    timestamp: new Date().toISOString(),
    environment: {
      neynarApiKey: !!process.env.NEYNAR_API_KEY,
      neynarApiKeyLength: process.env.NEYNAR_API_KEY?.length || 0,
      postgresUrl: !!process.env.POSTGRES_URL,
      postgresUrlNonPooling: !!process.env.POSTGRES_URL_NON_POOLING,
      postgresPrismaUrl: !!process.env.POSTGRES_PRISMA_URL,
      baseRpcUrl: process.env.BASE_RPC_URL || 'using default',
      cronSecret: !!process.env.CRON_SECRET,
      nodeEnv: process.env.NODE_ENV,
    },
    databaseStatus: 'unknown',
  };

  // Try to connect to database
  if (process.env.POSTGRES_URL) {
    try {
      const { sql } = await import('@vercel/postgres');
      const result = await sql`SELECT NOW() as current_time`;
      checks.databaseStatus = 'connected';
      (checks as any).databaseTime = result.rows[0]?.current_time;
      
      // Try to query the leaderboard table
      try {
        const tableCheck = await sql`
          SELECT COUNT(*) as count 
          FROM leaderboard_entries
        `;
        (checks as any).leaderboardEntries = parseInt(tableCheck.rows[0]?.count || '0');
      } catch (tableError) {
        (checks as any).leaderboardStatus = 'table not found - run schema.sql';
      }
    } catch (dbError) {
      checks.databaseStatus = 'error';
      (checks as any).databaseError = dbError instanceof Error ? dbError.message : String(dbError);
    }
  } else {
    checks.databaseStatus = 'not configured';
  }

  return NextResponse.json(checks, { status: 200 });
}

