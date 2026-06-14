'use strict';
// A2A JSON-RPC client to the owner's private space (assist-remote).
//   public routes (/a2a)        — used to simulate a peer in tests
//   owner routes  (/owner/a2a)  — the human's surface, Ed25519-signed (identity.js)
const { load } = require('./config');
const identity = require('./identity');

let _rid = 0;
const rid = () => Math.random().toString(36).slice(2);

async function rpc(method, params, { owner = false, url } = {}) {
  const base = (url || load().url || 'http://localhost:8080').replace(/\/$/, '');
  const pth = owner ? '/owner/a2a' : '/a2a';
  const body = JSON.stringify({ jsonrpc: '2.0', id: ++_rid, method, params });
  const headers = { 'content-type': 'application/json' };
  if (owner) Object.assign(headers, identity.signHeaders('POST', pth, body));
  const res = await fetch(base + pth, { method: 'POST', headers, body });
  if (res.status === 401) throw new Error('not authorized — claim this space first: alignos setup --url <gateway> --token <token>');
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

// owner surface
const inbox = (status = ['input-required', 'auth-required']) =>
  rpc('tasks/list', { status }, { owner: true });
const handled = (status = ['completed', 'canceled', 'rejected']) =>
  rpc('tasks/list', { status }, { owner: true });
const getTask = (id) => rpc('tasks/get', { id }, { owner: true });
const approve = (taskId) =>
  rpc('message/send', { message: { role: 'user', parts: [], messageId: rid(), taskId } }, { owner: true });
const followup = (taskId, text) =>
  rpc('message/send', { message: { role: 'user', parts: [{ kind: 'text', text }], messageId: rid(), taskId }, followup: true }, { owner: true });
const decline = (taskId, note) =>
  rpc('tasks/cancel', { id: taskId, note }, { owner: true });

// owner POST (non-RPC, signed) — e.g. uploading the knowledge corpus.
async function ownerPost(pth, payload, { url } = {}) {
  const base = (url || load().url || 'http://localhost:8080').replace(/\/$/, '');
  const body = JSON.stringify(payload);
  const headers = { 'content-type': 'application/json', ...identity.signHeaders('POST', pth, body) };
  const res = await fetch(base + pth, { method: 'POST', headers, body });
  if (res.status === 401) throw new Error('not authorized — claim this space first: alignos setup --url <gateway> --token <token>');
  return res.json();
}
const uploadKnowledge = (pairs) => ownerPost('/owner/knowledge', { pairs });

// liveness: is the private space (assist-remote) reachable?
async function health(timeoutMs = 3000) {
  const base = (load().url || 'http://localhost:8080').replace(/\/$/, '');
  try {
    const res = await fetch(base + '/', { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, url: base };
  } catch {
    return { ok: false, url: base };
  }
}

// public surface (peer simulation / interop)
const peerAsk = (text, display, url) =>
  rpc('message/send', { message: { role: 'user', parts: [{ kind: 'text', text }], messageId: rid() }, from: { display } }, { url });

module.exports = { rpc, rid, inbox, handled, getTask, approve, followup, decline, uploadKnowledge, health, peerAsk };
