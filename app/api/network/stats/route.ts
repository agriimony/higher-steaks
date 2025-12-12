import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const currentTime = Math.floor(Date.now() / 1000);

    // Query only non-expired casts (cast_state = 'higher')
    const result = await sql`
      SELECT 
        caster_stake_amounts,
        caster_stake_unlocked,
        caster_stake_unlock_times,
        supporter_stake_amounts,
        supporter_stake_unlocked,
        supporter_stake_unlock_times,
        cast_hash
      FROM leaderboard_entries
      WHERE cast_state = 'higher'
    `;

    let totalCasterStaked = BigInt(0);
    let totalSupporterStaked = BigInt(0);
    const castHashes = new Set<string>();

    // Process each row
    for (const row of result.rows) {
      const castHash = row.cast_hash;
      if (castHash) {
        castHashes.add(castHash);
      }

      // Process caster stakes
      const casterAmounts = row.caster_stake_amounts || [];
      const casterUnlocked = row.caster_stake_unlocked || [];

      for (let i = 0; i < casterAmounts.length; i++) {
        const amount = casterAmounts[i];
        const unlocked = casterUnlocked[i] || false;

        // Only count if not unlocked
        if (!unlocked) {
          try {
            // Amounts are stored as wei (string representation of BigInt)
            const amountBigInt = BigInt(String(amount || '0'));
            totalCasterStaked += amountBigInt;
          } catch (e) {
            // Skip invalid amounts
          }
        }
      }

      // Process supporter stakes
      const supporterAmounts = row.supporter_stake_amounts || [];
      const supporterUnlocked = row.supporter_stake_unlocked || [];

      for (let i = 0; i < supporterAmounts.length; i++) {
        const amount = supporterAmounts[i];
        const unlocked = supporterUnlocked[i] || false;

        // Only count if not unlocked
        if (!unlocked) {
          try {
            // Amounts are stored as wei (string representation of BigInt)
            const amountBigInt = BigInt(String(amount || '0'));
            totalSupporterStaked += amountBigInt;
          } catch (e) {
            // Skip invalid amounts
          }
        }
      }
    }

    // Convert from wei (18 decimals) to number
    const totalCasterStakedNum = Number(totalCasterStaked) / 1e18;
    const totalSupporterStakedNum = Number(totalSupporterStaked) / 1e18;
    const totalHigherStakedNum = totalCasterStakedNum + totalSupporterStakedNum;

    return NextResponse.json({
      totalHigherStaked: totalHigherStakedNum.toString(),
      totalCasterStaked: totalCasterStakedNum.toString(),
      totalSupporterStaked: totalSupporterStakedNum.toString(),
      totalCastsStakedOn: castHashes.size,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[Network Stats API] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch network stats' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

