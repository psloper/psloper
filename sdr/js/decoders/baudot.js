// ITA2 / US-TTY Baudot tables used for amateur RTTY.
// Index = 5-bit code value, bit 0 is the first data bit sent after the start bit.

export const LTRS = 31;
export const FIGS = 27;

export const LETTERS = [
  '\0', 'E', '\n', 'A', ' ', 'S', 'I', 'U', '\r', 'D', 'R', 'J', 'N', 'F', 'C', 'K',
  'T', 'Z', 'L', 'W', 'H', 'Y', 'P', 'Q', 'O', 'B', 'G', null, 'M', 'X', 'V', null,
];

// US-TTY figures set (the common amateur convention). Code 5 is BELL.
export const FIGURES = [
  '\0', '3', '\n', '-', ' ', '\x07', '8', '7', '\r', '$', '4', "'", ',', '!', ':', '(',
  '5', '"', ')', '2', '#', '6', '0', '1', '9', '?', '&', null, '.', '/', ';', null,
];

/**
 * Encode text to 5-bit codes, inserting LTRS/FIGS shifts.
 * Assumes the receiver uses "unshift on space" (USOS), so after a space
 * the encoder also falls back to letters.
 */
export function encodeBaudot(text) {
  const codes = [LTRS];
  let figs = false;
  for (const ch of text.toUpperCase()) {
    let code = LETTERS.indexOf(ch);
    let needFigs = false;
    if (code < 0 || LETTERS[code] === null) {
      code = FIGURES.indexOf(ch);
      needFigs = true;
      if (code < 0) continue;
    }
    const shared = ch === ' ' || ch === '\r' || ch === '\n';
    if (!shared && needFigs !== figs) {
      codes.push(needFigs ? FIGS : LTRS);
      figs = needFigs;
    }
    codes.push(code);
    if (ch === ' ') figs = false;
  }
  return codes;
}
