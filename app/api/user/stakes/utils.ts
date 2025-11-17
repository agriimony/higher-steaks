export function normalizeAddr(a: string | null | undefined): string | null {
  if (!a) return null;
  return String(a).toLowerCase();
}

export function normalizeHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  let h = String(hash).trim().toLowerCase();
  if (!h) return null;
  if (!h.startsWith('0x')) {
    if (/^[0-9a-f]+$/i.test(h)) {
      h = `0x${h}`;
    } else {
      return null;
    }
  }
  return h;
}

export function buildInFilter(addresses: string[]): string {
  const quoted = addresses.map(a => `'${a}'`).join(',');
  return `(unlocked = false) AND (receiver IN (${quoted}))`;
}

export function serverSort(lockups: any[], connectedAddress?: string | null): any[] {
  const now = Math.floor(Date.now() / 1000);
  const conn = normalizeAddr(connectedAddress || '');
  return [...lockups].sort((a, b) => {
    const aConn = normalizeAddr(a.receiver) === conn ? 0 : 1;
    const bConn = normalizeAddr(b.receiver) === conn ? 0 : 1;
    if (aConn !== bConn) return aConn - bConn;
    const aActive = Number(a.unlockTime) > now;
    const bActive = Number(b.unlockTime) > now;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    if (aActive && bActive) {
      return Number(a.unlockTime) - Number(b.unlockTime);
    }
    const aAmt = Number(a.amount ?? '0');
    const bAmt = Number(b.amount ?? '0');
    if (aAmt !== bAmt) return bAmt - aAmt;
    return 0;
  });
}

export function convertAmount(raw: any): string {
  try {
    return (BigInt(raw)).toString(); // actual scaling handled upstream
  } catch {
    const num = Number(raw);
    return Number.isFinite(num) ? num.toString() : '0';
  }
}


