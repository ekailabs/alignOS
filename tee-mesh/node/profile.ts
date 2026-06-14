// tee-mesh/node/profile.ts
// The owner's prompting-style profile, distilled once from their prompt chains and cached
// in knowledge.json. Invalidated whenever the corpus is re-uploaded.
import { complete } from "./draft.ts";
import { getCachedProfile, getChains, setCachedProfile } from "./knowledge.ts";

export async function getStyleProfile(): Promise<string> {
  const cached = getCachedProfile();
  if (cached) return cached;
  const chains = getChains();
  if (!chains.length) return "";
  const sample = chains.slice(0, 12)
    .map((c, i) => `Session ${i + 1} — the owner's prompts in order:\n` + c.map((p) => `  • ${p}`).join("\n"))
    .join("\n\n");
  const system = "You analyze how a person prompts an AI assistant. Be concise and concrete.";
  const user =
    "Below are sequences of one person's prompts within sessions, in order. Describe HOW THEY " +
    "PROMPT: how they open a task, the kinds of follow-up moves they make to refine an answer, " +
    "their tone and level of specificity. 6-10 short bullet points. No preamble.\n\n" + sample;
  try {
    const out = (await complete(system, user)).trim();
    if (out) setCachedProfile(out);
    return out;
  } catch {
    return "";
  }
}
