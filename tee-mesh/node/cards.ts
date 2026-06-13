// A2A-style agent cards + the aggregated node card that a node gossips.
import { appendEvent } from "./eventlog.ts";

export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  version?: string;
  capabilities?: unknown;
  skills?: unknown[];
  [k: string]: unknown;
}

export interface NodeCard {
  node_id: string;
  gateway_url: string;
  pubkey: string;
  app_id: string;
  mode: "tee" | "local";
  attestation_digest?: string;
  version: number; // monotonic per node; bumped when the agent set/cards change
  updated_at: string;
  deleted?: boolean; // tombstone
  last_seen?: string; // stamped by the receiver, not gossiped authoritatively
  agents: AgentCard[];
}

export interface AgentRef { name: string; url: string } // url = internal container url

// Fetch each agent's A2A card, rewrite its url to be gateway-reachable by peers.
// A currently-unreachable agent is simply absent this round (not an error to mask) —
// it reappears once it answers. We log the miss for forensics.
export async function aggregateAgents(refs: AgentRef[], gatewayUrl: string): Promise<AgentCard[]> {
  const out: AgentCard[] = [];
  for (const ref of refs) {
    try {
      const r = await fetch(`${ref.url}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const card = await r.json() as AgentCard;
      out.push({ ...card, name: ref.name, url: `${gatewayUrl}/agents/${ref.name}` });
    } catch (e) {
      await appendEvent("agent_unreachable", { agent: ref.name, error: String(e) });
    }
  }
  return out;
}

// Stable hash of the agent set so we only bump the version when something actually changed.
export function agentsFingerprint(agents: AgentCard[]): string {
  return JSON.stringify(agents.map((a) => [a.name, a.version, a.url, a.skills]).sort());
}
