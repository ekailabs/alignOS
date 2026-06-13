'use strict';
// Deterministic secret scrubber. Pure, no I/O, never throws. Runs on text before it leaves
// the device. v1 starter detector set; extend as needed. (Standalone — not lifted.)
const BLOCK = '▮';

const DETECTORS = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g,                 // Anthropic / OpenAI-style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,                            // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,                          // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                                      // AWS access key id
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,    // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Fa-f0-9]{40,}\b/g,                                      // long hex secrets
];

function redact(text) {
  if (text == null) return { masked: '', findings: [] };
  let masked = String(text);
  const findings = [];
  for (const re of DETECTORS) {
    masked = masked.replace(re, (m) => {
      findings.push(m.slice(0, 4) + '…');
      return m.slice(0, 3) + BLOCK.repeat(6);
    });
  }
  return { masked, findings };
}

module.exports = { redact, DETECTORS };
