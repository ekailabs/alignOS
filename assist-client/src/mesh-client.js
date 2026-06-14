'use strict';
// A2A JSON-RPC client to the owner's private space (assist-remote).
//   public routes (/a2a)        — used to simulate a peer in tests
//   owner routes  (/owner/a2a)  — the human's authenticated surface
// TODO(phase 2): sign the owner envelope (X-Align-Key/Timestamp/Nonce/Signature).
const { load } = require('./config');

let _rid = 0;
const rid = () => Math.random().toString(36).slice(2);

async function rpc(method, params, { owner = false, url } = {}) {
  const base = (url || load().url || 'http://localhost:8080').replace(/\/$/, '');
  const res = await fetch(base + (owner ? '/owner/a2a' : '/a2a'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++_rid, method, params }),
  });
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

// public surface (peer simulation / interop)
const peerAsk = (text, display, url) =>
  rpc('message/send', { message: { role: 'user', parts: [{ kind: 'text', text }], messageId: rid() }, from: { display } }, { url });

module.exports = { rpc, rid, inbox, handled, getTask, approve, followup, decline, peerAsk };
