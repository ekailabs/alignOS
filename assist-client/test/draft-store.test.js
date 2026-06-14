'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point ~/.alignos at a temp dir BEFORE requiring config-backed modules.
process.env.ALIGN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-drafts-'));
const store = require('../src/draft-store');

// starts empty
assert.deepStrictEqual(store.all(), {});
assert.strictEqual(store.get('t1'), null);

// set creates and timestamps
const a = store.set('t1', { status: 'drafting' });
assert.strictEqual(a.status, 'drafting');
assert.ok(a.at, 'stamps `at`');

// set merges into the existing entry
const b = store.set('t1', { status: 'ready', text: 'hello' });
assert.strictEqual(b.status, 'ready');
assert.strictEqual(b.text, 'hello');
assert.strictEqual(store.get('t1').text, 'hello');

// persisted to disk
assert.ok(fs.existsSync(store.DRAFTS));
assert.strictEqual(JSON.parse(fs.readFileSync(store.DRAFTS, 'utf8')).t1.text, 'hello');

// remove
store.remove('t1');
assert.strictEqual(store.get('t1'), null);

console.log('draft-store: OK');
