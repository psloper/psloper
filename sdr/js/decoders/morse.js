// International Morse code table, shared by the CW decoder and the simulator.

export const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....',
  6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '@': '.--.-.',
};

export const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

/**
 * Convert text to a list of key states in dit units.
 * Returns [[on, units], ...] using standard PARIS timing:
 * dit 1, dah 3, intra-char gap 1, char gap 3, word gap 7.
 */
export function morseTiming(text) {
  const out = [];
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  words.forEach((word, wi) => {
    const chars = [...word].filter((c) => MORSE[c]);
    chars.forEach((c, ci) => {
      [...MORSE[c]].forEach((sym, si) => {
        if (si > 0) out.push([false, 1]);
        out.push([true, sym === '.' ? 1 : 3]);
      });
      if (ci < chars.length - 1) out.push([false, 3]);
    });
    if (wi < words.length - 1) out.push([false, 7]);
  });
  return out;
}
