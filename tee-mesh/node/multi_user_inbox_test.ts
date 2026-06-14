function userCard(handle: string, port: number) {
  const display = handle[0].toUpperCase() + handle.slice(1);
  return {
    node_id: `node-${handle}`,
    gateway_url: `http://localhost:${port}`,
    pubkey: `pub-${handle}`,
    app_id: handle,
    owner: { handle, display_name: display, claimed: true },
    mode: "local" as const,
    version: 1,
    updated_at: new Date().toISOString(),
    agents: [],
  };
}

Deno.test("deep-mode inbox buffering works for each advertised owner service", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_EVENTLOG", `${dir}/events.jsonl`);

  const { makeHandler } = await import(
    `./ingress.ts?test=${crypto.randomUUID()}`
  );

  const cards = [
    userCard("albi", 8081),
    userCard("andrew", 8082),
    userCard("shashank", 8083),
  ];
  const stores = new Map<string, any>();

  for (const card of cards) {
    Deno.env.set("ALIGN_TASKS", `${dir}/${card.app_id}.tasks.json`);
    const { TaskStore } = await import(
      `./inbox.ts?test=${crypto.randomUUID()}`
    );
    const store = new TaskStore();
    await store.load();
    stores.set(card.app_id, store);

    const handler = makeHandler({
      selfId: card.node_id,
      getSelfCard: () => card,
      dir: { all: () => cards, merge: () => false },
      agents: new Map(),
      identity: {
        app_id: card.app_id,
        mode: "local",
        getQuote: () => Promise.resolve({}),
      },
      store,
    } as any);

    const resp = await handler(
      new Request(
        `${card.gateway_url}/ask-${card.owner.handle}?mode=deep&q=needs%20local%20files`,
      ),
    );
    if (!resp.ok) {
      throw new Error(`${card.app_id} deep ask failed: ${resp.status}`);
    }
    const task = await resp.json();
    if (task.status.state !== "auth-required") {
      throw new Error(
        `${card.app_id}: expected auth-required, got ${task.status.state}`,
      );
    }
  }

  for (const card of cards) {
    const inbox = stores.get(card.app_id)!.list({ state: ["auth-required"] });
    if (inbox.length !== 1) {
      throw new Error(
        `${card.app_id}: expected one inbox item, got ${inbox.length}`,
      );
    }
  }
});

Deno.test("ask endpoint honors app_id fallback used by service discovery", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_TASKS", `${dir}/tasks.json`);
  Deno.env.set("ALIGN_EVENTLOG", `${dir}/events.jsonl`);

  const { TaskStore } = await import(`./inbox.ts?test=${crypto.randomUUID()}`);
  const { makeHandler } = await import(
    `./ingress.ts?test=${crypto.randomUUID()}`
  );
  const store = new TaskStore();
  await store.load();

  const handler = makeHandler({
    selfId: "node-unclaimed-demo",
    getSelfCard: () => ({
      node_id: "node-unclaimed-demo",
      gateway_url: "http://localhost:8090",
      pubkey: "pub",
      app_id: "demo-user",
      mode: "local",
      version: 1,
      updated_at: new Date().toISOString(),
      agents: [],
    }),
    dir: { all: () => [], merge: () => false },
    agents: new Map(),
    identity: {
      app_id: "demo-user",
      mode: "local",
      getQuote: () => Promise.resolve({}),
    },
    store,
  } as any);

  const resp = await handler(
    new Request(
      "http://localhost:8090/ask-demo-user?mode=deep&q=buffer%20this",
    ),
  );
  if (!resp.ok) throw new Error(`fallback ask failed: ${resp.status}`);
  if (store.list({ state: ["auth-required"] }).length !== 1) {
    throw new Error("expected fallback /ask-app_id to buffer an inbox task");
  }
});
