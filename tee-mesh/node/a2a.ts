// assist-remote: the A2A JSON-RPC surface (v1 subset).
//   public  (peers):  message/send (create / add input), tasks/get
//   owner   (client): tasks/list, tasks/get, tasks/cancel (decline),
//                      message/send with {finalize|followup} (approve / follow up)
// One POST endpoint per audience; ingress.ts mounts /a2a (public) and /owner/a2a (owner).
import {
  type Task, type Message, type Policy,
  TaskStore, textOf, textMessage, defaultPolicy, appendEvent,
} from "./inbox.ts";
import { draftReply } from "./draft.ts";

export interface A2ACtx { store: TaskStore; policy?: Policy; selfId: string }

interface RpcReq { jsonrpc: "2.0"; id: string | number | null; method: string; params?: any }

const ok = (id: unknown, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } });

export async function handleA2A(ctx: A2ACtx, req: Request, owner: boolean): Promise<Response> {
  let rpc: RpcReq;
  try { rpc = await req.json() as RpcReq; } catch { return rpcErr(null, -32700, "parse error"); }
  const { id, method, params } = rpc;
  try {
    switch (method) {
      case "message/send":
        return ok(id, await onMessageSend(ctx, params, owner));
      case "tasks/get": {
        const t = ctx.store.get(params?.id);
        return t ? ok(id, t) : rpcErr(id, -32001, "task not found");
      }
      case "tasks/list": {
        if (!owner) return rpcErr(id, -32004, "owner only");
        const state = params?.status
          ? (Array.isArray(params.status) ? params.status : [params.status])
          : undefined;
        return ok(id, ctx.store.list(state ? { state } : undefined));
      }
      case "tasks/cancel": {
        if (!owner) return rpcErr(id, -32004, "owner only");
        const t = ctx.store.get(params?.id);
        if (!t) return rpcErr(id, -32001, "task not found");
        t.status = {
          state: "canceled",
          timestamp: new Date().toISOString(),
          message: params?.note ? textMessage("user", String(params.note), t.id, t.contextId) : undefined,
        };
        await ctx.store.put(t);
        await appendEvent("a2a_decline", { task: t.id });
        return ok(id, t);
      }
      default:
        return rpcErr(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    await appendEvent("a2a_error", { method, error: String(e) });
    return rpcErr(id, -32603, String(e));
  }
}

async function onMessageSend(ctx: A2ACtx, params: any, owner: boolean): Promise<Task> {
  const msg = params?.message as Message;
  if (!msg?.parts) throw new Error("message.parts required");

  // ── continuation of an existing task ──
  if (msg.taskId) {
    const t = ctx.store.get(msg.taskId);
    if (!t) throw new Error("unknown taskId");
    t.history.push(msg);

    if (owner) {
      if (params?.followup) {
        // owner asked the assistant to revise → re-draft, back to the inbox
        t.status = { state: "working", timestamp: new Date().toISOString() };
        await ctx.store.put(t);
        t.artifacts = [await draftReply(t, textOf(msg.parts))];
        t.status = {
          state: "input-required",
          timestamp: new Date().toISOString(),
          message: textMessage("agent", "Revised — review again.", t.id, t.contextId),
        };
        await appendEvent("a2a_followup", { task: t.id });
      } else {
        // approve → the current draft (or provided parts) becomes the reply, task completes
        const txt = textOf(msg.parts);
        if (txt.trim()) t.artifacts = [{ artifactId: crypto.randomUUID(), name: "reply", parts: msg.parts }];
        t.status = { state: "completed", timestamp: new Date().toISOString() };
        await appendEvent("a2a_approve", { task: t.id });
      }
    } else {
      // a peer supplied more input → re-draft and surface for review
      t.status = { state: "working", timestamp: new Date().toISOString() };
      await ctx.store.put(t);
      t.artifacts = [await draftReply(t, "")];
      t.status = {
        state: "input-required",
        timestamp: new Date().toISOString(),
        message: textMessage("agent", "Drafted a reply — review.", t.id, t.contextId),
      };
    }
    await ctx.store.put(t);
    return t;
  }

  // ── new inbound task from a peer ──
  const now = new Date().toISOString();
  const t: Task = {
    id: crypto.randomUUID(),
    contextId: msg.contextId ?? crypto.randomUUID(),
    status: { state: "submitted", timestamp: now },
    artifacts: [],
    history: [msg],
    from: { node_id: params?.from?.node_id, agent: params?.from?.agent, display: params?.from?.display },
    created_at: now,
    updated_at: now,
  };
  await ctx.store.put(t);
  await appendEvent("a2a_inbound", { task: t.id, from: t.from.display ?? t.from.node_id ?? "unknown" });

  const decision = (ctx.policy ?? defaultPolicy)(msg, t.from);
  t.status = { state: "working", timestamp: new Date().toISOString() };
  await ctx.store.put(t);
  t.artifacts = [await draftReply(t, "")];

  if (decision === "auto") {
    t.status = { state: "completed", timestamp: new Date().toISOString() };
    await appendEvent("a2a_auto", { task: t.id });
  } else {
    t.status = {
      state: "input-required",
      timestamp: new Date().toISOString(),
      message: textMessage("agent", "Drafted a reply — needs your review.", t.id, t.contextId),
    };
  }
  await ctx.store.put(t);
  return t;
}
