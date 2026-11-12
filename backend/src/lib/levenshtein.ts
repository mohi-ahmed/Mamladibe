/**
 * Computes Levenshtein edit distance over Unicode code points (Bangla-safe).
 */
export function levenshteinDistance(source: string, target: string): number {
  const a = Array.from(source);
  const b = Array.from(target);

  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const [shortSeq, longSeq] = a.length <= b.length ? [a, b] : [b, a];
  let prevRow = new Array<number>(shortSeq.length + 1);
  let currRow = new Array<number>(shortSeq.length + 1);

  for (let j = 0; j <= shortSeq.length; j += 1) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= longSeq.length; i += 1) {
    currRow[0] = i;
    const longChar = longSeq[i - 1];

    for (let j = 1; j <= shortSeq.length; j += 1) {
      const cost = longChar === shortSeq[j - 1] ? 0 : 1;
      const insertCost = currRow[j - 1]! + 1;
      const deleteCost = prevRow[j]! + 1;
      const replaceCost = prevRow[j - 1]! + cost;
      currRow[j] = Math.min(insertCost, deleteCost, replaceCost);
    }

    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[shortSeq.length]!;
}

/**
 * PRD §9.6 change ratio: levenshtein(old, new) / max(old.length, 1).
 */
export function computeChangeRatio(oldText: string, newText: string): number {
  const oldCodePoints = Array.from(oldText).length;
  const distance = levenshteinDistance(oldText, newText);
  return distance / Math.max(oldCodePoints, 1);
}

