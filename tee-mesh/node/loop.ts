// tee-mesh/node/loop.ts
// Owner-style refinement loop: pass 1 = draft, passes 2..N = refine in the owner's
// prompting style, stop early on convergence. Pure helpers here are unit-tested.
import { type Artifact, type Task, textOf } from "./inbox.ts";
import { complete, infer } from "./draft.ts";
import { appendEvent } from "./eventlog.ts";
import { getStyleProfile } from "./profile.ts";

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

export async function refinePass(
  task: Task,
  current: string,
  profile: string,
  k: number,
): Promise<string> {
  const ask = textOf(task.history[0]?.parts ?? []);
  const system =
    "You simulate how a specific person iterates on their AI assistant's output to make it " +
    "better. " +
    (profile ? `Here is how that person prompts:\n${profile}\n\n` : "") +
    "Given the original request and the current draft reply: (1) internally decide the single " +
    "most useful next refinement that person would ask for, (2) apply it. Output ONLY the " +
    "improved reply — plain text, no preamble, no markdown, no sign-off line.";
  const user =
    `Original request:\n${ask}\n\nCurrent draft (pass ${k - 1}):\n${current}\n\n` +
    "Return the improved reply.";
  try {
    return (await complete(system, user)).trim() || current;
  } catch {
    return current; // a failed pass never regresses the answer
  }
}

export async function draftLooped(task: Task): Promise<Artifact> {
  const passes = Math.max(2, Math.min(Number(Deno.env.get("ALIGN_LOOP_PASSES") ?? "6"), 8));
  const profile = await getStyleProfile();
  const trail = await runLoop({
    passes,
    first: () => infer(task, ""),
    refine: (cur, k) => refinePass(task, cur, profile, k),
  });
  await appendEvent("a2a_loop", { task: task.id, passes: trail.length });
  return {
    artifactId: crypto.randomUUID(),
    name: "reply",
    parts: [{ kind: "text", text: trail[trail.length - 1] }],
  };
}
