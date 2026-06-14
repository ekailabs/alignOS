// assist-remote: the owner's knowledge — a redacted {prompt -> output} corpus uploaded at
// onboarding (Moment 1). Used to style drafts in the owner's voice. File-backed (ALIGN_KNOWLEDGE).
export interface Pair {
  project?: string;
  prompt: string;
  output: string;
}

const PATH = Deno.env.get("ALIGN_KNOWLEDGE") ?? "./knowledge.json";

interface Stored { pairs: Pair[]; chains: string[][]; style_profile?: string | null }
const loaded: Stored = (() => {
  try {
    const j = JSON.parse(Deno.readTextFileSync(PATH));
    return {
      pairs: (j.pairs ?? []) as Pair[],
      chains: (j.chains ?? []) as string[][],
      style_profile: (j.style_profile ?? null) as string | null,
    };
  } catch {
    return { pairs: [], chains: [], style_profile: null };
  }
})();

let pairs: Pair[] = loaded.pairs;
let chains: string[][] = loaded.chains;
let profile: string | null = loaded.style_profile ?? null;

function persist(): void {
  try {
    Deno.writeTextFileSync(
      PATH,
      JSON.stringify({ pairs, chains, style_profile: profile, updated_at: new Date().toISOString() }),
    );
  } catch { /* in-memory only */ }
}

function normalizeChains(next: unknown): string[][] {
  if (!Array.isArray(next)) return [];
  return next
    .filter((c): c is unknown[] => Array.isArray(c))
    .map((c) => c.filter((s): s is string => typeof s === "string").slice(0, 12))
    .filter((c) => c.length >= 2)
    .slice(0, 200);
}

export function setCorpus(body: { pairs?: unknown; chains?: unknown }): { count: number } {
  pairs = (Array.isArray(body?.pairs) ? body.pairs : [])
    .filter((p): p is Pair => !!p && typeof (p as Pair).prompt === "string")
    .slice(0, 5000);
  chains = normalizeChains(body?.chains);
  profile = null; // corpus changed → invalidate the cached style profile
  persist();
  return { count: pairs.length };
}

export function knowledgeStats(): { count: number } {
  return { count: pairs.length };
}

export function getChains(): string[][] {
  return chains;
}
export function getCachedProfile(): string | null {
  return profile;
}
export function setCachedProfile(p: string): void {
  profile = p;
  persist();
}

// A small, spread-out sample of the owner's own messages — few-shot voice guidance for draft.ts.
export function styleExamples(n = 6): string[] {
  if (!pairs.length) return [];
  const out: string[] = [];
  const step = Math.max(1, Math.floor(pairs.length / n));
  for (let i = 0; i < pairs.length && out.length < n; i += step) {
    const p = (pairs[i].prompt || "").replace(/\s+/g, " ").trim();
    if (p.length > 10) out.push(p.slice(0, 220));
  }
  return out;
}
