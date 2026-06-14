// tee-mesh/node/knowledge_test.ts
const eq = (a: unknown, b: unknown, m = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
};

Deno.test("setCorpus stores chains and invalidates the cached profile", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_KNOWLEDGE", `${dir}/knowledge.json`);
  const k = await import(`./knowledge.ts?test=${crypto.randomUUID()}`);

  k.setCachedProfile("OLD PROFILE");
  eq(k.getCachedProfile(), "OLD PROFILE");

  k.setCorpus({
    pairs: [{ prompt: "hi", output: "yo" }],
    chains: [["first prompt here", "now refine it please"]],
  });

  eq(k.getCachedProfile(), null); // invalidated
  eq(k.getChains().length, 1);
  eq(k.knowledgeStats().count, 1);
});
