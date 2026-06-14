'use strict';
const $ = (id) => document.getElementById(id);

// API surface: the real IPC bridge inside Electron; a mock with sample data in a plain
// browser (lets the UI render for screenshots/dev without a running node).
const MOCK = (() => {
  const tasks = [
    { id: 't1', from: { display: "Andrew" }, status: { state: 'input-required', timestamp: new Date().toISOString() },
      history: [{ role: 'user', parts: [{ kind: 'text', text: 'Can you share a summary of the Q2 launch retro?' }] }],
      artifacts: [{ parts: [{ kind: 'text', text: "Here's the short version: the rollout hit its date, activation came in 12% over target, and the main friction was onboarding email deliverability.\n\nTop fix next quarter is a warm-up sequence for new sending domains." }] }] },
    { id: 't2', from: { display: "Albi" }, status: { state: 'input-required', timestamp: new Date(Date.now() - 840000).toISOString() },
      history: [{ role: 'user', parts: [{ kind: 'text', text: "What's your availability for a 30-min sync Thursday?" }] }],
      artifacts: [{ parts: [{ kind: 'text', text: 'Thursday afternoon works. 2pm or 3:30pm your time? Want me to send an invite?' }] }] },
    { id: 'h1', from: { display: "Shashank" }, status: { state: 'completed', timestamp: new Date(Date.now() - 5400000).toISOString() },
      history: [{ role: 'user', parts: [{ kind: 'text', text: 'Do you approve reusing your onboarding checklist?' }] }],
      artifacts: [{ parts: [{ kind: 'text', text: 'Yes, go ahead and reuse it. Ping me if you adapt the security section.' }] }] },
    { id: 'h2', from: { display: "Andrew" }, status: { state: 'canceled', timestamp: new Date(Date.now() - 9000000).toISOString() },
      history: [{ role: 'user', parts: [{ kind: 'text', text: 'Can you forward the investor deck?' }] }], artifacts: [] },
  ];
  const mockDrafts = {
    t1: { status: 'ready', text: tasks[0].artifacts[0].parts[0].text, cli: 'claude',
      workspace: '/Users/you/Documents/win26/ekai/alignOS', at: new Date().toISOString() },
    t2: { status: 'drafting', at: new Date().toISOString() },
  };
  return {
    bootstrap: async () => ({ connected: true, onboarded: true, url: 'demo' }),
    setup: async () => ({ ok: true }),
    suggestFolders: async () => [
      { path: '/Users/you/Documents/win26/ekai/alignOS', sessions: 11, lastActive: Date.now() - 3600000, sources: 'agent logs' },
      { path: '/Users/you/Documents/win26/ekai/ekai-gateway', sessions: 23, lastActive: Date.now() - 7 * 86400000, sources: 'agent logs' },
      { path: '/Users/you/Documents/win26/ekai/api-vault', sessions: 17, lastActive: Date.now() - 5 * 86400000, sources: 'agent logs' },
      { path: '/Users/you/Documents/win26/ekai/router-daybook', sessions: 4, lastActive: Date.now() - 3600000, sources: 'claude' },
      { path: '/Users/you/Documents/win26/docs', sessions: 121, lastActive: Date.now() - 3600000, sources: 'agent logs' },
    ],
    grantFolders: async () => ({ ok: true }),
    skipOnboarding: async () => ({ ok: true }),
    seed: async () => ({
      uploaded: 66,
      convos: 42,
      days: 7,
      expertise: 'system design and agent infrastructure',
      bySource: { claude: 40, codex: 15, openclaw: 4, pi: 3, opencode: 2, hermes: 2 },
    }),
    health: async () => ({ ok: true }),
    agentCards: async () => ({
      node: {
        node_id: '0x7d5e9e5b1d1c8a6a',
        gateway_url: 'http://localhost:8080',
        app_id: 'local-node',
        owner: { handle: 'you', display_name: 'You', claimed: true },
        mode: 'local',
        updated_at: new Date().toISOString(),
        version: 3,
        agents: [
          {
            name: 'shashank',
            description: 'System design and agent infrastructure.',
            url: 'http://localhost:8080/agents/shashank',
            skills: [{ name: 'Architecture review' }, { name: 'Agent routing' }],
          },
        ],
      },
      service: {
        owner: { handle: 'you', display_name: 'You', claimed: true },
        endpoints: {
          quick_mode: 'http://localhost:8080/ask-you?mode=quick',
          deep_mode: 'http://localhost:8080/ask-you?mode=deep',
          public_a2a: 'http://localhost:8080/a2a',
          owner_a2a: 'http://localhost:8080/owner/a2a',
        },
        capabilities: { modes: ['quick', 'deep'] },
      },
      services: [
        { node_id: '0xa1b1', owner: { handle: 'albi', display_name: 'Albi', claimed: true },
          gateway_url: 'https://albi-8080.dstack-pha-prod7.phala.network', mode: 'tee',
          capabilities: { modes: ['quick', 'deep'] },
          agents: [{ name: 'albi', description: 'GTM, PMF, and product development.', skills: [{ name: 'GTM' }, { name: 'PMF' }] }] },
        { node_id: '0xand2', owner: { handle: 'andrew', display_name: 'Andrew', claimed: true },
          gateway_url: 'https://andrew-8080.dstack-pha-prod7.phala.network', mode: 'tee',
          capabilities: { modes: ['quick', 'deep'] },
          agents: [{ name: 'andrew', description: 'Confidential compute, privacy, and security.', skills: [{ name: 'TEE' }, { name: 'Privacy' }] }] },
      ],
    }),
    askProvider: async ({ question, owner }) => ({
      status: { state: 'completed' },
      artifacts: [{ parts: [{ kind: 'text', text: `(${owner}) Good question: “${question}”. Here’s how I’d think about it…` }] }],
    }),
    pickFolder: async () => '/Users/you/Documents/example',
    inbox: async () => tasks.filter((t) => ['input-required', 'auth-required'].includes(t.status.state)),
    handled: async () => tasks.filter((t) => ['completed', 'canceled', 'rejected'].includes(t.status.state)),
    show: async (id) => tasks.find((t) => t.id === id),
    approve: async (id, replyText) => {
      const t = tasks.find((t) => t.id === id);
      t.status.state = 'completed';
      if (replyText) t.artifacts = [{ parts: [{ kind: 'text', text: replyText }] }];
      return t;
    },
    drafts: async () => mockDrafts,
    draftGet: async (id) => mockDrafts[id] || null,
    redraft: async (id) => {
      mockDrafts[id] = { status: 'ready', text: 'Locally redrafted reply.', cli: 'claude',
        workspace: '/Users/you/Documents/win26/ekai/alignOS', at: new Date().toISOString() };
      return mockDrafts[id];
    },
    onDraftUpdated: () => {},
    followup: async (id, msg) => {
      mockDrafts[id] = { status: 'ready', text: `Updated draft after follow-up: ${msg}`, cli: 'claude',
        workspace: '/Users/you/Documents/win26/ekai/alignOS', at: new Date().toISOString() };
      return tasks.find((t) => t.id === id);
    },
    decline: async (id) => { const t = tasks.find((t) => t.id === id); t.status.state = 'canceled'; return t; },
  };
})();
const api = window.alignos || MOCK;
const MOCKED = !window.alignos;

const text = (parts) => (parts || []).filter((p) => p.kind === 'text').map((p) => p.text).join('\n');
const initial = (name) => ((name || '').trim()[0] || '?').toUpperCase();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ago = (when) => {
  if (!when) return '';
  const t = typeof when === 'number' ? when : Date.parse(when);
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
};
// Requester name. The node tags unauthenticated public-ask requests with the endpoint
// (e.g. "ask-shashank"); fall back to a neutral label until the real peer identity is recorded.
function whoFrom(t) {
  const d = (t && t.from && (t.from.display || t.from.handle)) || '';
  // "ask-<handle>" / "ask-endpoint" is the RECIPIENT's endpoint, not the sender — so it must not
  // be shown as the asker. Only a real, provided identity is shown; otherwise "Someone".
  if (!d || /^ask-/i.test(d) || /^https?:\/\//i.test(d)) return 'Someone';
  return d;
}

const SECTIONS = ['loading', 'welcome', 'connect', 'consent', 'seeding', 'seeded', 'folders', 'inbox', 'agent-cards', 'ask', 'allclear', 'review', 'prefs', 'error'];
const OUTCOME = { completed: 'Sent', canceled: 'Rejected', rejected: 'Rejected' };
const ONBOARDING = new Set(['loading', 'welcome', 'connect', 'consent', 'seeding', 'seeded']);
let _view = null;
function setView(v) {
  _view = v;
  for (const s of SECTIONS) $(s).hidden = s !== v;
  const onb = ONBOARDING.has(v);
  $('head').hidden = onb;
  document.body.classList.toggle('onb', onb); // center the single card vertically during onboarding
}

const QUOTES = [
  '"Alone we can do so little; together we can do so much." - Helen Keller',
  '"Coming together is a beginning; keeping together is progress; working together is success." - Henry Ford',
  '"The strength of the team is each member; the strength of each member is the team." - Phil Jackson',
  '"Talent wins games, but teamwork wins championships." - Michael Jordan',
  '"None of us is as smart as all of us." - Ken Blanchard',
  '"Coordination is just disagreement that learned some manners."',
  '"An assistant aligned with everyone is aligned with no one, so we start with you."',
  '"A computer once beat me at chess, but it was no match for me at kickboxing." - Emo Philips',
];
const SEED_SOURCES = [
  ['claude', 'Claude'],
  ['codex', 'Codex'],
  ['openclaw', 'OpenClaw'],
  ['pi', 'Pi'],
  ['opencode', 'OpenCode'],
  ['hermes', 'Hermes'],
];

let current = null;
let _spaceUrl = ''; // the space (TEE) URL we're connected to — shown + editable in Preferences
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2200); }
function fail(msg) { $('error-text').textContent = msg || 'Unknown error'; setView('error'); }
function setupErrorMessage(e) {
  const msg = String(e && e.message ? e.message : e || 'Setup failed')
    .replace(/^Error invoking remote method 'setup':\s*/i, '')
    .replace(/^Error:\s*/i, '');
  if (/already claimed by another device/i.test(msg)) {
    return 'This private space is running an older node. Ask the operator to upgrade and restart the TEE node, then connect again.';
  }
  if (/socket hang up|econnreset/i.test(msg)) {
    return 'Could not reach the private space. Check that the URL is complete and the TEE node is running.';
  }
  return msg;
}

// Backend connection indicator (header) — polls the node's liveness.
function setConn(ok) {
  const c = $('conn'); if (!c) return;
  c.classList.toggle('on', ok);
  c.classList.toggle('off', !ok);
  $('conn-label').textContent = ok ? 'Connected' : 'Offline';
}
async function refreshHealth() { try { const h = await api.health(); setConn(!!(h && h.ok)); } catch { setConn(false); } }
let _healthTimer = null;
function startHealthPolling() { refreshHealth(); if (!_healthTimer) _healthTimer = setInterval(refreshHealth, 5000); }

function normalizeBackendUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(text);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${local ? 'http' : 'https'}://${text}`;
  try {
    const u = new URL(withScheme);
    u.pathname = u.pathname.replace(/\/+$/, '');
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function backendBase() {
  return normalizeBackendUrl($('connect-url').value) || 'http://localhost:8080';
}

function refreshBackendPreview() {
  if (!$('ep-base')) return; // infra endpoint map removed in the minimal UI
  const base = backendBase();
  $('ep-base').textContent = base;
  $('ep-base').title = base;
  $('ep-claim').title = `${base}/owner/claim`;
  $('ep-owner').title = `${base}/owner/a2a`;
  $('ep-services').title = `${base}/services`;
  $('ep-ask').title = `${base}/ask-albi?mode=quick`;
}

async function boot() {
  setView('loading');
  try {
    const b = await api.bootstrap();
    if (MOCKED) $('priv').textContent = 'Private · demo';
    _spaceUrl = b.url || '';
    startHealthPolling();
    if (!b.connected) return setView('welcome');
    // Returning session: a restarted/re-keyed space could 401 the inbox. mesh-client auto-repairs
    // that by re-claiming once on a 401 and retrying, so loading straight in is safe.
    await loadInbox(); openFromHash();
  } catch (e) { fail(e.message); }
}

let _moreFolders = [];
function folderRow(f, checked) {
  const li = document.createElement('li');
  li.className = 'frow';
  const why = `${f.sessions || 0} session${f.sessions === 1 ? '' : 's'}${f.lastActive ? ' · ' + ago(f.lastActive) : ''}`;
  li.innerHTML = `<label><input type="checkbox" ${checked ? 'checked' : ''} data-path="${esc(f.path)}">` +
    `<span class="fpath">${esc(f.path.replace(/^\/Users\/[^/]+/, '~'))}</span>` +
    `<span class="fwhy">${esc(why)}</span></label>`;
  return li;
}
async function openFolders() {
  setView('folders');
  let list = [];
  try { list = await api.suggestFolders(); } catch (e) { /* show empty list, still usable */ }
  const ul = $('folders-list'); ul.innerHTML = '';
  list.slice(0, 6).forEach((f) => ul.appendChild(folderRow(f, false))); // suggestions only — opt-in, nothing pre-granted
  _moreFolders = list.slice(6);
  $('folders-more').hidden = _moreFolders.length === 0;
  $('folders-more').textContent = `＋ ${_moreFolders.length} more folders`;
}

// Onboarding step 3: seed the private space with the redacted prompt/output corpus, then enter.
let _quoteTimer = null, _qi = 0;
function rotateQuote() {
  const el = $('seed-quote'); if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => { el.textContent = QUOTES[_qi % QUOTES.length]; el.style.opacity = '1'; _qi++; }, 350);
}
function renderSeedSources(bySource, targetId = 'seed-sources') {
  const el = $(targetId); if (!el) return; el.innerHTML = '';
  for (const [key, label] of SEED_SOURCES) {
    const n = bySource ? (bySource[key] || 0) : null;
    const s = document.createElement('span');
    s.className = 'src' + (bySource ? (n > 0 ? ' on' : ' none') : '');
    s.innerHTML = `<span class="sm">✓</span>${esc(label)}${n ? ` · ${n}` : ''}`;
    el.appendChild(s);
  }
}
async function seedAndEnter() {
  setView('seeding');
  _qi = 0; rotateQuote(); renderSeedSources(null);
  if (!_quoteTimer) _quoteTimer = setInterval(rotateQuote, 3000);
  let res = null;
  try { res = await api.seed(); } catch (e) { /* non-fatal — still show the confirmation */ }
  clearInterval(_quoteTimer); _quoteTimer = null;
  // Confirmation screen: tell the owner exactly what landed in their private space.
  const n = res && Number.isFinite(res.convos) ? res.convos : 0;
  $('seeded-count').textContent = n
    ? `${n.toLocaleString()} agent conversation${n === 1 ? '' : 's'}`
    : 'Your agent conversations';
  const domain = res && res.expertise;
  $('seeded-domain').textContent = domain || '';
  $('seeded-expertise').hidden = !domain;
  renderSeedSources(res && res.bySource, 'seeded-sources');
  setView('seeded');
}

// Deep-link to a specific request, e.g. from a notification: index.html#open=<taskId>
function openFromHash() {
  const h = location.hash || '';
  if (h === '#welcome') return setView('welcome');
  if (h === '#consent') { setView('consent'); $('leaves').hidden = false; return; }
  if (h === '#seeding') {
    setView('seeding'); _qi = 0; rotateQuote();
    renderSeedSources({ claude: 40, codex: 15, openclaw: 4, pi: 3, opencode: 2, hermes: 2 });
    $('seed-progress').textContent = 'Seeded 66 prompt/output pairs from the last 7 days.';
    return;
  }
  if (h === '#folders') return openFolders();
  if (h === '#cards') return loadAgentCards();
  if (h === '#handled') return loadHandled();
  if (h === '#prefs') return openPrefs();
  const m = h.match(/^#open=(.+)/);
  if (m) openReview(decodeURIComponent(m[1]));
}

function draftChip(d) {
  const map = { drafting: ['dchip drafting', 'Drafting…'], ready: ['dchip ready', 'Draft ready'], error: ['dchip error', 'Draft failed'] };
  const c = d && map[d.status];
  return c ? `<span class="${c[0]}">${esc(c[1])}</span>` : '';
}

// Demo samples (Shashank's domain) so approve / reject / follow-up is always demoable, even when
// the connected space has no pending requests. Sample ids start with "demo-"; actions resolve
// locally (no node call) and move the item into History.
const _t = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const _ws = '/Users/sha/Documents/win26/ekai/alignOS';
let _demoInbox = [
  { id: 'demo-1', mode: 'quick', from: { display: 'Andrew' }, status: { state: 'input-required', timestamp: _t(6) },
    history: [{ role: 'user', parts: [{ kind: 'text', text: 'How would you design a rate limiter for a multi-tenant API?' }] }],
    _draft: { status: 'ready', cli: 'claude', workspace: _ws,
      text: 'I’d rate-limit per tenant, not per IP: a token bucket keyed on (tenant_id, route_class), with a small global ceiling so one noisy tenant can’t starve the rest. Keep counters in Redis with a sliding window and return Retry-After so clients back off cleanly. Start simple, add per-plan tiers once we see real traffic shapes.' } },
  { id: 'demo-2', mode: 'quick', from: { display: 'Albi' }, status: { state: 'input-required', timestamp: _t(41) },
    history: [{ role: 'user', parts: [{ kind: 'text', text: 'Message queue or direct RPC for agent-to-agent calls?' }] }],
    _draft: { status: 'ready', cli: 'claude', workspace: _ws,
      text: 'Default to direct RPC where the caller needs an answer now: simpler to reason about and debug. Put a queue in front only for fan-out, retries, or genuinely async work. For our mesh, a thin RPC layer with idempotency keys covers most of it; reach for a queue when we actually hit backpressure.' } },
  { id: 'demo-3', mode: 'deep', from: { display: 'Shashank' }, status: { state: 'input-required', timestamp: _t(180) },
    history: [{ role: 'user', parts: [{ kind: 'text', text: 'How should the agent routing layer scale as we add nodes?' }] }],
    _draft: { status: 'ready', cli: 'claude', workspace: _ws,
      text: 'Keep membership on-chain as the source of truth and gossip the rich cards, so any node resolves a peer without a central registry. Cache directories locally with short TTLs and keep routing decisions stateless so nodes scale horizontally. The hard part is liveness: lean on last-seen plus backoff rather than a heartbeat service.' } },
];
let _demoHandled = [];
const isDemo = (id) => /^demo-/.test(id);
const demoTask = (id) => _demoInbox.concat(_demoHandled).find((t) => t.id === id);
const showTask = (id) => (isDemo(id) ? Promise.resolve(demoTask(id)) : api.show(id));
const getDraft = (id) => (isDemo(id) ? Promise.resolve((demoTask(id) || {})._draft || null)
  : (api.draftGet ? api.draftGet(id).catch(() => null) : Promise.resolve(null)));
function demoResolve(id, state, replyText) {
  const i = _demoInbox.findIndex((t) => t.id === id); if (i < 0) return;
  const t = _demoInbox.splice(i, 1)[0];
  t.status = { state, timestamp: new Date().toISOString() };
  const body = replyText != null && replyText !== '' ? replyText : (t._draft && t._draft.text);
  if (state === 'completed' && body) t.artifacts = [{ parts: [{ kind: 'text', text: body }] }];
  _demoHandled.unshift(t);
}
function setTabUI(tab) {
  const ti = $('tab-inbox'), th = $('tab-history');
  if (ti) ti.classList.toggle('on', tab === 'inbox');
  if (th) th.classList.toggle('on', tab === 'history');
  if ($('inbox-ask')) $('inbox-ask').hidden = tab !== 'inbox';
}
// Quick = auto-answered in the TEE; Deep = needs local file access + approval. Shown as a chip.
function taskMode(t) {
  const m = (t && (t.mode || (t.metadata && t.metadata.mode)) || '').toString().toLowerCase();
  if (m === 'deep' || m === 'quick') return m;
  // Infer for nodes that don't persist mode yet: Deep Mode buffers a task as auth-required;
  // everything else is quick (auto-answered in the TEE).
  return (t && t.status && t.status.state === 'auth-required') ? 'deep' : 'quick';
}
function modeTag(t) {
  const m = taskMode(t);
  return m ? `<span class="mode-tag ${m}">${m}</span>` : '';
}
function renderRows(tasks, draftMap, kind) {
  const ul = $('inbox-list'); ul.innerHTML = '';
  for (const t of tasks) {
    const who = whoFrom(t);
    const d = isDemo(t.id) ? t._draft : (draftMap && draftMap[t.id]);
    const right = kind === 'history'
      ? `<span class="ago">${esc(OUTCOME[t.status.state] || t.status.state)} · ${esc(ago(t.status.timestamp))}</span>`
      : `${draftChip(d)}<span class="ago">${esc(ago(t.status.timestamp))}</span>`;
    const li = document.createElement('li');
    li.className = 'row';
    li.innerHTML = `<span class="av">${esc(initial(who))}</span><span class="rmain">` +
      `<span class="rtop"><span class="who">${esc(who)}</span>${modeTag(t)}${right}</span>` +
      `<span class="ask">${esc(text(t.history && t.history[0] && t.history[0].parts))}</span></span>`;
    li.addEventListener('click', () => openReview(t.id));
    ul.appendChild(li);
  }
}
async function loadInbox() {
  try {
    let tasks = await api.inbox();
    if (!tasks.length) tasks = _demoInbox; // demo fallback so the review flow is always demoable
    setView('inbox'); setTabUI('inbox');
    $('inbox-sub').textContent = tasks.length
      ? `${tasks.length} request${tasks.length > 1 ? 's' : ''} need you`
      : 'Nothing needs your call right now.';
    const draftMap = api.drafts ? await api.drafts().catch(() => ({})) : {};
    renderRows(tasks, draftMap, 'inbox');
  } catch (e) { fail(e.message); }
}
async function loadHistory() {
  try {
    let tasks = await api.handled().catch(() => []);
    tasks = _demoHandled.concat(tasks); // include resolved demo samples
    setView('inbox'); setTabUI('history');
    $('inbox-sub').textContent = tasks.length
      ? 'What your assistant has sent or declined on your behalf, with you in the loop.'
      : 'No history yet.';
    renderRows(tasks, null, 'history');
  } catch (e) { fail(e.message); }
}

async function openPrefs() {
  const i = $('prefs-url-input'); if (i) i.value = _spaceUrl || '';
  $('prefs-conn').textContent = '';
  setView('prefs');
  const pc = $('profile-card');
  if (pc) {
    pc.innerHTML = '<div class="spinner small-spin"></div>';
    try { const { node, service } = await api.agentCards(); pc.innerHTML = renderProfileCard(node, service); hydrateAvatars(pc); }
    catch { pc.innerHTML = '<div class="prefs-note">Connect to a space to see your agent card.</div>'; }
  }
}
const loadHandled = loadHistory; // History now lives as a tab inside the Inbox screen

const shortId = (s) => {
  const text = String(s || '');
  return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
};

function skillNames(skills) {
  if (!Array.isArray(skills)) return [];
  return skills.map((s) => {
    if (typeof s === 'string') return s;
    return s && (s.name || s.title || s.id);
  }).filter(Boolean).slice(0, 4);
}

function endpointRows(endpoints) {
  return Object.entries(endpoints || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `<div class="endpoint-row"><span>${esc(key.replace(/_/g, ' '))}</span><code title="${esc(value)}">${esc(value)}</code></div>`)
    .join('');
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url || '').replace(/^https?:\/\//, '').split('/')[0]; } };
// An agent's description/expertise, sourced from its published agent card (carried on the TEE
// service entry as `agents`). Falls back to skill names, then the capability summary.
function agentDesc(service) {
  const a = Array.isArray(service.agents) && service.agents[0];
  if (a && a.description) return a.description;
  const skills = a ? skillNames(a.skills) : [];
  if (skills.length) return skills.join(', ');
  return (service.capabilities && service.capabilities.quick) || '';
}

// Per-owner avatar images (keyed by handle). Falls back to the letter avatar when there's no
// image or it fails to load. CSP-safe: we preload via Image() and only swap on success.
const AVATARS = { shashank: 'assets/shashank.png', andrew: 'assets/andrew.png', albi: 'assets/albi.png' };
const avatarSrc = (key) => AVATARS[String(key || '').toLowerCase()] || '';
function avatarTag(name, handle) {
  return `<span class="av" data-avatar="${esc(String(handle || name || '').toLowerCase())}">${esc(initial(name))}</span>`;
}
function hydrateAvatars(root) {
  (root || document).querySelectorAll('.av[data-avatar]').forEach((el) => {
    if (el.classList.contains('av-img')) return;
    const src = avatarSrc(el.getAttribute('data-avatar'));
    if (!src) return;
    const img = new Image();
    img.onload = () => { el.classList.add('av-img'); el.style.backgroundImage = `url("${src}")`; el.textContent = ''; };
    img.src = src;
  });
}

function renderAgentCard(agent) {
  const skills = skillNames(agent.skills);
  return `<li class="agent-card-item">
    <div class="agent-card-top">
      <span class="av">${esc(initial(agent.name))}</span>
      <span class="agent-card-title"><b>${esc(agent.name || 'Unnamed agent')}</b><span>${esc(agent.description || 'No description published.')}</span></span>
    </div>
    ${skills.length ? `<div class="tag-row">${skills.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>` : ''}
    <code class="url-line" title="${esc(agent.url || '')}">${esc(agent.url || 'No gateway URL')}</code>
  </li>`;
}

function renderServiceCard(service) {
  const owner = service.owner || {};
  const name = owner.display_name || owner.handle || service.app_id || 'Unknown agent';
  const modes = service.capabilities && Array.isArray(service.capabilities.modes) ? service.capabilities.modes : [];
  const desc = agentDesc(service);
  const handle = (owner.handle || name || '').toLowerCase();
  return `<li class="agent-card-item" data-ask="${esc(handle)}" data-name="${esc(name)}">
    <div class="agent-card-top">
      ${avatarTag(name, owner.handle)}
      <span class="agent-card-title"><b>${esc(name)}</b></span>
      ${modes.length ? `<span class="modes-inline">${modes.map((m) => esc(m)).join(' · ')}</span>` : ''}
    </div>
    <p class="agent-desc">${esc(desc || 'Assistant in this space’s mesh.')}</p>
    <div class="agent-card-foot">
      <code class="url-line" title="${esc(service.gateway_url || '')}">${esc(hostOf(service.gateway_url))}</code>
      <button class="btn small primary card-ask" data-ask="${esc(handle)}" data-name="${esc(name)}">Ask ${esc(name)} →</button>
    </div>
  </li>`;
}

// The owner's OWN node card — shown under Preferences › Profile, not in the Known Agents list.
function renderProfileCard(node, service) {
  const cardNode = node || {}; const svc = service || {}; const owner = cardNode.owner || svc.owner || {};
  return `<div class="profile-head">${avatarTag(owner.display_name || owner.handle, owner.handle)}
    <div><b>${esc(owner.display_name || owner.handle || 'Unclaimed')}</b><span class="profile-handle">@${esc(owner.handle || 'you')}</span></div></div>
  <div class="node-main">
    <div><span class="node-label">Owner</span><b>${esc(owner.display_name || owner.handle || 'Unclaimed')}</b></div>
    <div><span class="node-label">Node</span><code title="${esc(cardNode.node_id || '')}">${esc(shortId(cardNode.node_id))}</code></div>
    <div><span class="node-label">Gateway</span><code title="${esc(cardNode.gateway_url || '')}">${esc(hostOf(cardNode.gateway_url))}</code></div>
    <div><span class="node-label">Mode</span><b>${esc(cardNode.mode || 'local')}</b></div>
    <div><span class="node-label">Attestation</span><code title="${esc(cardNode.attestation_digest || '')}">${esc(cardNode.attestation_digest ? shortId(cardNode.attestation_digest) : 'local mode')}</code></div>
    <div><span class="node-label">Updated</span><b>${esc(ago(cardNode.updated_at))}</b></div>
  </div>`;
}

async function loadAgentCards() {
  try {
    setView('agent-cards');
    $('cards-service-list').innerHTML = '<li class="cards-loading"><div class="spinner small-spin"></div></li>';
    $('cards-empty').hidden = true;

    const { node, services } = await api.agentCards();
    const cardNode = node || {};
    const selfHandle = (cardNode.owner && cardNode.owner.handle || '').toLowerCase();
    const selfId = cardNode.node_id;

    // Known Agents = everyone in this space's mesh EXCEPT the owner who's logged in.
    const others = (Array.isArray(services) ? services : []).filter((s) => {
      const h = (s.owner && s.owner.handle || '').toLowerCase();
      if (selfId && s.node_id === selfId) return false;
      if (selfHandle && h && h === selfHandle) return false;
      return true;
    });
    $('cards-sub').textContent = others.length
      ? 'Reach any of them directly. Each replies in its owner’s voice.'
      : 'Assistants you can reach in this space.';
    $('cards-service-list').innerHTML = others.map(renderServiceCard).join('');
    hydrateAvatars($('cards-service-list'));
    $('cards-empty').hidden = others.length > 0;
  } catch (e) { fail(e.message); }
}

// Ask a Known Agent a question (A2A quick mode → answered in that owner's voice via their TEE).
let _askTarget = null;
function taskReplyText(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  const fromArtifacts = res.artifacts && res.artifacts[0] && text(res.artifacts[0].parts);
  if (fromArtifacts) return fromArtifacts;
  const msg = res.status && res.status.message;
  if (msg && msg.parts) return text(msg.parts);
  if (res.reply || res.answer) return res.reply || res.answer;
  return '';
}
function openAsk(handle, name, desc) {
  _askTarget = { handle, name: name || handle };
  $('ask-who').textContent = _askTarget.name;
  $('ask-desc').textContent = desc || '';
  $('ask-desc').hidden = !desc;
  $('ask-text').value = '';
  $('ask-reply').hidden = true; $('ask-reply-lbl').hidden = true; $('ask-prov').hidden = true;
  setView('ask');
  $('ask-text').focus();
}
async function sendAsk() {
  const q = $('ask-text').value.trim();
  if (!q || !_askTarget) return;
  const btn = $('ask-send');
  btn.disabled = true; btn.textContent = 'Asking…';
  try {
    const res = await api.askProvider({ question: q, mode: 'quick', owner: _askTarget.handle });
    const reply = taskReplyText(res);
    $('ask-reply').textContent = reply || `Sent to ${_askTarget.name}. Their assistant is drafting a reply. Check back shortly.`;
    $('ask-reply').classList.toggle('ask-reply-empty', !reply);
    $('ask-reply').hidden = false; $('ask-reply-lbl').hidden = false;
    $('ask-prov').textContent = `Answered by ${_askTarget.name}’s assistant in quick mode, inside their private space.`;
    $('ask-prov').hidden = false;
  } catch (e) {
    $('ask-reply').textContent = `Couldn’t reach ${_askTarget.name}: ${(e && e.message) || e}`;
    $('ask-reply').classList.add('ask-reply-empty');
    $('ask-reply').hidden = false; $('ask-reply-lbl').hidden = false;
  }
  btn.disabled = false; btn.textContent = 'Ask →';
}

async function sendInboxAsk() {
  const q = $('inbox-ask-text').value.trim();
  if (!q) return;
  const owner = $('inbox-ask-author').value.trim().replace(/^@/, '').toLowerCase();
  const btn = $('inbox-ask-send');
  const box = $('inbox-ask-reply');
  btn.disabled = true; btn.textContent = 'Asking…';
  box.hidden = true; box.classList.remove('error');
  try {
    const payload = { question: q, mode: 'quick' };
    if (owner) payload.owner = owner;
    const res = await api.askProvider(payload);
    const reply = taskReplyText(res);
    box.textContent = reply || (owner ? `Sent to ${owner}.` : 'Routed and sent.');
    box.hidden = false;
    $('inbox-ask-text').value = '';
  } catch (e) {
    box.textContent = (e && e.message) || String(e);
    box.classList.add('error');
    box.hidden = false;
  }
  btn.disabled = false; btn.textContent = 'Ask →';
}

// Show the draft for a non-terminal task: prefer the local overlay draft (editable when ready);
// fall back to the remote artifact when there's no local draft.
function renderDraft(t, d, who) {
  const editEl = $('rv-draft-edit'), staticEl = $('rv-draft');
  const remote = text(t.artifacts && t.artifacts[0] && t.artifacts[0].parts);
  $('rv-draft-actions').hidden = false;
  $('rv-consequence').innerHTML = `Approving <b>sends this reply to ${esc(who)}</b>.`;
  $('rv-approve').disabled = false;

  if (d && d.status === 'drafting') {
    editEl.hidden = true; staticEl.hidden = false;
    $('rv-lbl').textContent = 'Drafting locally…';
    staticEl.textContent = 'Your local agent is writing a reply in your workspace…';
    $('rv-prov').textContent = '';
    $('rv-approve').disabled = true;
    return;
  }
  if (d && d.status === 'ready') {
    staticEl.hidden = true; editEl.hidden = false;
    editEl.value = d.text;
    const ws = d.workspace ? d.workspace.replace(/^\/Users\/[^/]+/, '~') : 'your workspace';
    $('rv-lbl').textContent = 'Drafted reply (editable)';
    $('rv-prov').textContent = `Drafted locally by ${d.cli || 'your agent'} in ${ws}. Raw local files weren’t sent.`;
    return;
  }
  if (d && d.status === 'error') {
    editEl.hidden = true; staticEl.hidden = false;
    $('rv-lbl').textContent = 'Draft';
    staticEl.textContent = remote || '(local draft failed. Redraft to try again.)';
    $('rv-prov').textContent = `Local draft failed: ${d.error || 'unknown error'}`;
    $('rv-approve').disabled = !remote;
    return;
  }
  // no local draft → existing remote-artifact behavior
  editEl.hidden = true; staticEl.hidden = false;
  $('rv-lbl').textContent = 'Your assistant drafted a reply';
  staticEl.textContent = remote || '(no draft yet)';
  $('rv-prov').textContent = 'Drafted in your private space. Raw local files weren’t sent.';
}

async function openReview(id) {
  try {
    const t = await showTask(id); current = t;
    const who = whoFrom(t);
    $('rv-who').textContent = who;
    $('rv-age').textContent = ago(t.status.timestamp);
    const _m = taskMode(t); // show quick/deep instead of a generic "connected" chip when known
    const _chip = $('rv-chip');
    if (_m) { _chip.textContent = _m === 'deep' ? 'deep mode' : 'quick mode'; _chip.className = `mode-tag ${_m}`; }
    else { _chip.textContent = 'Connected'; _chip.className = 'chip'; }
    _chip.hidden = false;
    $('rv-ask').textContent = text(t.history && t.history[0] && t.history[0].parts);
    $('rv-compose').hidden = true; $('rv-compose-text').value = ''; $('rv-followup').classList.remove('on');

    const terminal = ['completed', 'canceled', 'rejected'].includes(t.status.state);
    $('rv-actions').hidden = terminal;
    if (terminal) {
      $('rv-draft-edit').hidden = true; $('rv-draft').hidden = false; $('rv-draft-actions').hidden = true;
      const sent = t.status.state === 'completed';
      $('rv-lbl').textContent = 'Drafted reply';
      $('rv-draft').textContent = sent ? (text(t.artifacts && t.artifacts[0] && t.artifacts[0].parts) || '(no reply)') : '(rejected, nothing was sent)';
      $('rv-prov').textContent = '';
      $('rv-consequence').innerHTML = `<b>${sent ? 'Sent ✓' : 'Rejected'}</b> · ${esc(ago(t.status.timestamp))}`;
    } else {
      const d = await getDraft(id);
      renderDraft(t, d, who);
    }
    setView('review');
  } catch (e) { fail(e.message); }
}

function wire() {
  refreshBackendPreview();
  $('connect-url').addEventListener('input', refreshBackendPreview);
  $('welcome-start').addEventListener('click', () => { setView('connect'); refreshBackendPreview(); });
  $('connect-go').addEventListener('click', async () => {
    const url = normalizeBackendUrl($('connect-url').value);
    if (!url) { $('connect-err').textContent = 'Enter a valid space address.'; $('connect-err').hidden = false; return; }
    try { await api.setup({ url }); _spaceUrl = url; $('connect-err').hidden = true; setView('consent'); }
    catch (e) { $('connect-err').textContent = setupErrorMessage(e); $('connect-err').hidden = false; }
  });
  $('consent-approve').addEventListener('click', seedAndEnter);
  $('consent-skip').addEventListener('click', loadInbox);
  $('seeded-go').addEventListener('click', loadInbox);
  $('consent-info').addEventListener('click', () => { const l = $('leaves'); l.hidden = !l.hidden; });
  $('open-inbox').addEventListener('click', loadInbox);
  $('tab-inbox').addEventListener('click', loadInbox);
  $('tab-history').addEventListener('click', loadHistory);
  $('inbox-ask-send').addEventListener('click', sendInboxAsk);
  $('open-cards').addEventListener('click', loadAgentCards);
  $('cards-back').addEventListener('click', loadInbox);
  $('cards-service-list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-ask]'); if (!item) return;
    const desc = (item.closest('.agent-card-item') || item).querySelector('.agent-desc');
    openAsk(item.getAttribute('data-ask'), item.getAttribute('data-name'), desc ? desc.textContent : '');
  });
  $('ask-back').addEventListener('click', loadAgentCards);
  $('ask-send').addEventListener('click', sendAsk);
  $('allclear-handled').addEventListener('click', loadHistory);
  $('open-prefs').addEventListener('click', openPrefs);
  $('prefs-reconnect').addEventListener('click', async () => {
    const url = normalizeBackendUrl($('prefs-url-input').value);
    if (!url) { $('prefs-conn').textContent = 'Enter a valid address.'; return; }
    $('prefs-conn').textContent = 'Connecting…';
    try {
      await api.setup({ url });          // saves cfg + claims the new space
      _spaceUrl = url;
      await refreshHealth();             // re-poll the new space's liveness
      toast(`Connected to ${url}`);
      loadInbox();                       // inbox + Agent Cards now come from this space
    } catch (e) { $('prefs-conn').textContent = setupErrorMessage(e); }
  });
  $('prefs-folders').addEventListener('click', openFolders);
  $('prefs-back').addEventListener('click', loadInbox);
  $('rv-back').addEventListener('click', loadInbox);
  $('retry').addEventListener('click', boot);
  $('folders-skip').addEventListener('click', async () => { try { await api.skipOnboarding(); loadInbox(); } catch (e) { fail(e.message); } });
  $('folders-continue').addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('#folders-list input[data-path]:checked')].map((i) => i.dataset.path);
    try {
      await api.grantFolders(checked, { useHistory: $('opt-history').checked, useAllLogs: $('opt-alllogs').checked });
      toast(`Granted ${checked.length} folder${checked.length === 1 ? '' : 's'}.`);
      loadInbox();
    } catch (e) { fail(e.message); }
  });
  $('folders-add').addEventListener('click', async () => {
    try { const p = await api.pickFolder(); if (p) $('folders-list').appendChild(folderRow({ path: p, sessions: 0 }, true)); } catch (e) { fail(e.message); }
  });
  $('folders-more').addEventListener('click', () => {
    for (const f of _moreFolders) $('folders-list').appendChild(folderRow(f, false));
    _moreFolders = []; $('folders-more').hidden = true;
  });
  $('rv-approve').addEventListener('click', async () => {
    const editEl = $('rv-draft-edit');
    const replyText = editEl.hidden ? null : editEl.value.trim();
    try {
      if (isDemo(current.id)) demoResolve(current.id, 'completed', replyText);
      else await api.approve(current.id, replyText);
      toast('Approved. Sent.'); loadInbox();
    } catch (e) { fail(e.message); }
  });
  $('rv-redraft').addEventListener('click', async () => {
    $('rv-draft-edit').hidden = true; $('rv-draft').hidden = false;
    $('rv-lbl').textContent = 'Drafting locally…';
    $('rv-draft').textContent = 'Your local agent is writing a reply in your workspace…';
    $('rv-approve').disabled = true;
    try { await api.redraft(current.id); } catch (e) { /* surfaced on reopen */ }
    openReview(current.id);
  });
  if (api.onDraftUpdated) api.onDraftUpdated(({ taskId }) => {
    if (_view === 'review' && current && current.id === taskId) openReview(taskId);
    else if (_view === 'inbox') loadInbox();
  });
  $('rv-decline').addEventListener('click', async () => {
    try {
      if (isDemo(current.id)) demoResolve(current.id, 'canceled');
      else await api.decline(current.id);
      toast('Rejected.'); loadInbox();
    } catch (e) { fail(e.message); }
  });
  $('rv-followup').addEventListener('click', () => {
    const c = $('rv-compose'); c.hidden = !c.hidden;
    $('rv-followup').classList.toggle('on', !c.hidden);
    if (!c.hidden) $('rv-compose-text').focus();
  });
  $('rv-compose-send').addEventListener('click', async () => {
    const msg = $('rv-compose-text').value.trim(); if (!msg) return;
    try {
      if (isDemo(current.id)) {
        const t = demoTask(current.id);
        if (t) t._draft = { ...(t._draft || {}), status: 'ready', text: `(Revised per your note: ${msg})\n\n${(t._draft && t._draft.text) || ''}` };
      } else {
        const draftText = $('rv-draft-edit').hidden ? $('rv-draft').textContent : $('rv-draft-edit').value;
        await api.followup(current.id, msg, draftText);
      }
      toast('Redrafting locally.'); openReview(current.id);
    } catch (e) { fail(e.message); }
  });
}

wire();
boot();
