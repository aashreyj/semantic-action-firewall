export function calculateEntropy(input: string): number {
  if (input.length === 0) {
    return 0;
  }

  const frequency = new Map<string, number>();
  for (const char of input) {
    frequency.set(char, (frequency.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of frequency.values()) {
    const p = count / input.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}
