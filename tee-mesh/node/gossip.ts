// Pull-based gossip of node cards into an eventually-consistent directory.
// Membership is authoritative on-chain; gossip carries the rich (large, dynamic) cards.
import type { NodeCard } from "./cards.ts";
import type { RegistryClient } from "./registry.ts";
import { appendEvent } from "./eventlog.ts";

const BASE_BACKOFF = 2000, MAX_BACKOFF = 60_000;

export class Directory {
  private map = new Map<string, NodeCard>();
  private backoff = new Map<string, { until: number; fails: number }>();
  private members: { node_id: string; gateway_url: string }[] = [];
  private lastMemberRead = 0;

  setSelf(card: NodeCard) { this.map.set(card.node_id, card); }

  all(): NodeCard[] { return [...this.map.values()]; }

  // last-write-wins by version; tombstones (deleted=true) ride the same channel so a
  // removed node/agent actually propagates instead of lingering. Never overwrite self.
  // Preserves the existing last_seen on content updates — liveness is stamped by seen(),
  // not by version changes (a peer with a stable card is still alive).
  merge(incoming: NodeCard, selfId: string): boolean {
    if (!incoming?.node_id || incoming.node_id === selfId) return false;
    const cur = this.map.get(incoming.node_id);
    if (cur && incoming.version <= cur.version) return false;
    this.map.set(incoming.node_id, { ...incoming, last_seen: cur?.last_seen ?? new Date().toISOString() });
    return true;
  }

  // Stamp "I directly heard from this peer just now" — independent of whether its card changed.
  seen(nodeId: string) {
    const c = this.map.get(nodeId);
    if (c) c.last_seen = new Date().toISOString();
  }

  private ready(url: string): boolean {
    const b = this.backoff.get(url);
    return !b || Date.now() >= b.until;
  }
  private ok(url: string) { this.backoff.delete(url); }
  private fail(url: string) {
    const fails = (this.backoff.get(url)?.fails ?? 0) + 1;
    const jitter = Math.floor(Math.random() * 1000);
    this.backoff.set(url, { fails, until: Date.now() + Math.min(MAX_BACKOFF, BASE_BACKOFF * 2 ** fails) + jitter });
  }

  // Membership lives on-chain but is near-static; refresh it on a slow cadence and tolerate
  // read failures (reuse the cached list) so an RPC hiccup never stalls peer-card gossip.
  private async refreshMembers(registry: RegistryClient, ttlMs: number) {
    if (this.members.length && Date.now() - this.lastMemberRead < ttlMs) return;
    try {
      this.members = await registry.members();
      this.lastMemberRead = Date.now();
    } catch (e) {
      await appendEvent("registry_read_failed", { error: String(e) });
    }
  }

  async round(selfId: string, gatewayUrl: string, registry: RegistryClient, memberTtlMs = 30_000) {
    await this.refreshMembers(registry, memberTtlMs);
    for (const m of this.members) {
      if (m.node_id === selfId || m.gateway_url === gatewayUrl || !m.gateway_url) continue;
      if (!this.ready(m.gateway_url)) continue;
      try {
        const [cardR, peersR] = await Promise.all([
          fetch(`${m.gateway_url}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(6000) }),
          fetch(`${m.gateway_url}/peers`, { signal: AbortSignal.timeout(6000) }),
        ]);
        const card = await cardR.json() as NodeCard;
        const changed = this.merge(card, selfId);
        this.seen(card.node_id); // directly reached this peer this round → it's alive
        const peers = await peersR.json() as NodeCard[];
        let transitive = 0;
        for (const p of peers) if (this.merge(p, selfId)) transitive++;
        this.ok(m.gateway_url);
        if (changed || transitive) await appendEvent("merge", { from: m.gateway_url, node: card.node_id, transitive });
      } catch (e) {
        this.fail(m.gateway_url);
        await appendEvent("peer_fetch_failed", { url: m.gateway_url, error: String(e) });
      }
    }
  }
}

export async function runGossip(
  dir: Directory, selfId: string, gatewayUrl: string, registry: RegistryClient,
  refreshSelf: () => Promise<void>, intervalMs: number, stop: AbortSignal,
) {
  while (!stop.aborted) {
    try {
      await refreshSelf();
      await dir.round(selfId, gatewayUrl, registry);
    } catch (e) {
      await appendEvent("gossip_round_error", { error: String(e) });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
