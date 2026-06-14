'use strict';
// Small HTTP client for Phala gateways. Node/Electron fetch can negotiate TLS in a way that
// some dstack gateways reset; forcing TLS 1.2 matches curl and avoids "fetch failed".
const http = require('http');
const https = require('https');

function request(url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      method,
      headers,
      timeout: timeoutMs,
      ...(u.protocol === 'https:' ? { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' } : {}),
    };
    const req = lib.request(u, opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => text,
          json: async () => JSON.parse(text || '{}'),
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`request timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

module.exports = { request };
