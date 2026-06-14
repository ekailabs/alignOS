'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSession, userPromptChain } = require('./agent-logs');

function jsonl(rows) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-logs-')), 'session.jsonl');
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n'));
  return file;
}

test('userPromptChain keeps ordered user prompts, drops assistant + short', () => {
  const msgs = [
    { role: 'user', text: 'Design a rate limiter for a multi-tenant API' },
    { role: 'assistant', text: 'Here is a design with token buckets ...' },
    { role: 'user', text: 'ok' }, // too short, dropped
    { role: 'user', text: 'now make it tighter and add the tradeoffs' },
  ];
  const chain = userPromptChain(msgs);
  assert.strictEqual(chain.length, 2);
  assert.ok(chain[0].includes('rate limiter'));
  assert.ok(chain[1].includes('tradeoffs'));
});

test('userPromptChain caps each prompt length and total turns', () => {
  const long = 'x'.repeat(1000);
  const msgs = Array.from({ length: 20 }, () => ({ role: 'user', text: long }));
  const chain = userPromptChain(msgs, { maxLen: 100, maxTurns: 5 });
  assert.strictEqual(chain.length, 5);
  assert.ok(chain[0].length <= 100);
});

test('readSession parses current Codex input_text and output_text parts', () => {
  const file = jsonl([
    { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'rules' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'why only claude?' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex is now counted' }] } },
  ]);
  assert.deepStrictEqual(readSession(file, 'codex'), [
    { role: 'user', text: 'why only claude?' },
    { role: 'assistant', text: 'codex is now counted' },
  ]);
});

test('readSession parses Pi nested message roles and skips tool results', () => {
  const file = jsonl([
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'count pi too' }] } },
    { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'noisy shell output' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'pi is now counted' }] } },
  ]);
  assert.deepStrictEqual(readSession(file, 'pi'), [
    { role: 'user', text: 'count pi too' },
    { role: 'assistant', text: 'pi is now counted' },
  ]);
});
