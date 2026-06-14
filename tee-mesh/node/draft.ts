// assist-remote: draft the reply Artifact — INSIDE the CVM / on the node.
// Inference uses a LOCAL model CLI when available (claude -p / codex / pi — no API key, the
// daybook pattern), falling back to the Anthropic API, then a placeholder.
// Backend: ALIGN_DRAFT_BACKEND = auto (default → claude) | claude | codex | pi | api.
import { type Artifact, type Task, textOf } from "./inbox.ts";
import { styleExamples } from "./knowledge.ts";

const BACKEND = (Deno.env.get("ALIGN_DRAFT_BACKEND") ?? "auto").toLowerCase();
const MODEL_KEY = Deno.env.get("ANTHROPIC_API_KEY");

export async function draftReply(
  task: Task,
  instruction: string,
): Promise<Artifact> {
  const text = await infer(task, instruction);
  return {
    artifactId: crypto.randomUUID(),
    name: "reply",
    parts: [{ kind: "text", text }],
  };
}

function buildPrompt(
  task: Task,
  instruction: string,
): { system: string; user: string } {
  const ask = textOf(task.history[0]?.parts ?? []);
  const who = task.from.display ?? "another assistant";
  let system =
    "You are the owner's personal assistant. Draft a concise, friendly reply to another " +
    "person's assistant. Plain text only — no preamble, no markdown, no sign-off line. The " +
    "owner will review your draft before it is sent.";
  const examples = styleExamples(6);
  if (examples.length) {
    system +=
      "\n\nHere is how the owner tends to write (their own words — for voice and tone, " +
      "do not quote or reuse the content):\n" + examples.map((e) =>
        `- ${e}`
      ).join("\n");
  }
  const user = instruction
    ? `The request from ${who} was:\n${ask}\n\nThe owner asked you to revise your reply: ${instruction}`
    : `Draft a reply to this request from ${who}:\n${ask}`;
  return { system, user };
}

// Generic single completion across the configured backends. Throws if none produce output.
export async function complete(system: string, user: string): Promise<string> {
  const order = BACKEND === "auto" ? ["claude", "api"] : [BACKEND];
  for (const b of order) {
    try {
      if (b === "claude") {
        return (await runCli(
          "claude",
          ["-p", "--append-system-prompt", system],
          user,
        )).trim();
      }
      if (b === "codex") {
        return (await runCli("codex", [
          "exec",
          "--skip-git-repo-check",
          `${system}\n\n${user}`,
        ], null)).trim();
      }
      if (b === "pi") {
        return (await runCli("pi", ["-p", `${system}\n\n${user}`], null))
          .trim();
      }
      if (b === "api" && MODEL_KEY) return (await callApi(system, user)).trim();
    } catch (_e) { /* fall through to the next backend */ }
  }
  throw new Error("no model backend available");
}

export async function infer(task: Task, instruction: string): Promise<string> {
  const { system, user } = buildPrompt(task, instruction);
  try {
    return await complete(system, user);
  } catch {
    const ask = textOf(task.history[0]?.parts ?? []);
    return `Thanks for reaching out. (placeholder draft — no local model available)\nRe: "${
      ask.slice(0, 160)
    }"`;
  }
}

// Spawn a local CLI; pass the prompt on stdin (claude) or as an arg (codex/pi). Time-bounded.
async function runCli(
  cmd: string,
  args: string[],
  stdinText: string | null,
): Promise<string> {
  const child = new Deno.Command(cmd, {
    args,
    stdin: stdinText == null ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(120_000),
  }).spawn();
  if (stdinText != null) {
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(stdinText));
    await w.close();
  }
  const { code, stdout, stderr } = await child.output();
  // CLIs can emit ANSI/escape control bytes into stdout; strip them (keep \t and \n) so a
  // reply to a peer never carries stray control characters.
  // deno-lint-ignore no-control-regex
  const out = new TextDecoder().decode(stdout).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
  if (code !== 0 || !out) {
    throw new Error(
      `${cmd} exited ${code}: ${
        new TextDecoder().decode(stderr).slice(0, 200)
      }`,
    );
  }
  return out;
}

async function callApi(system: string, user: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": MODEL_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: Deno.env.get("ALIGN_MODEL") ?? "claude-sonnet-4-6",
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`model API ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.content ?? []).filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text).join("\n");
}
