export type Direction = 'ltr' | 'rtl';

const RTL_THRESHOLD = 0.3;

const RTL_RANGES: Array<[number, number]> = [
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic
  [0x0700, 0x074f], // Syriac
  [0x0750, 0x077f], // Arabic Supplement
  [0x0780, 0x07bf], // Thaana
  [0x07c0, 0x08ff], // NKo / Samaritan / Mandaic / Arabic Extended-A
  [0xfb1d, 0xfdff], // Hebrew & Arabic presentation forms-A
  [0xfe70, 0xfeff], // Arabic presentation forms-B
];

const LETTER_RE = /\p{L}/u;

function isRtl(codePoint: number): boolean {
  for (const [start, end] of RTL_RANGES) {
    if (codePoint >= start && codePoint <= end) return true;
    if (codePoint < start) return false;
  }
  return false;
}

export function detectDirection(
  samples: Array<string | null | undefined>,
): Direction {
  let rtl = 0;
  let ltr = 0;
  for (const sample of samples) {
    if (!sample) continue;
    for (const ch of sample) {
      if (!LETTER_RE.test(ch)) continue;
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      if (isRtl(cp)) rtl++;
      else ltr++;
    }
  }
  const total = rtl + ltr;
  if (total === 0) return 'ltr';
  return rtl / total > RTL_THRESHOLD ? 'rtl' : 'ltr';
}
