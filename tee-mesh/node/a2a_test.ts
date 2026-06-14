// tee-mesh/node/a2a_test.ts
import type { Artifact, Task } from "./inbox.ts";

const eq = (a: unknown, b: unknown, m = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(
      `${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
    );
  }
};

function fakeArtifact(text: string): Artifact {
  return { artifactId: "fake", name: "reply", parts: [{ kind: "text", text }] };
}

Deno.test("new auto task uses the injected draftNew and completes", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_TASKS", `${dir}/tasks.json`);
  Deno.env.set("ALIGN_EVENTLOG", `${dir}/events.jsonl`);
  const { TaskStore } = await import(`./inbox.ts?test=${crypto.randomUUID()}`);
  const { handleA2A } = await import(`./a2a.ts?test=${crypto.randomUUID()}`);
  const store = new TaskStore();
  await store.load();

  let calls = 0;
  const ctx = {
    store,
    selfId: "self",
    draftNew: (_t: Task) => {
      calls++;
      return Promise.resolve(fakeArtifact("LOOPED REPLY"));
    },
  };

  const rpc = JSON.stringify({
    jsonrpc: "2.0",
    id: "1",
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ kind: "text", text: "hi" }],
        messageId: "m1",
      },
    },
  });
  const res = await handleA2A(ctx, rpc, false);
  const body = await res.json();

  eq(calls, 1);
  eq(body.result.status.state, "completed");
  eq(body.result.artifacts[0].parts[0].text, "LOOPED REPLY");
});
