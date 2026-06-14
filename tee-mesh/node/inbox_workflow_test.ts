import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";

function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ownerHeaders(
  priv: Uint8Array,
  path: string,
  body: string,
  nonce = crypto.randomUUID(),
): Headers {
  const pub = ed25519.getPublicKey(priv);
  const ts = Math.floor(Date.now() / 1000);
  const bodyHash = hex(sha256(new TextEncoder().encode(body)));
  const canonical = `POST\n${path}\n${bodyHash}\n${ts}\n${nonce}`;
  const sig = ed25519.sign(new TextEncoder().encode(canonical), priv);
  return new Headers({
    "content-type": "application/json",
    "X-Align-Key": b64url(pub),
    "X-Align-Timestamp": String(ts),
    "X-Align-Nonce": nonce,
    "X-Align-Signature": b64url(sig),
  });
}

Deno.test("deep mode ask is buffered in the owner TEE inbox", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_TASKS", `${dir}/tasks.json`);
  Deno.env.set("ALIGN_EVENTLOG", `${dir}/events.jsonl`);
  Deno.env.set("ALIGN_OWNER_STATE", `${dir}/owner.json`);

  const { TaskStore } = await import(`./inbox.ts?test=${crypto.randomUUID()}`);
  const { makeHandler } = await import(
    `./ingress.ts?test=${crypto.randomUUID()}`
  );
  const store = new TaskStore();
  await store.load();

  const handler = makeHandler({
    selfId: "node-albi",
    getSelfCard: () => ({
      node_id: "node-albi",
      gateway_url: "http://localhost:8081",
      pubkey: "pub",
      app_id: "albi",
      owner: { handle: "albi", display_name: "Albi", claimed: true },
      mode: "local",
      version: 1,
      updated_at: new Date().toISOString(),
      agents: [],
    }),
    dir: { all: () => [], merge: () => false },
    agents: new Map(),
    identity: {
      app_id: "albi",
      mode: "local",
      getQuote: () => Promise.resolve({}),
    },
    store,
  } as any);

  const resp = await handler(
    new Request(
      "http://localhost:8081/ask-albi?mode=deep&q=inspect%20the%20repo",
    ),
  );
  if (!resp.ok) throw new Error(`deep ask failed: ${resp.status}`);

  const task = await resp.json();
  if (task.status.state !== "auth-required") {
    throw new Error(`expected auth-required, got ${task.status.state}`);
  }

  const buffered = store.list({ state: ["auth-required"] });
  if (buffered.length !== 1) {
    throw new Error(`expected one buffered task, got ${buffered.length}`);
  }
  if (buffered[0].id !== task.id) {
    throw new Error("buffered task id did not match response");
  }
});

Deno.test("owner request forwards through the user TEE and persists provider response", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_TASKS", `${dir}/tasks.json`);
  Deno.env.set("ALIGN_EVENTLOG", `${dir}/events.jsonl`);
  Deno.env.set("ALIGN_OWNER_STATE", `${dir}/owner.json`);

  const { TaskStore } = await import(`./inbox.ts?test=${crypto.randomUUID()}`);
  const { makeHandler } = await import(
    `./ingress.ts?test=${crypto.randomUUID()}`
  );
  const owner = await import("./owner.ts");
  const store = new TaskStore();
  await store.load();

  const providerSeen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch =
    (async (_input: string | URL | Request, init?: RequestInit) => {
      providerSeen.push(String(init?.body ?? ""));
      return Response.json({
        id: "provider-task",
        status: { state: "completed" },
        artifacts: [{
          artifactId: "provider-artifact",
          name: "reply",
          parts: [{ kind: "text", text: "provider says hello" }],
        }],
      });
    }) as typeof fetch;

  try {
    const handler = makeHandler({
      selfId: "node-albi",
      getSelfCard: () => ({
        node_id: "node-albi",
        gateway_url: "http://localhost:8081",
        pubkey: "pub",
        app_id: "albi",
        owner: { handle: "albi", display_name: "Albi", claimed: true },
        mode: "local",
        version: 1,
        updated_at: new Date().toISOString(),
        agents: [],
      }),
      dir: { all: () => [], merge: () => false },
      agents: new Map(),
      identity: {
        app_id: "albi",
        mode: "local",
        getQuote: () => Promise.resolve({}),
      },
      store,
    } as any);

    const ownerPriv = ed25519.utils.randomPrivateKey();
    const claimed = owner.claim(b64url(ed25519.getPublicKey(ownerPriv)));
    if (!claimed.ok) throw new Error(`claim failed: ${claimed.error}`);

    const body = JSON.stringify({
      question: "ask the provider",
      mode: "quick",
      url: "https://provider.example/ask-provider",
    });
    const resp = await handler(
      new Request("http://localhost:8081/owner/request", {
        method: "POST",
        headers: ownerHeaders(ownerPriv, "/owner/request", body),
        body,
      }),
    );
    if (!resp.ok) throw new Error(`owner request failed: ${resp.status}`);

    const task = await resp.json();
    if (task.status.state !== "completed") {
      throw new Error(`expected completed, got ${task.status.state}`);
    }
    if (task.artifacts?.[0]?.parts?.[0]?.text !== "provider says hello") {
      throw new Error("provider artifact was not persisted on the owner task");
    }
    if (providerSeen.length !== 1) {
      throw new Error(`expected one provider call, got ${providerSeen.length}`);
    }
    const persisted = store.get(task.id);
    if (persisted?.status.state !== "completed") {
      throw new Error(
        "owner TEE store did not persist completed provider task",
      );
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("owner request auto-routes when author is omitted", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_TASKS", `${dir}/tasks.json`);
  Deno.env.set("ALIGN_EVENTLOG", `${dir}/events.jsonl`);
  Deno.env.set("ALIGN_OWNER_STATE", `${dir}/owner.json`);

  const { TaskStore } = await import(`./inbox.ts?test=${crypto.randomUUID()}`);
  const { makeHandler } = await import(
    `./ingress.ts?test=${crypto.randomUUID()}`
  );
  const owner = await import("./owner.ts");
  const store = new TaskStore();
  await store.load();

  let providerUrl = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch =
    (async (input: string | URL | Request) => {
      providerUrl = String(input);
      return Response.json({
        id: "provider-task",
        status: { state: "completed" },
        artifacts: [{
          artifactId: "provider-artifact",
          name: "reply",
          parts: [{ kind: "text", text: "security answer" }],
        }],
      });
    }) as typeof fetch;

  try {
    const handler = makeHandler({
      selfId: "node-albi",
      getSelfCard: () => ({
        node_id: "node-albi",
        gateway_url: "http://localhost:8081",
        pubkey: "pub",
        app_id: "albi",
        owner: { handle: "albi", display_name: "Albi", claimed: true },
        mode: "local",
        version: 1,
        updated_at: new Date().toISOString(),
        agents: [],
      }),
      dir: {
        all: () => [{
          node_id: "node-andrew",
          gateway_url: "https://andrew.example",
          pubkey: "pub",
          app_id: "andrew",
          owner: { handle: "andrew", display_name: "Andrew", claimed: true },
          mode: "tee",
          version: 1,
          updated_at: new Date().toISOString(),
          agents: [{
            name: "andrew",
            url: "https://andrew.example/agents/andrew",
            skills: [{ id: "security", name: "TEE security privacy" }],
          }],
        }],
        merge: () => false,
      },
      agents: new Map(),
      identity: {
        app_id: "albi",
        mode: "local",
        getQuote: () => Promise.resolve({}),
      },
      store,
    } as any);

    const ownerPriv = ed25519.utils.randomPrivateKey();
    const claimed = owner.claim(b64url(ed25519.getPublicKey(ownerPriv)));
    if (!claimed.ok) throw new Error(`claim failed: ${claimed.error}`);

    const body = JSON.stringify({
      question: "How should we handle TEE privacy?",
      mode: "quick",
    });
    const resp = await handler(
      new Request("http://localhost:8081/owner/request", {
        method: "POST",
        headers: ownerHeaders(ownerPriv, "/owner/request", body),
        body,
      }),
    );
    if (!resp.ok) throw new Error(`owner request failed: ${resp.status}`);

    const task = await resp.json();
    if (task.status.state !== "completed") {
      throw new Error(`expected completed, got ${task.status.state}`);
    }
    if (providerUrl !== "https://andrew.example/ask-andrew?mode=quick") {
      throw new Error(`expected routed provider URL, got ${providerUrl}`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
