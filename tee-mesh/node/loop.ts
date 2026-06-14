// tee-mesh/node/loop.ts
// Owner-style refinement loop: pass 1 = draft, passes 2..N = refine in the owner's
// prompting style, stop early on convergence. Pure helpers here are unit-tested.

const tokens = (s: string): Set<string> =>
  new Set((s.toLowerCase().match(/\b\w+\b/g) ?? []));

export function similarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

export function converged(a: string, b: string, threshold = 0.85): boolean {
  return similarity(a, b) >= threshold;
}
