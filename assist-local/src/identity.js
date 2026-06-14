'use strict';
// Owner credential: an Ed25519 keypair stored 0600 in ~/.alignos/owner.key (JWK). Signs the
// owner-auth envelope on every /owner request, and claims a node on first connect.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DIR, ensureDir } = require('./config');
const http = require('./http');

const KEY_PATH = path.join(DIR, 'owner.key');

function ensureKey() {
  try { return JSON.parse(fs.readFileSync(KEY_PATH, 'utf8')); } catch { /* generate below */ }
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' }); // { kty:'OKP', crv:'Ed25519', x:<pub>, d:<priv> }
  ensureDir();
  fs.writeFileSync(KEY_PATH, JSON.stringify(jwk), { mode: 0o600 });
  try { fs.chmodSync(KEY_PATH, 0o600); } catch { /* best effort */ }
  return jwk;
}

const pubKeyB64 = () => ensureKey().x;                              // jwk x = public key (base64url)
const privKeyObject = () => crypto.createPrivateKey({ key: ensureKey(), format: 'jwk' });
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Ed25519 owner-auth headers over: method\npath\nsha256hex(body)\ntimestamp\nnonce
function signHeaders(method, pth, bodyText) {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = b64url(crypto.randomBytes(16));
  const canonical = `${method}\n${pth}\n${sha256hex(bodyText)}\n${ts}\n${nonce}`;
  const sig = crypto.sign(null, Buffer.from(canonical), privKeyObject());
  return {
    'X-Align-Key': pubKeyB64(),
    'X-Align-Timestamp': String(ts),
    'X-Align-Nonce': nonce,
    'X-Align-Signature': b64url(sig),
  };
}

// Old-node signals: a build from before the rebind-on-reconnect change. We can't fix the
// remote, so surface a clear, actionable message instead of the raw rejection.
const OLD_NODE = 'This private space is running an older node. Ask the operator to upgrade and restart the TEE node, then connect again.';

// Claim a node on first connect; registers our public key as the owner.
async function claim(url, token = '') {
  const base = url.replace(/\/$/, '');
  let res;
  try {
    res = await http.request(base + '/owner/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: pubKeyB64() }),
    });
  } catch {
    throw new Error("Can't reach that space. Check the address and that it's running.");
  }
  if (res.status === 404) throw new Error(OLD_NODE); // no /owner/claim on the old node
  const j = await res.json().catch(() => ({}));
  if (!j.ok) {
    const e = j.error || `claim failed (HTTP ${res.status})`;
    if (/already claimed|invalid token/i.test(e)) throw new Error(OLD_NODE);
    throw new Error(e);
  }
  return j;
}

module.exports = { ensureKey, pubKeyB64, signHeaders, claim, KEY_PATH };
