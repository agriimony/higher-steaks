import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0; // Never cache

export async function GET() {
  try {
    const currentTime = Math.floor(Date.now() / 1000);
    console.log('[Network Stats] Starting calculation at timestamp:', currentTime);
    console.log('[Network Stats] POSTGRES_URL exists:', !!process.env.POSTGRES_URL);
    console.log('[Network Stats] POSTGRES_URL_NON_POOLING exists:', !!process.env.POSTGRES_URL_NON_POOLING);

    // Get current database time to verify we're getting fresh data
    let dbTime: string | null = null;
    try {
      const timeResult = await sql`SELECT NOW() as current_time, COUNT(*) as total_rows FROM leaderboard_entries`;
      dbTime = timeResult.rows[0]?.current_time || null;
      console.log('[Network Stats] Database current time:', dbTime);
      console.log('[Network Stats] Total rows in leaderboard_entries:', timeResult.rows[0]?.total_rows);
    } catch (e) {
      console.error('[Network Stats] Error getting database time:', e);
    }

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

    console.log('[Network Stats] Query returned', result.rows.length, 'rows');
    
    // Log sample data from first row to verify it matches database
    if (result.rows.length > 0) {
      const sampleRow = result.rows[0];
      console.log('[Network Stats] Sample row data:', {
        cast_hash: sampleRow.cast_hash,
        caster_stake_amounts_count: (sampleRow.caster_stake_amounts || []).length,
        caster_stake_unlocked_count: (sampleRow.caster_stake_unlocked || []).length,
        supporter_stake_amounts_count: (sampleRow.supporter_stake_amounts || []).length,
        supporter_stake_unlocked_count: (sampleRow.supporter_stake_unlocked || []).length,
        first_caster_amount: sampleRow.caster_stake_amounts?.[0],
        first_caster_unlocked: sampleRow.caster_stake_unlocked?.[0],
        first_supporter_amount: sampleRow.supporter_stake_amounts?.[0],
        first_supporter_unlocked: sampleRow.supporter_stake_unlocked?.[0],
      });
    }

    let totalCasterStaked = BigInt(0);
    let totalSupporterStaked = BigInt(0);
    const castHashes = new Set<string>();

    let rowIndex = 0;
    // Process each row
    for (const row of result.rows) {
      rowIndex++;
      const castHash = row.cast_hash;
      if (castHash) {
        castHashes.add(castHash);
      }

      console.log(`[Network Stats] Processing row ${rowIndex}/${result.rows.length}, cast_hash: ${castHash || 'N/A'}`);

      // Process caster stakes
      const casterAmounts = row.caster_stake_amounts || [];
      const casterUnlocked = row.caster_stake_unlocked || [];
      const casterUnlockTimes = row.caster_stake_unlock_times || [];

      console.log(`[Network Stats] Row ${rowIndex}: Found ${casterAmounts.length} caster stakes`);
      
      let rowCasterStaked = BigInt(0);
      let validCasterCount = 0;
      let unlockedCasterCount = 0;

      for (let i = 0; i < casterAmounts.length; i++) {
        const amount = casterAmounts[i];
        const unlocked = casterUnlocked[i] || false;
        const unlockTime = casterUnlockTimes[i] || 0;

        if (unlocked) {
          unlockedCasterCount++;
        }

        // Valid caster stake: !unlocked only (no expiry check)
        if (!unlocked) {
          try {
            // Amounts are stored as wei (string representation of BigInt)
            const amountBigInt = BigInt(String(amount || '0'));
            rowCasterStaked += amountBigInt;
            totalCasterStaked += amountBigInt;
            validCasterCount++;
          } catch (e) {
            console.error(`[Network Stats] Row ${rowIndex}: Error parsing caster stake ${i}:`, e, 'amount:', amount);
          }
        }
      }

      if (casterAmounts.length > 0) {
        const rowCasterStakedNum = Number(rowCasterStaked) / 1e18;
        console.log(`[Network Stats] Row ${rowIndex}: Caster stakes - Total: ${rowCasterStakedNum.toFixed(2)}, Valid: ${validCasterCount}, Unlocked: ${unlockedCasterCount}, Total entries: ${casterAmounts.length}`);
      }

      // Process supporter stakes
      // Valid supporter stake: !unlocked && unlockTime matches at least one caster unlockTime
      const supporterAmounts = row.supporter_stake_amounts || [];
      const supporterUnlocked = row.supporter_stake_unlocked || [];
      const supporterUnlockTimes = row.supporter_stake_unlock_times || [];

      console.log(`[Network Stats] Row ${rowIndex}: Found ${supporterAmounts.length} supporter stakes`);

      // Build Set of ALL caster unlockTimes (regardless of unlocked status)
      const casterUnlockSet = new Set(
        casterUnlockTimes.filter((t: any) => typeof t === 'number' && Number.isFinite(t))
      );
      console.log(`[Network Stats] Row ${rowIndex}: Caster unlock times set size: ${casterUnlockSet.size}, values:`, Array.from(casterUnlockSet).slice(0, 5));

      let rowSupporterStaked = BigInt(0);
      let validSupporterCount = 0;
      let unlockedSupporterCount = 0;
      let unmatchedSupporterCount = 0;

      for (let i = 0; i < supporterAmounts.length; i++) {
        const amount = supporterAmounts[i];
        const unlocked = supporterUnlocked[i] || false;
        const unlockTime = supporterUnlockTimes[i] || 0;

        if (unlocked) {
          unlockedSupporterCount++;
        }

        // Valid supporter stake: !unlocked && unlockTime matches at least one caster unlockTime
        if (!unlocked && casterUnlockSet.has(unlockTime)) {
          try {
            // Amounts are stored as wei (string representation of BigInt)
            const amountBigInt = BigInt(String(amount || '0'));
            rowSupporterStaked += amountBigInt;
            totalSupporterStaked += amountBigInt;
            validSupporterCount++;
          } catch (e) {
            console.error(`[Network Stats] Row ${rowIndex}: Error parsing supporter stake ${i}:`, e, 'amount:', amount);
          }
        } else if (!unlocked && !casterUnlockSet.has(unlockTime)) {
          unmatchedSupporterCount++;
        }
      }

      if (supporterAmounts.length > 0) {
        const rowSupporterStakedNum = Number(rowSupporterStaked) / 1e18;
        console.log(`[Network Stats] Row ${rowIndex}: Supporter stakes - Total: ${rowSupporterStakedNum.toFixed(2)}, Valid: ${validSupporterCount}, Unlocked: ${unlockedSupporterCount}, Unmatched: ${unmatchedSupporterCount}, Total entries: ${supporterAmounts.length}`);
      }
    }

    // Convert from wei (18 decimals) to number
    const totalCasterStakedNum = Number(totalCasterStaked) / 1e18;
    const totalSupporterStakedNum = Number(totalSupporterStaked) / 1e18;
    const totalHigherStakedNum = totalCasterStakedNum + totalSupporterStakedNum;

    console.log('[Network Stats] Final totals:');
    console.log('  Database time:', dbTime);
    console.log('  Calculation time:', new Date().toISOString());
    console.log('  Total Caster Staked (wei):', totalCasterStaked.toString());
    console.log('  Total Caster Staked (HIGHER):', totalCasterStakedNum.toFixed(2));
    console.log('  Total Supporter Staked (wei):', totalSupporterStaked.toString());
    console.log('  Total Supporter Staked (HIGHER):', totalSupporterStakedNum.toFixed(2));
    console.log('  Total Higher Staked (HIGHER):', totalHigherStakedNum.toFixed(2));
    console.log('  Total Casts:', castHashes.size);
    console.log('  Total Rows Processed:', result.rows.length);

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

