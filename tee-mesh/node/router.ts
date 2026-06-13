// Context routing: score a question against every agent's skills across the whole mesh,
// then forward it to the best-matching agent (which may live on another CVM, reached via
// its gateway URL). No fallback — an unmatched question returns a clear "no skill" result.
import type { AgentCard, NodeCard } from "./cards.ts";
import { appendEvent } from "./eventlog.ts";

const tokenize = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

// A question token matches a skill word on exact equality or a shared >=3-char prefix
// (so "mean"~"meaning", "divide"~"divided") — light stemming without a dictionary.
function overlap(qTokens: Set<string>, skillWords: Set<string>): number {
  let score = 0;
  for (const w of skillWords) {
    if (w.length < 2) continue;
    for (const q of qTokens) {
      if (q === w || (q.length >= 3 && w.length >= 3 && (w.startsWith(q) || q.startsWith(w)))) { score++; break; }
    }
  }
  return score;
}

export interface Candidate {
  node_id: string; app_id: string; agent: string; skill: string; url: string; score: number;
}

export function rank(question: string, directory: NodeCard[]): Candidate[] {
  const ql = question.toLowerCase();
  const qt = new Set(tokenize(question));
  // Card-driven intent boost: a numeric expression routes to skills that advertise math.
  const arithmetic = /\d+\s*[-+*/x]\s*\d+/.test(ql) ||
    (/\d/.test(ql) && /\b(plus|minus|times|divided|divide|multiply|multiplied|over|add|subtract|sum|product)\b/.test(ql));
  const out: Candidate[] = [];
  for (const node of directory) {
    if (node.deleted) continue;
    for (const agent of node.agents ?? []) {
      for (const skill of ((agent.skills ?? []) as Array<Record<string, unknown>>)) {
        const words = new Set(tokenize([
          skill.id, skill.name, skill.description,
          (skill.tags as string[] ?? []).join(" "), (skill.examples as string[] ?? []).join(" "), agent.name,
        ].filter(Boolean).join(" ")));
        let score = overlap(qt, words);
        if (arithmetic && (words.has("math") || words.has("arithmetic") || words.has("calculate"))) score += 3;
        out.push({
          node_id: node.node_id, app_id: node.app_id, agent: agent.name,
          skill: String(skill.id ?? skill.name), url: agent.url, score,
        });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface RouteResult {
  question: string;
  routed_to: Candidate | null;
  answer: unknown;
  candidates: Candidate[];
}

export async function route(question: string, directory: NodeCard[]): Promise<RouteResult> {
  const candidates = rank(question, directory);
  const best = candidates[0];
  if (!best || best.score === 0) {
    await appendEvent("route_no_match", { question });
    return { question, routed_to: null, answer: { error: "no matching skill in the mesh" }, candidates: candidates.slice(0, 5) };
  }
  const resp = await fetch(best.url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }), signal: AbortSignal.timeout(8000),
  });
  const answer = await resp.json().catch(() => ({ error: "agent returned non-JSON" }));
  await appendEvent("routed", { question, agent: best.agent, skill: best.skill, app_id: best.app_id, score: best.score });
  return { question, routed_to: best, answer, candidates: candidates.slice(0, 5) };
}

export type { AgentCard };
