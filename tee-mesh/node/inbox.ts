// assist-remote: A2A task store + the needs-human policy.
// File-backed JSON for PoC durability without runtime flags (Deno KV is the later swap —
// the TaskStore interface is the seam). One store file per node via ALIGN_TASKS.
import { appendEvent } from "./eventlog.ts";

export type TaskState =
  | "submitted" | "working" | "input-required" | "auth-required"
  | "completed" | "canceled" | "failed" | "rejected";

export type Part = { kind: "text"; text: string } | { kind: "data"; data: unknown };

export interface Message {
  role: "user" | "agent";
  parts: Part[];
  messageId: string;
  taskId?: string;
  contextId?: string;
}

export interface Artifact { artifactId: string; name?: string; parts: Part[] }

export interface Task {
  id: string;
  contextId: string;
  status: { state: TaskState; message?: Message; timestamp: string };
  artifacts: Artifact[];
  history: Message[];
  from: { node_id?: string; agent?: string; display?: string };
  created_at: string;
  updated_at: string;
}

const STORE_PATH = Deno.env.get("ALIGN_TASKS") ?? "./tasks.json";

export class TaskStore {
  private tasks = new Map<string, Task>();
  private listeners = new Set<(t: Task) => void>();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await Deno.readTextFile(STORE_PATH);
      for (const t of JSON.parse(raw) as Task[]) this.tasks.set(t.id, t);
    } catch { /* fresh store */ }
    this.loaded = true;
  }

  private async flush(): Promise<void> {
    await Deno.writeTextFile(STORE_PATH, JSON.stringify([...this.tasks.values()], null, 2));
  }

  get(id: string): Task | undefined { return this.tasks.get(id); }

  list(filter?: { state?: TaskState[] }): Task[] {
    let out = [...this.tasks.values()];
    if (filter?.state) out = out.filter((t) => filter.state!.includes(t.status.state));
    return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async put(t: Task): Promise<void> {
    t.updated_at = new Date().toISOString();
    this.tasks.set(t.id, t);
    await this.flush();
    for (const l of this.listeners) { try { l(t); } catch { /* listener errors never break a write */ } }
  }

  // SSE feed (phase 6). Returns an unsubscribe.
  subscribe(cb: (t: Task) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
export function textOf(parts: Part[]): string {
  return parts.filter((p) => p.kind === "text").map((p) => (p as { text: string }).text).join("\n");
}

export function textMessage(role: "user" | "agent", text: string, taskId?: string, contextId?: string): Message {
  return { role, parts: [{ kind: "text", text }], messageId: crypto.randomUUID(), taskId, contextId };
}

// ── policy: auto-handle vs needs-human ───────────────────────────────────────
// v1 default: everything needs the human. Connections + Auto-handle (phase 8) refine this.
export type Policy = (msg: Message, from: Task["from"]) => "auto" | "input-required";
export const defaultPolicy: Policy = () => "input-required";

export { appendEvent };
