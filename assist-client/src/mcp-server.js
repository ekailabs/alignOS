'use strict';

const mc = require('./mesh-client');

const tools = [
  {
    name: 'alignos_ask_provider',
    description: 'Create a durable provider request through the owner TEE.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        mode: { type: 'string', enum: ['quick', 'deep'], default: 'quick' },
        owner: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['question'],
    },
  },
  {
    name: 'alignos_inbox_list',
    description: 'List owner TEE tasks waiting for human or local approval.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'alignos_task_get',
    description: 'Get one durable task from the owner TEE.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function callTool(name, args) {
  switch (name) {
    case 'alignos_ask_provider':
      if (!args.question) throw new Error('question is required');
      if (!args.owner && !args.url) throw new Error('owner or url is required');
      return mc.requestProvider(args);
    case 'alignos_inbox_list':
      return mc.inbox();
    case 'alignos_task_get':
      if (!args.id) throw new Error('id is required');
      return mc.getTask(args.id);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function handle(req) {
  if (req.method === 'initialize') {
    return result(req.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'alignos-client', version: '0.1.0' },
    });
  }
  if (req.method === 'tools/list') return result(req.id, { tools });
  if (req.method === 'tools/call') {
    const value = await callTool(req.params && req.params.name, (req.params && req.params.arguments) || {});
    return result(req.id, {
      content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    });
  }
  if (req.id != null) error(req.id, -32601, `method not found: ${req.method}`);
}

function serve() {
  let buf = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = buf.slice(0, headerEnd).toString('utf8');
      const m = header.match(/content-length:\s*(\d+)/i);
      if (!m) {
        buf = Buffer.alloc(0);
        return;
      }
      const len = Number(m[1]);
      const start = headerEnd + 4;
      const end = start + len;
      if (buf.length < end) return;
      const body = buf.slice(start, end).toString('utf8');
      buf = buf.slice(end);
      Promise.resolve()
        .then(() => handle(JSON.parse(body)))
        .catch((e) => error(null, -32603, e.message || String(e)));
    }
  });
  process.stdin.resume();
}

module.exports = { serve };
