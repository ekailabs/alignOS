'use strict';
// A2A JSON-RPC client to the owner's private space (assist-remote).
//   public routes (/a2a)        — used to simulate a peer in tests
//   owner routes  (/owner/a2a)  — the human's surface, Ed25519-signed (identity.js)
const { load } = require('./config');
const identity = require('./identity');
const http = require('./http');

let _rid = 0;
const rid = () => Math.random().toString(36).slice(2);

async function rpc(method, params, { owner = false, url } = {}) {
  const base = (url || load().url || 'http://localhost:8080').replace(/\/$/, '');
  const pth = owner ? '/owner/a2a' : '/a2a';
  const body = JSON.stringify({ jsonrpc: '2.0', id: ++_rid, method, params });
  const send = () => {
    const headers = { 'content-type': 'application/json' };
    if (owner) Object.assign(headers, identity.signHeaders('POST', pth, body));
    return http.request(base + pth, { method: 'POST', headers, body });
  };
  let res = await send();
  // If the node was claimed by an older install/key, newer assist-remote can rebind on
  // /owner/claim. Repair once automatically so reopening the app doesn't strand users on
  // a fatal "not authorized" inbox screen.
  if (res.status === 401 && owner) {
    await identity.claim(base);
    res = await send();
  }
  if (res.status === 401) throw new Error('not authorized — claim this space first: alignos setup --url <gateway>');
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
// Approve = send the reply. With a locally-drafted reply we send its text as the owner's
// message content; with no text (back-compat) we send empty parts.
const approve = (taskId, text) =>
  rpc('message/send', { message: { role: 'user', parts: text ? [{ kind: 'text', text }] : [], messageId: rid(), taskId } }, { owner: true });
const followup = (taskId, text) =>
  rpc('message/send', { message: { role: 'user', parts: [{ kind: 'text', text }], messageId: rid(), taskId }, followup: true }, { owner: true });
const decline = (taskId, note) =>
  rpc('tasks/cancel', { id: taskId, note }, { owner: true });

// owner POST (non-RPC, signed) — e.g. uploading the knowledge corpus.
async function ownerPost(pth, payload, { url } = {}) {
  const base = (url || load().url || 'http://localhost:8080').replace(/\/$/, '');
  const body = JSON.stringify(payload);
  const send = () => {
    const headers = { 'content-type': 'application/json', ...identity.signHeaders('POST', pth, body) };
    return http.request(base + pth, { method: 'POST', headers, body });
  };
  let res = await send();
  if (res.status === 401) {
    await identity.claim(base);
    res = await send();
  }
  if (res.status === 401) throw new Error('not authorized — claim this space first: alignos setup --url <gateway>');
  return res.json();
}
const uploadKnowledge = (pairs, chains) =>
  ownerPost('/owner/knowledge', chains ? { pairs, chains } : { pairs });
const requestProvider = ({ question, mode = 'quick', owner, url }) =>
  ownerPost('/owner/request', { question, mode, owner, url });

function configuredBase(url, { fallback = true } = {}) {
  const raw = url || load().url || (fallback ? 'http://localhost:8080' : '');
  if (!raw) throw new Error('Connect to your TEE space first.');
  return raw.replace(/\/$/, '');
}

async function getJson(pth, { url, timeoutMs = 3000, fallback = true } = {}) {
  const base = configuredBase(url, { fallback });
  const res = await http.request(base + pth, { timeoutMs });
  if (!res.ok) throw new Error(`${pth}: HTTP ${res.status}`);
  return res.json();
}

// liveness: is the private space (assist-remote) reachable?
async function health(timeoutMs = 3000) {
  const base = (load().url || 'http://localhost:8080').replace(/\/$/, '');
  try {
    const res = await http.request(base + '/', { timeoutMs });
    return { ok: res.ok, url: base };
  } catch {
    return { ok: false, url: base };
  }
}

// public surface (peer simulation / interop)
// node_id carries our Ed25519 public key — the same id the node uses to recognize this
// client (TOFU owner key), so the sender has a stable machine-readable origin, not just a label.
const peerAsk = (text, display, url) =>
  rpc('message/send', { message: { role: 'user', parts: [{ kind: 'text', text }], messageId: rid() }, from: { node_id: identity.pubKeyB64(), agent: 'assist-local', display } }, { url });

const nodeCard = (opts) => getJson('/.well-known/agent-card.json', { ...opts, fallback: false });
const serviceCard = (opts) => getJson('/.well-known/alignos-service.json', { ...opts, fallback: false });
const services = (opts) => getJson('/services', { ...opts, fallback: false });

module.exports = { rpc, rid, inbox, handled, getTask, approve, followup, decline, uploadKnowledge, requestProvider, health, peerAsk, nodeCard, serviceCard, services };
