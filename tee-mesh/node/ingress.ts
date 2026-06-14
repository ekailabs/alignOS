// The node's single HTTP surface: self card, peer directory, gossip intake, dstack quote,
// and the reverse-proxy to local agent containers. Cross-CVM agent calls land on /agents/*
// too — agents never reach the outside directly; the node is the sole egress.
import { type NodeCard, serviceFromCard } from "./cards.ts";
import type { Directory } from "./gossip.ts";
import type { Identity } from "./identity.ts";
import { appendEvent } from "./eventlog.ts";
import { handleA2A } from "./a2a.ts";
import { claim, verifyOwner } from "./owner.ts";
import type { Policy, TaskStore } from "./inbox.ts";
import { route } from "./router.ts";
import { DASHBOARD_HTML } from "./dashboard.ts";

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

    if (p === "/.well-known/agent-card.json") {
      return Response.json(ctx.getSelfCard());
    }
    if (p === "/.well-known/alignos-service.json") {
      return Response.json(serviceFromCard(ctx.getSelfCard()));
    }

    if (p === "/peers") {
      const now = Date.now();
      return Response.json(
        ctx.dir.all().map((c) => ({
          ...c,
          stale: c.last_seen ? now - Date.parse(c.last_seen) > STALE_MS : false,
        })),
      );
    }

    if (p === "/services") {
      const now = Date.now();
      const services = ctx.dir.all().map((c) =>
        serviceFromCard({
          ...c,
          stale: c.last_seen ? now - Date.parse(c.last_seen) > STALE_MS : false,
        })
      );
      return Response.json({ services });
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

    if (p === "/route" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as { question?: string };
      return Response.json(await route(body.question ?? "", ctx.dir.all()));
    }

    if (p === "/dashboard") {
      return new Response(DASHBOARD_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (p === "/") {
      return Response.json({
        alignOS: true,
        node_id: ctx.selfId,
        app_id: ctx.identity.app_id,
        mode: ctx.identity.mode,
        agents: [...ctx.agents.keys()],
        peers: ctx.dir.all().length,
      });
    }

    // A2A surface (assist-remote). Public for peers; /owner/* requires the Ed25519 owner
    // envelope. /owner/claim is the one unauthenticated owner route (setup-token bootstrap).
    const a2a = { store: ctx.store, policy: ctx.policy, selfId: ctx.selfId };

    const askMatch = p.match(/^\/ask-([a-z0-9-]+)$/i);
    if (askMatch && (req.method === "GET" || req.method === "POST")) {
      return handleAsk(ctx, a2a, req, url, askMatch[1].toLowerCase());
    }

    if (p === "/a2a" && req.method === "POST") {
      return handleA2A(a2a, await req.text(), false);
    }
    if (p === "/owner/claim" && req.method === "POST") {
      const { token, pubkey } = await req.json().catch(() => ({})) as {
        token?: string;
        pubkey?: string;
      };
      return Response.json(claim(token ?? "", pubkey ?? ""));
    }
    if (p === "/owner/a2a" && req.method === "POST") {
      const bodyText = await req.text();
      if (!verifyOwner(req.method, p, bodyText, req.headers)) {
        return new Response("unauthorized", { status: 401 });
      }
      return handleA2A(a2a, bodyText, true);
    }

    const m = p.match(/^\/agents\/([^/]+)(\/.*)?$/);
    if (m) return proxyAgent(ctx, req, url, m[1], m[2] ?? "/");

    return new Response("not found", { status: 404 });
  };
}

async function handleAsk(
  ctx: IngressCtx,
  a2a: { store: TaskStore; policy?: Policy; selfId: string },
  req: Request,
  url: URL,
  handle: string,
): Promise<Response> {
  const self = ctx.getSelfCard();
  const selfHandle = self.owner?.handle?.toLowerCase();
  if (selfHandle !== handle) {
    const peer = ctx.dir.all().find((c) =>
      c.owner?.handle?.toLowerCase() === handle
    );
    if (!peer) {
      return Response.json({ error: `unknown assistant: ${handle}` }, {
        status: 404,
      });
    }
    const target = new URL(url);
    target.protocol = new URL(peer.gateway_url).protocol;
    target.host = new URL(peer.gateway_url).host;
    return Response.redirect(target, 307);
  }

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    body = await req.json().catch(() => ({})) as Record<string, unknown>;
  }
  const mode = String(body.mode ?? url.searchParams.get("mode") ?? "quick")
    .toLowerCase();
  const question = String(
    body.question ?? body.q ?? url.searchParams.get("question") ??
      url.searchParams.get("q") ?? "",
  ).trim();

  if (mode !== "quick" && mode !== "deep") {
    return Response.json({ error: "mode must be quick or deep" }, {
      status: 400,
    });
  }
  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  if (mode === "deep") {
    return Response.json({
      mode,
      owner: self.owner,
      question,
      status: "requires-local-client",
      handoff: "assist-client",
      folder_access: "explicit-per-request",
      message:
        "Deep Mode runs on the owner's local machine; the TEE can suggest scoped access, but the edge enforces approval.",
    });
  }

  const rpc = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ kind: "text", text: question }],
        messageId: crypto.randomUUID(),
      },
      from: {
        node_id: "ask-endpoint",
        agent: `ask-${handle}`,
        display: `ask-${handle}`,
      },
    },
  };
  return handleA2A(a2a, JSON.stringify(rpc), false);
}

async function proxyAgent(
  ctx: IngressCtx,
  req: Request,
  url: URL,
  name: string,
  rest: string,
): Promise<Response> {
  const base = ctx.agents.get(name);
  if (!base) return new Response(`unknown agent: ${name}`, { status: 404 });
  const headers = new Headers(req.headers);
  headers.delete("host");
  const body = req.method === "GET" || req.method === "HEAD"
    ? undefined
    : await req.arrayBuffer();
  const t0 = Date.now();
  const resp = await fetch(base + rest + url.search, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
  });
  await appendEvent("agent_proxy", {
    agent: name,
    status: resp.status,
    ms: Date.now() - t0,
    run_id: crypto.randomUUID(),
  });
  return new Response(resp.body, {
    status: resp.status,
    headers: resp.headers,
  });
}
