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

import { runLoop } from "./loop.ts";

Deno.test("runLoop: runs N passes when never converging", async () => {
  let refineCalls = 0;
  const trail = await runLoop({
    passes: 5,
    first: () => Promise.resolve("p1"),
    refine: (_cur, k) => {
      refineCalls++;
      return Promise.resolve(`p${k}`);
    },
    isConverged: () => false,
  });
  eq(trail, ["p1", "p2", "p3", "p4", "p5"]);
  eq(refineCalls, 4);
});

Deno.test("runLoop: stops early on convergence", async () => {
  let refineCalls = 0;
  const trail = await runLoop({
    passes: 6,
    first: () => Promise.resolve("same"),
    refine: () => {
      refineCalls++;
      return Promise.resolve("same");
    },
  });
  eq(trail, ["same", "same"]);
  eq(refineCalls, 1);
});

Deno.test("runLoop: clamps passes to 8", async () => {
  const trail = await runLoop({
    passes: 100,
    first: () => Promise.resolve("x0"),
    refine: (_c, k) => Promise.resolve(`x${k}`),
    isConverged: () => false,
  });
  eq(trail.length, 8);
});
