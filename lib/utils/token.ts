import { formatUnits } from 'viem';

export function convertAmount(raw: any): string {
  if (raw === null || raw === undefined) {
    return '0';
  }

  try {
    return formatUnits(BigInt(raw), 18);
  } catch {
    const num = Number(raw);
    return Number.isFinite(num) ? num.toString() : '0';
  }
}


