'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ALIGN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-mc-'));
const cfg = require('../src/config');
cfg.save({ url: 'http://localhost:9999' });

// Intercept the outgoing request and avoid needing a real signing key.
const http = require('../src/http');
const identity = require('../src/identity');
identity.signHeaders = () => ({});
let body = null;
http.request = async (_url, opts) => {
  body = JSON.parse(opts.body);
  return { status: 200, ok: true, json: async () => ({ result: { status: { state: 'completed' } } }) };
};

const mc = require('../src/mesh-client');

(async () => {
  await mc.approve('task-1', 'the drafted reply');
  assert.strictEqual(body.method, 'message/send');
  assert.strictEqual(body.params.message.taskId, 'task-1');
  assert.deepStrictEqual(body.params.message.parts, [{ kind: 'text', text: 'the drafted reply' }]);

  await mc.approve('task-2'); // no text → empty parts (back-compat)
  assert.deepStrictEqual(body.params.message.parts, []);

  console.log('mesh-client approve: OK');
})().catch((e) => { console.error(e); process.exit(1); });
