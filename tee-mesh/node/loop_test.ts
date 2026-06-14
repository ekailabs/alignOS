// tee-mesh/node/loop_test.ts
import { converged, similarity } from "./loop.ts";

// dependency-free assert, matching owner_test.ts's house style
const eq = (a: unknown, b: unknown, m = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
};

Deno.test("similarity: identical = 1, disjoint = 0, partial in-between", () => {
  eq(similarity("hello world", "hello world"), 1);
  eq(similarity("alpha beta", "gamma delta"), 0);
  const s = similarity("the quick brown fox", "the quick brown cat");
  if (!(s > 0 && s < 1)) throw new Error(`expected partial, got ${s}`);
});

Deno.test("converged: identical converges, disjoint does not", () => {
  eq(converged("same text here", "same text here"), true);
  eq(converged("totally one thing", "completely other words"), false);
});
