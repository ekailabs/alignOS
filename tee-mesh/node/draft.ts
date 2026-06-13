// assist-remote: draft the reply Artifact for a task — INSIDE the CVM.
// v1 (phase 5) calls a model API with a key provisioned to the CVM. This phase-1 stub
// returns a deterministic placeholder so the full inbox loop is testable without a model.
import { type Task, type Artifact, textOf } from "./inbox.ts";

const MODEL_KEY = Deno.env.get("ANTHROPIC_API_KEY"); // provisioned to the CVM (dstack secret/env)

export async function draftReply(task: Task, instruction: string): Promise<Artifact> {
  const ask = textOf(task.history[0]?.parts ?? []);
  const text = MODEL_KEY
    ? await callModel(task, instruction)
    : `Thanks for reaching out. (placeholder draft — no model key set)\nRe: "${ask.slice(0, 160)}"` +
      (instruction ? `\n[revised per your note: ${instruction}]` : "");
  return { artifactId: crypto.randomUUID(), name: "reply", parts: [{ kind: "text", text }] };
}

// TODO(phase 5): real prompt assembly (notes/knowledge grounding) + streaming.
async function callModel(task: Task, instruction: string): Promise<string> {
  const ask = textOf(task.history[0]?.parts ?? []);
  const sys = "You are the owner's assistant. Draft a concise, friendly reply to another " +
    "person's assistant. Plain text, no preamble. The owner will review before it is sent.";
  const user = instruction
    ? `The current request was:\n${ask}\n\nThe owner asked you to revise the reply: ${instruction}`
    : `Draft a reply to this request from ${task.from.display ?? "another assistant"}:\n${ask}`;
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
      system: sys,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`model API ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n").trim();
}
