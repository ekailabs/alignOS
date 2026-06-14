// The node's single HTTP surface: self card, peer directory, gossip intake, dstack quote,
// and the reverse-proxy to local agent containers. Cross-CVM agent calls land on /agents/*
// too — agents never reach the outside directly; the node is the sole egress.
import { type NodeCard, serviceFromCard } from "./cards.ts";
import type { Directory } from "./gossip.ts";
import type { Identity } from "./identity.ts";
import { appendEvent } from "./eventlog.ts";
import { handleA2A } from "./a2a.ts";
import { claim, verifyOwner } from "./owner.ts";
import { setCorpus } from "./knowledge.ts";
import {
  type Message,
  type Part,
  type Policy,
  type Task,
  TaskStore,
  textMessage,
} from "./inbox.ts";
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
    // envelope. /owner/claim is the one unauthenticated route for first-owner bootstrap.
    const a2a = { store: ctx.store, policy: ctx.policy, selfId: ctx.selfId };

    const askMatch = p.match(/^\/ask-([a-z0-9-]+)$/i);
    if (askMatch && (req.method === "GET" || req.method === "POST")) {
      return handleAsk(ctx, a2a, req, url, askMatch[1].toLowerCase());
    }

    if (p === "/a2a" && req.method === "POST") {
      return handleA2A(a2a, await req.text(), false);
    }
    if (p === "/owner/claim" && req.method === "POST") {
      const { pubkey } = await req.json().catch(() => ({})) as {
        pubkey?: string;
      };
      return Response.json(claim(pubkey ?? ""));
    }
    if (p === "/owner/a2a" && req.method === "POST") {
      const bodyText = await req.text();
      if (!verifyOwner(req.method, p, bodyText, req.headers)) {
        return new Response("unauthorized", { status: 401 });
      }
      return handleA2A(a2a, bodyText, true);
    }
    if (p === "/owner/knowledge" && req.method === "POST") {
      const bodyText = await req.text();
      if (!verifyOwner(req.method, p, bodyText, req.headers)) {
        return new Response("unauthorized", { status: 401 });
      }
      const body = JSON.parse(bodyText) as {
        pairs?: unknown;
        chains?: unknown;
      };
      return Response.json(setCorpus(body));
    }
    if (p === "/owner/request" && req.method === "POST") {
      const bodyText = await req.text();
      if (!verifyOwner(req.method, p, bodyText, req.headers)) {
        return new Response("unauthorized", { status: 401 });
      }
      const body = JSON.parse(bodyText) as ProviderRequestBody;
      try {
        return Response.json(await requestProvider(ctx, body));
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 400 });
      }
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
  // Service discovery falls back to app_id when operator owner metadata is absent
  // (cards.ts: serviceFromCard). Accept that same fallback here so every node's
  // advertised /ask-<owner> endpoint actually lands in its own durable inbox.
  const selfHandle = (self.owner?.handle ?? self.app_id).toLowerCase();
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
    const t = await createDeepModeTask(a2a.store, {
      question,
      from: {
        node_id: "ask-endpoint",
        agent: `ask-${handle}`,
        display: `ask-${handle}`,
      },
    });
    return Response.json(t);
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

async function createDeepModeTask(
  store: TaskStore,
  opts: { question: string; from: Task["from"] },
): Promise<Task> {
  const now = new Date().toISOString();
  const ask: Message = {
    role: "user",
    parts: [{ kind: "text", text: opts.question }],
    messageId: crypto.randomUUID(),
  };
  const t: Task = {
    id: crypto.randomUUID(),
    contextId: crypto.randomUUID(),
    status: {
      state: "auth-required",
      timestamp: now,
      message: textMessage(
        "agent",
        "Deep Mode needs your local client and scoped approval before it can read files or run local tools.",
      ),
    },
    artifacts: [],
    history: [ask],
    from: opts.from,
    created_at: now,
    updated_at: now,
  };
  t.status.message!.taskId = t.id;
  t.status.message!.contextId = t.contextId;
  await store.put(t);
  await appendEvent("deep_mode_buffered", {
    task: t.id,
    from: t.from.display ?? t.from.node_id ?? "unknown",
  });
  return t;
}

interface ProviderRequestBody {
  question?: unknown;
  mode?: unknown;
  owner?: unknown;
  url?: unknown;
}

async function requestProvider(
  ctx: IngressCtx,
  body: ProviderRequestBody,
): Promise<Task> {
  const question = String(body.question ?? "").trim();
  if (!question) throw new Error("question is required");
  const mode = String(body.mode ?? "quick").toLowerCase();
  if (mode !== "quick" && mode !== "deep") {
    throw new Error("mode must be quick or deep");
  }

  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    contextId: crypto.randomUUID(),
    status: { state: "working", timestamp: now },
    artifacts: [],
    history: [{
      role: "user",
      parts: [{ kind: "text", text: question }],
      messageId: crypto.randomUUID(),
    }],
    from: {
      node_id: ctx.selfId,
      agent: "assist-client",
      display: "You",
    },
    created_at: now,
    updated_at: now,
  };
  await ctx.store.put(task);
  await appendEvent("owner_provider_request_created", { task: task.id, mode });

  let target: URL;
  const explicitUrl = String(body.url ?? "").trim();
  if (explicitUrl) {
    target = new URL(explicitUrl);
  } else {
    const owner = String(body.owner ?? "").trim().toLowerCase();
    if (!owner) throw new Error("owner or url is required");
    const peer = ctx.dir.all().find((c) =>
      c.owner?.handle?.toLowerCase() === owner
    );
    if (!peer) throw new Error(`unknown provider owner: ${owner}`);
    target = new URL(
      `/ask-${owner}?mode=${encodeURIComponent(mode)}`,
      peer.gateway_url,
    );
  }

  try {
    const resp = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, mode }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await resp.json().catch(() => ({
      error: `provider returned HTTP ${resp.status}`,
    }));
    task.artifacts = [{
      artifactId: crypto.randomUUID(),
      name: "provider-response",
      parts: providerParts(payload),
    }];
    task.status = {
      state: resp.ok ? "completed" : "failed",
      timestamp: new Date().toISOString(),
      message: textMessage(
        "agent",
        resp.ok
          ? "Provider response saved."
          : `Provider request failed with HTTP ${resp.status}.`,
        task.id,
        task.contextId,
      ),
    };
    await appendEvent("owner_provider_request_finished", {
      task: task.id,
      provider: target.toString(),
      status: resp.status,
    });
  } catch (e) {
    task.status = {
      state: "failed",
      timestamp: new Date().toISOString(),
      message: textMessage("agent", String(e), task.id, task.contextId),
    };
    await appendEvent("owner_provider_request_failed", {
      task: task.id,
      provider: target.toString(),
      error: String(e),
    });
  }
  await ctx.store.put(task);
  return task;
}

function providerParts(payload: unknown): Part[] {
  const task = payload as {
    artifacts?: Array<{ parts?: Part[] }>;
    status?: { state?: string };
  };
  const first = task?.artifacts?.[0]?.parts;
  if (Array.isArray(first) && first.length) return first;
  return [{ kind: "data", data: payload }];
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
