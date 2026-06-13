// Node identity: rooted in the dstack TEE socket when present, else local-dev fallback.
// node_id = keccak256(app_id:instance_id) — unique per running CVM even when several
// share an app_id (shared app_id => identical derived keys, so pubkey can't tell them apart).
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { keccak256, toBytes, bytesToHex, type Hex } from "viem";

export interface Identity {
  node_id: Hex; // bytes32
  pubkey: Hex; // compressed secp256k1, or local marker
  app_id: string;
  instance_id: string;
  code_id: Hex; // bytes32
  attestation_digest?: Hex;
  mode: "tee" | "local";
  getQuote: (reportData: string) => Promise<unknown>;
}

// HTTP/1.1 over a unix socket — the dstack guest agent speaks JSON-RPC as POST /<Method>.
// Reads are Content-Length/chunked aware and time-bounded: we never block waiting for an
// EOF that a keep-alive server won't send (which would otherwise hang boot forever).
async function dstackRpc(socket: string, method: string, body: unknown): Promise<any> {
  const conn = await Deno.connect({ transport: "unix", path: socket });
  try {
    const payload = JSON.stringify(body ?? {});
    const head =
      `POST /${method} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${new TextEncoder().encode(payload).length}\r\nConnection: close\r\n\r\n`;
    await conn.write(new TextEncoder().encode(head + payload));
    const raw = await readHttp(conn, 8000);
    const sep = raw.indexOf("\r\n\r\n");
    if (sep < 0) throw new Error(`dstack ${method}: no HTTP headers in response`);
    const header = raw.slice(0, sep);
    let bodyText = raw.slice(sep + 4);
    if (/transfer-encoding:\s*chunked/i.test(header)) bodyText = dechunk(bodyText);
    else {
      const m = header.match(/content-length:\s*(\d+)/i);
      if (m) bodyText = bodyText.slice(0, Number(m[1]));
    }
    return JSON.parse(bodyText);
  } finally {
    try { conn.close(); } catch { /* already closed */ }
  }
}

// Read an HTTP response, stopping as soon as it's complete (Content-Length satisfied or
// chunked terminator seen); a per-read timeout is the backstop against a stalled socket.
async function readHttp(conn: Deno.Conn, timeoutMs: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(65536);
  while (true) {
    const n = await Promise.race([
      conn.read(buf),
      new Promise<"t">((res) => setTimeout(() => res("t"), timeoutMs)),
    ]);
    if (n === "t" || n === null) break;
    chunks.push(buf.slice(0, n));
    const raw = new TextDecoder().decode(concat(chunks));
    const sep = raw.indexOf("\r\n\r\n");
    if (sep < 0) continue;
    const header = raw.slice(0, sep);
    if (/transfer-encoding:\s*chunked/i.test(header)) {
      if (/\r\n0\r\n\r\n$/.test(raw)) break;
    } else {
      const m = header.match(/content-length:\s*(\d+)/i);
      if (!m || raw.length - (sep + 4) >= Number(m[1])) break;
    }
  }
  return new TextDecoder().decode(concat(chunks));
}

function concat(arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function dechunk(s: string): string {
  let out = "", i = 0;
  while (i < s.length) {
    const nl = s.indexOf("\r\n", i);
    const size = parseInt(s.slice(i, nl), 16);
    if (!size) break;
    out += s.slice(nl + 2, nl + 2 + size);
    i = nl + 2 + size + 2;
  }
  return out;
}

const nodeIdOf = (s: string): Hex => keccak256(toBytes(s));

export async function getIdentity(): Promise<Identity> {
  const socket = Deno.env.get("DSTACK_SOCKET");
  if (socket) {
    const info = await dstackRpc(socket, "Info", {});
    const app_id: string = info.app_id ?? info.app_name ?? "";
    const instance_id: string = info.instance_id ?? info.tcb_info?.mrtd ?? app_id;
    const keyResp = await dstackRpc(socket, "GetKey", { path: "/alignos/identity", purpose: "identity" });
    const priv = toBytes(("0x" + String(keyResp.key).replace(/^0x/, "")) as Hex).slice(0, 32);
    const pubkey = bytesToHex(secp256k1.getPublicKey(priv, true));
    const quote = await dstackRpc(socket, "GetQuote", { report_data: bytesToHex(toBytes(pubkey)).slice(2).padEnd(128, "0") });
    const attestation_digest = bytesToHex(sha256(toBytes((quote.quote ?? "0x") as Hex)));
    return {
      node_id: nodeIdOf(`${app_id}:${instance_id}`),
      pubkey, app_id, instance_id,
      code_id: keccak256(toBytes(app_id)),
      attestation_digest, mode: "tee",
      getQuote: (rd) => dstackRpc(socket, "GetQuote", { report_data: rd }),
    };
  }
  // local dev: no TEE. Identity comes from env; pubkey is a deterministic local marker.
  const name = Deno.env.get("ALIGN_NODE_ID") ?? "local-node";
  const node_id = nodeIdOf(name);
  const pubkey = (Deno.env.get("ALIGN_PUBKEY") as Hex) ?? (("0x02" + node_id.slice(2)) as Hex);
  return {
    node_id, pubkey, app_id: name, instance_id: name,
    code_id: keccak256(toBytes(name)), mode: "local",
    getQuote: () => Promise.resolve({ error: "no TEE in local mode" }),
  };
}
