import { NextRequest, NextResponse } from 'next/server';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { sql } from '@vercel/postgres';
import { createClient } from '@vercel/postgres';
import { fetchAllLatestResults } from '@/lib/dune';
import { getHigherCast } from '@/lib/services/db-service';
import { buildInFilter, normalizeAddr, normalizeHash, convertAmount } from '../stakes/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0; // Never cache

const QUERY_ID = 6214515;
const COLUMNS = ['sender','lockTime','lockUpId','title','amount','receiver','unlockTime','unlocked'];

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams;
    const fidParam = search.get('fid');

    if (!fidParam) {
      return NextResponse.json({ error: 'fid required' }, { status: 400 });
    }
    const fid = parseInt(fidParam, 10);
    if (isNaN(fid)) {
      return NextResponse.json({ error: 'invalid fid' }, { status: 400 });
    }

    console.log('[User Stats] Starting calculation for fid:', fid);

    // Resolve wallets via Neynar (custody + verified)
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey) {
      return NextResponse.json({ error: 'NEYNAR_API_KEY not configured' }, { status: 500 });
    }
    const neynar = new NeynarAPIClient({ apiKey: neynarApiKey });
    const users = await neynar.fetchBulkUsers({ fids: [fid] });
    const user = users.users?.[0];
    if (!user) {
      return NextResponse.json({
        totalUserStaked: '0',
        totalCasterStaked: '0',
        totalSupporterStaked: '0',
        totalBuildersSupported: 0,
        topSupportedCasts: [],
        totalStakedOnUserCasts: '0',
        totalCasterStakesOnUserCasts: '0',
        totalSupporterStakesOnUserCasts: '0',
      });
    }
    const walletsSet = new Set<string>();
    if (user.custody_address) walletsSet.add(normalizeAddr(user.custody_address)!);
    for (const ea of (user.verified_addresses?.eth_addresses ?? [])) {
      const n = normalizeAddr(ea);
      if (n) walletsSet.add(n);
    }
    if (walletsSet.size === 0) {
      return NextResponse.json({
        totalUserStaked: '0',
        totalCasterStaked: '0',
        totalSupporterStaked: '0',
        totalBuildersSupported: 0,
        topSupportedCasts: [],
        totalStakedOnUserCasts: '0',
        totalCasterStakesOnUserCasts: '0',
        totalSupporterStakesOnUserCasts: '0',
      });
    }

    const addresses = Array.from(walletsSet);
    const filters = buildInFilter(addresses);

    console.log('[User Stats] User wallets:', addresses.length, 'addresses:', addresses.slice(0, 3));
    console.log('[User Stats] Dune filter:', filters);

    // Fetch from Dune
    const rows = await fetchAllLatestResults(QUERY_ID, {
      columns: COLUMNS,
      limit: 1000, // Get all user's lockups
      filters,
    });

    console.log('[User Stats] Dune query returned', rows.length, 'lockups');

    const castHashes = Array.from(new Set(
      rows
        .map((r: any) => normalizeHash(String(r.title || '')))
        .filter((h): h is string => Boolean(h))
    ));
    console.log('[User Stats] Unique cast hashes found:', castHashes.length);

    const castCache = new Map<string, any>();
    await Promise.all(
      castHashes.map(async hash => {
        const data = await getHigherCast(hash);
        castCache.set(hash, data);
      })
    );
    console.log('[User Stats] Cast cache populated:', castCache.size, 'casts');

    let totalCasterStaked = BigInt(0);
    let totalSupporterStaked = BigInt(0);
    const supportedCastsMap = new Map<string, { castHash: string; totalAmount: bigint }>();
    const uniqueSupportedFids = new Set<number>();

    let lockupIndex = 0;
    let unlockedCount = 0;
    let casterCount = 0;
    let supporterCount = 0;
    let unknownTypeCount = 0;

    // Process each lockup
    for (const r of rows) {
      lockupIndex++;
      const lockUpId = Number(r.lockUpId);
      const castHash = normalizeHash(String(r.title || ''));
      let overrideAmount = convertAmount(r.amount ?? '0');
      let unlocked = Boolean(r.unlocked);
      let stakeType: 'caster' | 'supporter' | null = null;
      const duneAmount = r.amount;
      const duneUnlocked = r.unlocked;

      if (castHash) {
        const cast = castCache.get(castHash);
        if (cast) {
          const casterIdx = cast.casterStakeLockupIds?.findIndex((id: number) => Number(id) === lockUpId) ?? -1;
          if (casterIdx !== -1) {
            stakeType = 'caster';
            unlocked = cast.casterStakeUnlocked?.[casterIdx] ?? unlocked;
            const raw = cast.casterStakeAmounts?.[casterIdx];
            if (raw !== undefined) {
              overrideAmount = convertAmount(raw);
            }
          } else {
            const supporterIdx = cast.supporterStakeLockupIds?.findIndex((id: number) => Number(id) === lockUpId) ?? -1;
            if (supporterIdx !== -1) {
              stakeType = 'supporter';
              unlocked = cast.supporterStakeUnlocked?.[supporterIdx] ?? unlocked;
              const raw = cast.supporterStakeAmounts?.[supporterIdx];
              if (raw !== undefined) {
                overrideAmount = convertAmount(raw);
              }
            }
          }
        }
      }

      // Skip unlocked stakes
      if (unlocked) {
        unlockedCount++;
        continue;
      }

      // convertAmount returns token units (not wei), so convert to wei for BigInt math
      const amountNum = parseFloat(overrideAmount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        console.warn(`[User Stats] Lockup ${lockupIndex}: Invalid amount - overrideAmount: ${overrideAmount}, amountNum: ${amountNum}`);
        continue;
      }
      const amountBigInt = BigInt(Math.floor(amountNum * 1e18));
      const amountBigIntWei = BigInt(String(duneAmount || '0'));

      if (stakeType === 'caster') {
        totalCasterStaked += amountBigInt;
        casterCount++;
        if (lockupIndex <= 5 || casterCount <= 3) {
          console.log(`[User Stats] Lockup ${lockupIndex}: CASTER - lockUpId: ${lockUpId}, castHash: ${castHash || 'N/A'}, Dune amount (wei): ${duneAmount}, Override amount (token): ${overrideAmount}, Final (wei): ${amountBigInt}, Unlocked: ${unlocked}`);
        }
      } else if (stakeType === 'supporter' && castHash) {
        totalSupporterStaked += amountBigInt;
        supporterCount++;
        
        // Track by castHash instead of creatorFid to show individual casts
        const existing = supportedCastsMap.get(castHash);
        if (existing) {
          existing.totalAmount += amountBigInt;
        } else {
          supportedCastsMap.set(castHash, {
            castHash,
            totalAmount: amountBigInt,
          });
        }
        
        // Also track unique FIDs for totalBuildersSupported count
        const cast = castCache.get(castHash);
        if (cast && cast.creatorFid) {
          uniqueSupportedFids.add(cast.creatorFid);
        }
        
        if (lockupIndex <= 5 || supporterCount <= 3) {
          console.log(`[User Stats] Lockup ${lockupIndex}: SUPPORTER - lockUpId: ${lockUpId}, castHash: ${castHash}, Dune amount (wei): ${duneAmount}, Override amount (token): ${overrideAmount}, Final (wei): ${amountBigInt}, Unlocked: ${unlocked}`);
        }
      } else {
        unknownTypeCount++;
        if (lockupIndex <= 5) {
          console.log(`[User Stats] Lockup ${lockupIndex}: UNKNOWN TYPE - lockUpId: ${lockUpId}, castHash: ${castHash || 'N/A'}, stakeType: ${stakeType}, Dune amount: ${duneAmount}, Override amount: ${overrideAmount}`);
        }
      }
    }

    console.log('[User Stats] Lockup processing summary:');
    console.log('  Total lockups:', rows.length);
    console.log('  Unlocked (skipped):', unlockedCount);
    console.log('  Caster stakes:', casterCount);
    console.log('  Supporter stakes:', supporterCount);
    console.log('  Unknown type:', unknownTypeCount);

    // Convert from wei to number
    const totalCasterStakedNum = Number(totalCasterStaked) / 1e18;
    const totalSupporterStakedNum = Number(totalSupporterStaked) / 1e18;
    const totalUserStakedNum = totalCasterStakedNum + totalSupporterStakedNum;

    console.log('[User Stats] User\'s own stakes totals:');
    console.log('  Total Caster Staked (wei):', totalCasterStaked.toString());
    console.log('  Total Caster Staked (HIGHER):', totalCasterStakedNum.toFixed(2));
    console.log('  Total Supporter Staked (wei):', totalSupporterStaked.toString());
    console.log('  Total Supporter Staked (HIGHER):', totalSupporterStakedNum.toFixed(2));
    console.log('  Total User Staked (HIGHER):', totalUserStakedNum.toFixed(2));
    console.log('  Total Builders Supported:', uniqueSupportedFids.size);

    // Get top supported casts (sorted by total amount)
    const topSupportedCastsData = Array.from(supportedCastsMap.values())
      .sort((a, b) => {
        if (a.totalAmount > b.totalAmount) return -1;
        if (a.totalAmount < b.totalAmount) return 1;
        return 0;
      })
      .slice(0, 10); // Top 10

    // Build response with cast information
    const topSupportedCasts = [];
    if (topSupportedCastsData.length > 0) {
      // Get unique creator FIDs to fetch profiles
      const creatorFids = new Set<number>();
      for (const data of topSupportedCastsData) {
        const cast = castCache.get(data.castHash);
        if (cast && cast.creatorFid) {
          creatorFids.add(cast.creatorFid);
        }
      }

      // Fetch user profiles for creators
      const fidsToFetch = Array.from(creatorFids);
      const userProfiles = await neynar.fetchBulkUsers({ fids: fidsToFetch });
      const profileMap = new Map(
        userProfiles.users.map(u => [u.fid, u])
      );

      // Build cast entries with full information
      for (const data of topSupportedCastsData) {
        const cast = castCache.get(data.castHash);
        if (!cast) continue;

        const profile = profileMap.get(cast.creatorFid);
        topSupportedCasts.push({
          castHash: data.castHash,
          castText: cast.castText || '',
          description: cast.description || '',
          castTimestamp: cast.castTimestamp || '',
          creatorFid: cast.creatorFid,
          creatorUsername: cast.creatorUsername || profile?.username || `user-${cast.creatorFid}`,
          creatorDisplayName: cast.creatorDisplayName || profile?.display_name || profile?.username || `User ${cast.creatorFid}`,
          creatorPfpUrl: cast.creatorPfpUrl || profile?.pfp_url || '',
          totalAmount: (Number(data.totalAmount) / 1e18).toString(),
          rank: cast.rank || null,
          castState: cast.castState || 'valid',
        });
      }
    }

    // Query casts where user is the creator to get stakes on their casts
    let totalStakedOnUserCasts = BigInt(0);
    let totalCasterStakesOnUserCasts = BigInt(0);
    let totalSupporterStakesOnUserCasts = BigInt(0);
    const uniqueSupporterFids = new Set<number>();

    console.log('[User Stats] Querying database for stakes on user\'s casts (fid:', fid, ')');

    // Use non-pooling connection for fresh data
    let client: ReturnType<typeof createClient> | undefined;
    
    try {
      let userCastsResult;
      
      if (process.env.POSTGRES_URL_NON_POOLING) {
        console.log('[User Stats] Using non-pooling connection');
        client = createClient({
          connectionString: process.env.POSTGRES_URL_NON_POOLING,
        });
        await client.connect();
        userCastsResult = await client.sql`
          SELECT 
            caster_stake_amounts,
            caster_stake_unlocked,
            caster_stake_unlock_times,
            supporter_stake_amounts,
            supporter_stake_fids,
            supporter_stake_unlocked,
            supporter_stake_unlock_times
          FROM leaderboard_entries
          WHERE creator_fid = ${fid}
          AND cast_state IN ('higher', 'expired')
        `;
      } else {
        console.log('[User Stats] Using pooled connection (fallback)');
        // Fallback to pooled connection if non-pooling not available
        userCastsResult = await sql`
          SELECT 
            caster_stake_amounts,
            caster_stake_unlocked,
            caster_stake_unlock_times,
            supporter_stake_amounts,
            supporter_stake_fids,
            supporter_stake_unlocked,
            supporter_stake_unlock_times
          FROM leaderboard_entries
          WHERE creator_fid = ${fid}
          AND cast_state IN ('higher', 'expired')
        `;
      }

      console.log('[User Stats] Database query returned', userCastsResult.rows.length, 'casts');

      let castRowIndex = 0;
      let totalCasterStakesCount = 0;
      let unlockedCasterStakesCount = 0;
      let totalSupporterStakesCount = 0;
      let unlockedSupporterStakesCount = 0;
      let unmatchedSupporterStakesCount = 0;

      for (const row of userCastsResult.rows) {
        castRowIndex++;
        // Sum caster stakes (stakes the user made on their own casts)
        // Valid caster stake: !unlocked only (no expiry check)
        // Amounts are stored as wei (string representation of BigInt)
        const casterAmounts = row.caster_stake_amounts || [];
        const casterUnlocked = row.caster_stake_unlocked || [];
        
        console.log(`[User Stats] Cast ${castRowIndex}: Found ${casterAmounts.length} caster stakes`);
        
        for (let i = 0; i < casterAmounts.length; i++) {
          if (casterUnlocked[i]) {
            unlockedCasterStakesCount++;
          }
          if (!casterUnlocked[i]) {
            try {
              const amountBigInt = BigInt(String(casterAmounts[i] || '0'));
              totalCasterStakesOnUserCasts += amountBigInt;
              totalCasterStakesCount++;
              if (castRowIndex === 1 && i < 3) {
                console.log(`[User Stats] Cast ${castRowIndex} Caster stake ${i}: amount (wei): ${casterAmounts[i]}, unlocked: ${casterUnlocked[i]}`);
              }
            } catch (e) {
              console.error(`[User Stats] Cast ${castRowIndex} Caster stake ${i}: Error parsing amount:`, e);
            }
          }
        }

        // Sum supporter stakes (stakes others made on the user's casts)
        // Valid supporter stake: !unlocked && unlockTime matches at least one caster unlockTime
        // Amounts are stored as wei (string representation of BigInt)
        const supporterAmounts = row.supporter_stake_amounts || [];
        const supporterFids = row.supporter_stake_fids || [];
        const supporterUnlocked = row.supporter_stake_unlocked || [];
        const supporterUnlockTimes = row.supporter_stake_unlock_times || [];
        const casterUnlockTimes = row.caster_stake_unlock_times || [];

        console.log(`[User Stats] Cast ${castRowIndex}: Found ${supporterAmounts.length} supporter stakes`);

        // Build Set of ALL caster unlockTimes (regardless of unlocked status)
        const casterUnlockSet = new Set(
          casterUnlockTimes.filter((t: any) => typeof t === 'number' && Number.isFinite(t))
        );
        console.log(`[User Stats] Cast ${castRowIndex}: Caster unlock times set size: ${casterUnlockSet.size}, values:`, Array.from(casterUnlockSet).slice(0, 5));

        for (let i = 0; i < supporterAmounts.length; i++) {
          const unlocked = supporterUnlocked[i] || false;
          const unlockTime = supporterUnlockTimes[i] || 0;

          if (unlocked) {
            unlockedSupporterStakesCount++;
          }

          // Valid supporter stake: !unlocked && unlockTime matches at least one caster unlockTime
          if (!unlocked && casterUnlockSet.has(unlockTime)) {
            try {
              const amountBigInt = BigInt(String(supporterAmounts[i] || '0'));
              totalSupporterStakesOnUserCasts += amountBigInt;
              totalSupporterStakesCount++;

              // Track unique supporter FIDs
              if (i < supporterFids.length && supporterFids[i]) {
                uniqueSupporterFids.add(Number(supporterFids[i]));
              }
              
              if (castRowIndex === 1 && i < 3) {
                console.log(`[User Stats] Cast ${castRowIndex} Supporter stake ${i}: amount (wei): ${supporterAmounts[i]}, unlockTime: ${unlockTime}, fid: ${supporterFids[i]}, unlocked: ${unlocked}`);
              }
            } catch (e) {
              console.error(`[User Stats] Cast ${castRowIndex} Supporter stake ${i}: Error parsing amount:`, e);
            }
          } else if (!unlocked && !casterUnlockSet.has(unlockTime)) {
            unmatchedSupporterStakesCount++;
            if (castRowIndex === 1 && i < 3) {
              console.log(`[User Stats] Cast ${castRowIndex} Supporter stake ${i}: UNMATCHED - unlockTime: ${unlockTime}, not in caster unlock set`);
            }
          }
        }
      }

      console.log('[User Stats] Stakes on user\'s casts summary:');
      console.log('  Total casts:', userCastsResult.rows.length);
      console.log('  Caster stakes - Total:', totalCasterStakesCount, ', Unlocked:', unlockedCasterStakesCount);
      console.log('  Supporter stakes - Total:', totalSupporterStakesCount, ', Unlocked:', unlockedSupporterStakesCount, ', Unmatched:', unmatchedSupporterStakesCount);

      // Calculate total from caster + supporter stakes
      totalStakedOnUserCasts = totalCasterStakesOnUserCasts + totalSupporterStakesOnUserCasts;
      
      // Close non-pooling connection if used
      if (client) {
        await client.end();
      }
    } catch (dbError: any) {
      console.error('[User Stats API] Error querying user casts:', dbError);
      // Continue with 0 values if query fails
      totalStakedOnUserCasts = BigInt(0);
      totalCasterStakesOnUserCasts = BigInt(0);
      totalSupporterStakesOnUserCasts = BigInt(0);
      
      // Ensure connection is closed even on error
      if (client) {
        try {
          await client.end();
        } catch (closeError) {
          // Ignore close errors
        }
      }
    }

    // Convert from wei (18 decimals) to token units
    const totalStakedOnUserCastsNum = Number(totalStakedOnUserCasts) / 1e18;
    const totalCasterStakesOnUserCastsNum = Number(totalCasterStakesOnUserCasts) / 1e18;
    const totalSupporterStakesOnUserCastsNum = Number(totalSupporterStakesOnUserCasts) / 1e18;

    console.log('[User Stats] Stakes on user\'s casts totals:');
    console.log('  Total Staked On User Casts (wei):', totalStakedOnUserCasts.toString());
    console.log('  Total Staked On User Casts (HIGHER):', totalStakedOnUserCastsNum.toFixed(2));
    console.log('  Total Caster Stakes On User Casts (wei):', totalCasterStakesOnUserCasts.toString());
    console.log('  Total Caster Stakes On User Casts (HIGHER):', totalCasterStakesOnUserCastsNum.toFixed(2));
    console.log('  Total Supporter Stakes On User Casts (wei):', totalSupporterStakesOnUserCasts.toString());
    console.log('  Total Supporter Stakes On User Casts (HIGHER):', totalSupporterStakesOnUserCastsNum.toFixed(2));
    console.log('  Total Supporters:', uniqueSupporterFids.size);

    console.log('[User Stats] Final response totals:');
    console.log('  totalUserStaked:', totalUserStakedNum.toFixed(2));
    console.log('  totalCasterStaked:', totalCasterStakedNum.toFixed(2));
    console.log('  totalSupporterStaked:', totalSupporterStakedNum.toFixed(2));
    console.log('  totalStakedOnUserCasts:', totalStakedOnUserCastsNum.toFixed(2));

    return NextResponse.json({
      totalUserStaked: totalUserStakedNum.toString(),
      totalCasterStaked: totalCasterStakedNum.toString(),
      totalSupporterStaked: totalSupporterStakedNum.toString(),
      totalBuildersSupported: uniqueSupportedFids.size,
      topSupportedCasts,
      // New fields for stakes on user's casts (converted from wei to token units)
      totalStakedOnUserCasts: totalStakedOnUserCastsNum.toString(),
      totalCasterStakesOnUserCasts: totalCasterStakesOnUserCastsNum.toString(),
      totalSupporterStakesOnUserCasts: totalSupporterStakesOnUserCastsNum.toString(),
      totalSupporters: uniqueSupporterFids.size,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[User Stats API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

