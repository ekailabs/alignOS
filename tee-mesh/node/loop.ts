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

export interface RunLoopOpts {
  passes: number;
  first: () => Promise<string>;
  refine: (current: string, k: number) => Promise<string>;
  isConverged?: (a: string, b: string) => boolean;
}

export async function runLoop(opts: RunLoopOpts): Promise<string[]> {
  const passes = Math.max(1, Math.min(opts.passes, 8));
  const isConverged = opts.isConverged ?? converged;
  let current = await opts.first();
  const trail = [current];
  for (let k = 2; k <= passes; k++) {
    const next = await opts.refine(current, k);
    trail.push(next);
    if (isConverged(current, next)) break;
    current = next;
  }
  return trail;
}
