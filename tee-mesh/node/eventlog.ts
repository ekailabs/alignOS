// Minimal append-only event log (JSONL). hivemind-core's run table proved invaluable for
// forensics; this is the lean version — register / card-change / merge / proxy events.
const PATH = Deno.env.get("ALIGN_EVENTLOG") ?? "./events.jsonl";

export async function appendEvent(type: string, data: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + "\n";
  await Deno.writeTextFile(PATH, line, { append: true });
}
