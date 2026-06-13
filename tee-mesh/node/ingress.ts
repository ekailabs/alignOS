// The node's single HTTP surface: self card, peer directory, gossip intake, dstack quote,
// and the reverse-proxy to local agent containers. Cross-CVM agent calls land on /agents/*
// too — agents never reach the outside directly; the node is the sole egress.
import type { NodeCard } from "./cards.ts";
import type { Directory } from "./gossip.ts";
import type { Identity } from "./identity.ts";
import { appendEvent } from "./eventlog.ts";
import { handleA2A } from "./a2a.ts";
import type { TaskStore, Policy } from "./inbox.ts";

const STALE_MS = 90_000;

export interface IngressCtx {
  selfId: string;
  getSelfCard: () => NodeCard;
  dir: Directory;
  agents: Map<string, string>; // name -> internal container url
  identity: Identity;
  store: TaskStore; // assist-remote A2A task store
  policy?: Policy; // needs-human policy (defaults to "everything needs the human")
}

export function makeHandler(ctx: IngressCtx) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/.well-known/agent-card.json") return Response.json(ctx.getSelfCard());

    if (p === "/peers") {
      const now = Date.now();
      return Response.json(ctx.dir.all().map((c) => ({
        ...c, stale: c.last_seen ? now - Date.parse(c.last_seen) > STALE_MS : false,
      })));
    }

    if (p === "/gossip" && req.method === "POST") {
      const body = await req.json() as NodeCard[];
      for (const c of body) ctx.dir.merge(c, ctx.selfId);
      return Response.json(ctx.getSelfCard());
    }

    if (p === "/quote") {
      const rd = url.searchParams.get("report_data") ?? "0".repeat(128);
      return Response.json(await ctx.identity.getQuote(rd));
    }

    if (p === "/") {
      return Response.json({
        alignOS: true, node_id: ctx.selfId, mode: ctx.identity.mode,
        agents: [...ctx.agents.keys()], peers: ctx.dir.all().length,
      });
    }

    // A2A surface (assist-remote). Public for peers; /owner/* for the owner's client.
    // TODO(phase 2): wrap /owner/* in the Ed25519 owner-auth envelope check.
    const a2a = { store: ctx.store, policy: ctx.policy, selfId: ctx.selfId };
    if (p === "/a2a" && req.method === "POST") return handleA2A(a2a, req, false);
    if (p === "/owner/a2a" && req.method === "POST") return handleA2A(a2a, req, true);

    const m = p.match(/^\/agents\/([^/]+)(\/.*)?$/);
    if (m) return proxyAgent(ctx, req, url, m[1], m[2] ?? "/");

    return new Response("not found", { status: 404 });
  };
}

async function proxyAgent(ctx: IngressCtx, req: Request, url: URL, name: string, rest: string): Promise<Response> {
  const base = ctx.agents.get(name);
  if (!base) return new Response(`unknown agent: ${name}`, { status: 404 });
  const headers = new Headers(req.headers);
  headers.delete("host");
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  const t0 = Date.now();
  const resp = await fetch(base + rest + url.search, { method: req.method, headers, body, redirect: "manual" });
  await appendEvent("agent_proxy", { agent: name, status: resp.status, ms: Date.now() - t0, run_id: crypto.randomUUID() });
  return new Response(resp.body, { status: resp.status, headers: resp.headers });
}
