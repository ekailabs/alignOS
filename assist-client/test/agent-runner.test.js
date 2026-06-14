'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ALIGN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-runner-home-'));
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-bin-'));
const log = path.join(bin, 'args.txt');

function writeStub(body) {
  fs.writeFileSync(path.join(bin, 'claude'), body);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
}
// fake `claude`: record the argv it received, echo a canned reply.
writeStub(`#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(log)}, process.argv.slice(2).join('\\n'));
process.stdout.write('Thursday at 2pm works for me.');
`);
process.env.PATH = bin + path.delimiter + process.env.PATH;

const runner = require('../src/agent-runner');
const task = {
  from: { display: "Devon's assistant" },
  history: [{ role: 'user', parts: [{ kind: 'text', text: 'Are you free Thursday?' }] }],
};

(async () => {
  // detection
  const cli = runner.detectCli({ cli: 'auto' });
  assert.ok(cli && cli.kind === 'claude', 'detects claude on PATH');

  // happy path
  const r = await runner.runDraft(task, { workspace: bin, agent: { cli: 'auto' } });
  assert.strictEqual(r.text, 'Thursday at 2pm works for me.');
  assert.strictEqual(r.cli, 'claude');
  const delivered = fs.readFileSync(log, 'utf8');
  assert.ok(delivered.includes('Are you free Thursday?'), 'question reached the CLI');
  assert.ok(delivered.includes("Devon's assistant"), 'asker reached the CLI');

  // nonzero exit rejects with the exit code
  writeStub(`#!/bin/sh\necho boom 1>&2\nexit 3\n`);
  await assert.rejects(
    runner.runDraft(task, { workspace: bin, agent: { cli: 'auto' } }),
    /exited 3/,
  );

  // timeout kills the process
  writeStub(`#!/bin/sh\nsleep 5\n`);
  const t0 = Date.now();
  await assert.rejects(
    runner.runDraft(task, { workspace: bin, agent: { cli: 'auto' }, timeoutMs: 200 }),
    /timed out/,
  );
  assert.ok(Date.now() - t0 < 4000, 'killed well before the 5s sleep finished');

  // missing CLI rejects clearly
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  await assert.rejects(
    runner.runDraft(task, { workspace: bin, agent: { cli: 'auto' } }),
    /No local agent CLI/,
  );
  process.env.PATH = savedPath;

  console.log('agent-runner: OK');
})().catch((e) => { console.error(e); process.exit(1); });
