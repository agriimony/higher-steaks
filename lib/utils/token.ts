import { formatUnits } from 'viem';

function expandScientific(input: string): string {
  const s = String(input || '').trim();
  if (!/[eE]/.test(s)) return s;
  const m = s.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!m) return s;
  const sign = m[1] || '';
  const intPart = m[2] || '0';
  const fracPart = m[3] || '';
  const exp = parseInt(m[4], 10);
  if (!Number.isFinite(exp)) return s;
  const digits = intPart + fracPart;
  const decimalPos = intPart.length;
  const newPos = decimalPos + exp;
  if (newPos <= 0) {
    return `${sign}0.${'0'.repeat(Math.abs(newPos))}${digits}`.replace(/\.0+$/, '');
  }
  if (newPos >= digits.length) {
    return `${sign}${digits}${'0'.repeat(newPos - digits.length)}`;
  }
  return `${sign}${digits.slice(0, newPos)}.${digits.slice(newPos)}`.replace(/\.0+$/, '');
}

export function convertAmount(raw: any): string {
  if (raw === null || raw === undefined) {
    return '0';
  }

  const normalized = expandScientific(String(raw));

  try {
    return formatUnits(BigInt(normalized), 18);
  } catch {
    // If it was not wei integer, return a non-scientific numeric string for UI safety.
    const num = Number(normalized);
    return Number.isFinite(num) ? expandScientific(num.toString()) : '0';
  }
}


