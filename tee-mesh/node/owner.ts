// assist-remote: owner authentication.
//   - open first claim: the first client to claim binds its Ed25519 public key (TOFU).
//     Persisted so it survives restarts.
//   - request envelope: every /owner/* request is signed (Ed25519) over a canonical string;
//     verified against the registered owner key, with timestamp skew + nonce replay checks.
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";

const STATE_PATH = Deno.env.get("ALIGN_OWNER_STATE") ?? "./owner.json";
const SKEW_S = 60;

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(s.length / 4) * 4,
    "=",
  );
  const bin = atob(pad);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(h: string): Uint8Array {
  const s = h.replace(/^0x/, "");
  const u = new Uint8Array(s.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16);
  return u;
}
function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

let ownerKey: Uint8Array | null = null;
try {
  const j = JSON.parse(Deno.readTextFileSync(STATE_PATH));
  if (j.ownerPubHex) ownerKey = hexToBytes(j.ownerPubHex);
} catch { /* unclaimed */ }

export function ownerState() {
  return { claimed: !!ownerKey };
}

// Trust-on-first-use: the first client to claim binds its key. Re-claim by the same key is
// idempotent (reconnects work); a different key is rejected once claimed.
export function claim(pubkeyB64: string): { ok: boolean; error?: string } {
  let pk: Uint8Array;
  try {
    pk = b64urlToBytes(pubkeyB64);
  } catch {
    return { ok: false, error: "bad pubkey" };
  }
  if (pk.length !== 32) return { ok: false, error: "bad pubkey length" };
  if (ownerKey) {
    return eq(ownerKey, pk) ? { ok: true } : { ok: false, error: "already claimed by another device" };
  }
  ownerKey = pk;
  try {
    Deno.writeTextFileSync(STATE_PATH, JSON.stringify({ ownerPubHex: hex(pk) }));
  } catch { /* in-memory only */ }
  return { ok: true };
}

const seenNonces = new Map<string, number>();
function rememberNonce(n: string) {
  seenNonces.set(n, Date.now());
  if (seenNonces.size > 5000) {
    const cut = Date.now() - 2 * SKEW_S * 1000;
    for (const [k, t] of seenNonces) if (t < cut) seenNonces.delete(k);
  }
}

// Verify the Ed25519 owner envelope over: method\npath\nsha256hex(body)\ntimestamp\nnonce
export function verifyOwner(
  method: string,
  path: string,
  bodyText: string,
  headers: Headers,
): boolean {
  if (!ownerKey) return false;
  const key = headers.get("x-align-key");
  const tsS = headers.get("x-align-timestamp");
  const nonce = headers.get("x-align-nonce");
  const sigS = headers.get("x-align-signature");
  if (!key || !tsS || !nonce || !sigS) return false;
  let keyBytes: Uint8Array, sigBytes: Uint8Array;
  try {
    keyBytes = b64urlToBytes(key);
    sigBytes = b64urlToBytes(sigS);
  } catch {
    return false;
  }
  if (!eq(keyBytes, ownerKey)) return false;
  const ts = Number(tsS);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SKEW_S) {
    return false;
  }
  if (seenNonces.has(nonce)) return false;
  const bodyHash = hex(sha256(new TextEncoder().encode(bodyText)));
  const canonical = `${method}\n${path}\n${bodyHash}\n${ts}\n${nonce}`;
  let ok = false;
  try {
    ok = ed25519.verify(
      sigBytes,
      new TextEncoder().encode(canonical),
      ownerKey,
    );
  } catch {
    ok = false;
  }
  if (ok) rememberNonce(nonce);
  return ok;
}
