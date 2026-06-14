'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ALIGN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-loop-'));
const store = require('../src/draft-store');
const loop = require('../src/draft-loop');

const tasks = [
  { id: 'a', from: { display: 'X' }, history: [{ parts: [{ kind: 'text', text: 'q1' }] }] },
  { id: 'b', from: { display: 'Y' }, history: [{ parts: [{ kind: 'text', text: 'q2' }] }] },
];
const listInbox = async () => tasks;
const updates = [];
const onUpdate = (id) => updates.push(id);

(async () => {
  // good run: both drafted, stored ready, onUpdate fired
  const okDraft = async (t) => ({ text: 'reply-' + t.id, cli: 'claude' });
  let r = await loop.sweep({ listInbox, onUpdate, runDraft: okDraft });
  assert.strictEqual(r.drafted, 2);
  assert.strictEqual(store.get('a').status, 'ready');
  assert.strictEqual(store.get('a').text, 'reply-a');
  assert.strictEqual(store.get('b').text, 'reply-b');
  assert.ok(updates.includes('a') && updates.includes('b'), 'fired updates');

  // idempotent: ready tasks are not redrafted
  let calls = 0;
  const countDraft = async (t) => { calls++; return { text: 'x', cli: 'claude' }; };
  r = await loop.sweep({ listInbox, onUpdate, runDraft: countDraft });
  assert.strictEqual(r.drafted, 0);
  assert.strictEqual(calls, 0);

  // follow-up revision: pass the existing draft and instruction through to the runner
  let seenOpts = null;
  await loop.draftTask(tasks[0], {
    instruction: 'Make it warmer.',
    runDraft: async (_t, opts) => {
      seenOpts = opts;
      return { text: 'warmer reply', cli: 'claude' };
    },
  });
  assert.strictEqual(seenOpts.instruction, 'Make it warmer.');
  assert.strictEqual(seenOpts.currentDraft, 'reply-a');
  assert.strictEqual(store.get('a').text, 'warmer reply');

  // follow-up can override the stored draft with the currently edited textarea text
  await loop.draftTask(tasks[0], {
    instruction: 'Use the edited version.',
    currentDraft: 'edited in the review textarea',
    runDraft: async (_t, opts) => {
      seenOpts = opts;
      return { text: 'edited reply', cli: 'claude' };
    },
  });
  assert.strictEqual(seenOpts.currentDraft, 'edited in the review textarea');
  assert.strictEqual(store.get('a').text, 'edited reply');

  // error path: stored as error and retried on the next sweep
  store.remove('a'); store.remove('b');
  const badDraft = async () => { throw new Error('cli blew up'); };
  await loop.sweep({ listInbox, onUpdate, runDraft: badDraft });
  assert.strictEqual(store.get('a').status, 'error');
  assert.ok(/cli blew up/.test(store.get('a').error));
  assert.ok(loop.needsDraft('a'), 'errored task is retried');

  // unknown task needs a draft
  assert.ok(loop.needsDraft('never-seen'), 'unknown task needs a draft');

  console.log('draft-loop: OK');
})().catch((e) => { console.error(e); process.exit(1); });
