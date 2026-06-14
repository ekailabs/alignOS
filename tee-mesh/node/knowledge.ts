// assist-remote: the owner's knowledge — a redacted {prompt -> output} corpus uploaded at
// onboarding (Moment 1). Used to style drafts in the owner's voice. File-backed (ALIGN_KNOWLEDGE).
export interface Pair {
  project?: string;
  prompt: string;
  output: string;
}

const PATH = Deno.env.get("ALIGN_KNOWLEDGE") ?? "./knowledge.json";

let pairs: Pair[] = (() => {
  try {
    return (JSON.parse(Deno.readTextFileSync(PATH)).pairs ?? []) as Pair[];
  } catch {
    return [];
  }
})();

export function setCorpus(next: unknown): { count: number } {
  pairs = (Array.isArray(next) ? next : [])
    .filter((p): p is Pair => !!p && typeof p.prompt === "string")
    .slice(0, 5000);
  try {
    Deno.writeTextFileSync(
      PATH,
      JSON.stringify({ pairs, updated_at: new Date().toISOString() }),
    );
  } catch { /* in-memory only */ }
  return { count: pairs.length };
}

export function knowledgeStats(): { count: number } {
  return { count: pairs.length };
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
