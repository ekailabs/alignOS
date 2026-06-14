'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { userPromptChain } = require('./agent-logs');

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
