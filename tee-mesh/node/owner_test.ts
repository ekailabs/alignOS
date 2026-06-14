import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";

function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function headersFor(priv: Uint8Array, path: string, body: string, nonce = "nonce-1"): Headers {
  const pub = ed25519.getPublicKey(priv);
  const ts = Math.floor(Date.now() / 1000);
  const bodyHash = hex(sha256(new TextEncoder().encode(body)));
  const canonical = `POST\n${path}\n${bodyHash}\n${ts}\n${nonce}`;
  const sig = ed25519.sign(new TextEncoder().encode(canonical), priv);
  return new Headers({
    "X-Align-Key": b64url(pub),
    "X-Align-Timestamp": String(ts),
    "X-Align-Nonce": nonce,
    "X-Align-Signature": b64url(sig),
  });
}

Deno.test("owner envelope gates owner-only routes", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_OWNER_STATE", `${dir}/owner.json`);
  const owner = await import(`./owner.ts?test=${crypto.randomUUID()}`);

  const path = "/owner/knowledge";
  const body = JSON.stringify({ pairs: [{ prompt: "hello", output: "world" }] });
  const ownerPriv = ed25519.utils.randomPrivateKey();
  const otherPriv = ed25519.utils.randomPrivateKey();

  if (owner.verifyOwner("POST", path, body, headersFor(ownerPriv, path, body))) {
    throw new Error("unclaimed node must reject owner routes");
  }

  const claimed = owner.claim("", b64url(ed25519.getPublicKey(ownerPriv)));
  if (!claimed.ok) throw new Error(`claim failed: ${claimed.error}`);

  if (owner.verifyOwner("POST", path, body, new Headers())) {
    throw new Error("missing headers must be rejected");
  }
  if (owner.verifyOwner("POST", path, body, headersFor(otherPriv, path, body))) {
    throw new Error("wrong owner key must be rejected");
  }
  if (owner.verifyOwner("POST", path, "{}", headersFor(ownerPriv, path, body, "nonce-wrong-body"))) {
    throw new Error("body tampering must be rejected");
  }
  if (!owner.verifyOwner("POST", path, body, headersFor(ownerPriv, path, body, "nonce-ok"))) {
    throw new Error("claimed owner signature should be accepted");
  }
  if (owner.verifyOwner("POST", path, body, headersFor(ownerPriv, path, body, "nonce-ok"))) {
    throw new Error("nonce replay must be rejected");
  }
});

Deno.test("first claim wins and cannot be rebound", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_OWNER_STATE", `${dir}/owner.json`);
  const owner = await import(`./owner.ts?test=${crypto.randomUUID()}`);

  const path = "/owner/knowledge";
  const body = JSON.stringify({ pairs: [{ prompt: "hello", output: "world" }] });
  const firstPriv = ed25519.utils.randomPrivateKey();
  const secondPriv = ed25519.utils.randomPrivateKey();

  const first = owner.claim("", b64url(ed25519.getPublicKey(firstPriv)));
  if (!first.ok) throw new Error(`first claim failed: ${first.error}`);
  if (!owner.verifyOwner("POST", path, body, headersFor(firstPriv, path, body, "nonce-first"))) {
    throw new Error("first claimed key should be accepted");
  }

  const second = owner.claim("", b64url(ed25519.getPublicKey(secondPriv)));
  if (second.ok || second.error !== "already claimed") {
    throw new Error("second claim should be rejected once owner is bound");
  }
  if (!owner.verifyOwner("POST", path, body, headersFor(firstPriv, path, body, "nonce-still-first"))) {
    throw new Error("first key should remain bound");
  }
  if (owner.verifyOwner("POST", path, body, headersFor(secondPriv, path, body, "nonce-second"))) {
    throw new Error("second key should not be accepted");
  }
});
