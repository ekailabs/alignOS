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

export interface OwnerInfo {
  handle: string;
  display_name?: string;
  claimed?: boolean;
}

export interface NodeCard {
  node_id: string;
  gateway_url: string;
  pubkey: string;
  app_id: string;
  owner?: OwnerInfo;
  mode: "tee" | "local";
  attestation_digest?: string;
  version: number; // monotonic per node; bumped when the agent set/cards change
  updated_at: string;
  deleted?: boolean; // tombstone
  last_seen?: string; // stamped by the receiver, not gossiped authoritatively
  agents: AgentCard[];
}

export interface AgentRef {
  name: string;
  url: string;
} // url = internal container url

export interface ServiceDescriptor {
  service_id: string;
  owner: OwnerInfo;
  node_id: string;
  app_id: string;
  mode: "tee" | "local";
  gateway_url: string;
  stale?: boolean;
  endpoints: {
    node_card: string;
    service_card: string;
    ask: string;
    public_a2a: string;
    owner_a2a: string;
    quick_mode: string;
    deep_mode: string;
  };
  deep_mode: {
    runs_where: "owner-edge";
    via: "assist-client";
    folder_access: "explicit-per-request";
  };
  capabilities: {
    modes: ("quick" | "deep")[];
    quick: string;
    deep: string;
  };
  agents: AgentCard[];
}

export function serviceFromCard(
  card: NodeCard & { stale?: boolean },
): ServiceDescriptor {
  const base = card.gateway_url.replace(/\/$/, "");
  const owner = card.owner ??
    { handle: card.app_id, display_name: card.app_id, claimed: false };
  const ask = `${base}/ask-${owner.handle}`;
  return {
    service_id: card.node_id,
    owner,
    node_id: card.node_id,
    app_id: card.app_id,
    mode: card.mode,
    gateway_url: base,
    stale: card.stale,
    endpoints: {
      node_card: `${base}/.well-known/agent-card.json`,
      service_card: `${base}/.well-known/alignos-service.json`,
      ask,
      public_a2a: `${base}/a2a`,
      owner_a2a: `${base}/owner/a2a`,
      quick_mode: `${ask}?mode=quick`,
      deep_mode: `${ask}?mode=deep`,
    },
    deep_mode: {
      runs_where: "owner-edge",
      via: "assist-client",
      folder_access: "explicit-per-request",
    },
    capabilities: {
      modes: ["quick", "deep"],
      quick:
        "TEE-hosted replies from synced notes, onboarding log memory, and task history.",
      deep:
        "Local-machine execution via assist-client with scoped owner approval.",
    },
    agents: card.agents,
  };
}

// Fetch each agent's A2A card, rewrite its url to be gateway-reachable by peers.
// A currently-unreachable agent is simply absent this round (not an error to mask) —
// it reappears once it answers. We log the miss for forensics.
export async function aggregateAgents(
  refs: AgentRef[],
  gatewayUrl: string,
): Promise<AgentCard[]> {
  const out: AgentCard[] = [];
  for (const ref of refs) {
    try {
      const r = await fetch(`${ref.url}/.well-known/agent-card.json`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const card = await r.json() as AgentCard;
      out.push({
        ...card,
        name: ref.name,
        url: `${gatewayUrl}/agents/${ref.name}`,
      });
    } catch (e) {
      await appendEvent("agent_unreachable", {
        agent: ref.name,
        error: String(e),
      });
    }
  }
  return out;
}

// Stable hash of the agent set so we only bump the version when something actually changed.
export function agentsFingerprint(agents: AgentCard[]): string {
  return JSON.stringify(
    agents.map((a) => [a.name, a.version, a.url, a.skills]).sort(),
  );
}
