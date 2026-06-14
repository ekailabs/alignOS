'use strict';
const $ = (id) => document.getElementById(id);

// API surface: the real IPC bridge inside Electron; a mock with sample data in a plain
// browser (lets the UI render for screenshots/dev without a running node).
const MOCK = (() => {
  const tasks = [
    { id: 't1', from: { display: "Mara's assistant" }, status: { state: 'input-required', timestamp: new Date().toISOString() },
      history: [{ role: 'user', parts: [{ kind: 'text', text: 'Can you share a summary of the Q2 launch retro?' }] }],
      artifacts: [{ parts: [{ kind: 'text', text: "Here's the short version: the rollout hit its date, activation came in 12% over target, and the main friction was onboarding email deliverability.\n\nTop fix next quarter is a warm-up sequence for new sending domains." }] }] },
    { id: 't2', from: { display: "Devon's assistant" }, status: { state: 'input-required', timestamp: new Date(Date.now() - 840000).toISOString() },
      history: [{ role: 'user', parts: [{ kind: 'text', text: "What's your availability for a 30-min sync Thursday?" }] }],
      artifacts: [{ parts: [{ kind: 'text', text: 'Thursday afternoon works — 2pm or 3:30pm your time. Want me to send an invite?' }] }] },
    { id: 'h1', from: { display: "Priya's assistant" }, status: { state: 'completed', timestamp: new Date(Date.now() - 5400000).toISOString() },
      history: [{ role: 'user', parts: [{ kind: 'text', text: 'Do you approve reusing your onboarding checklist?' }] }],
      artifacts: [{ parts: [{ kind: 'text', text: 'Yes — go ahead and reuse it. Ping me if you adapt the security section.' }] }] },
    { id: 'h2', from: { display: "Sam's assistant" }, status: { state: 'canceled', timestamp: new Date(Date.now() - 9000000).toISOString() },
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
      services: [],
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
    followup: async (id) => tasks.find((t) => t.id === id),
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

const SECTIONS = ['loading', 'welcome', 'connect', 'consent', 'seeding', 'seeded', 'folders', 'inbox', 'agent-cards', 'allclear', 'review', 'handled', 'prefs', 'error'];
const OUTCOME = { completed: 'Sent', canceled: 'Declined', rejected: 'Declined' };
const ONBOARDING = new Set(['loading', 'welcome', 'connect', 'consent', 'seeding', 'seeded']);
let _view = null;
function setView(v) {
  _view = v;
  for (const s of SECTIONS) $(s).hidden = s !== v;
  $('head').hidden = ONBOARDING.has(v);
}

const QUOTES = [
  '"Alone we can do so little; together we can do so much." — Helen Keller',
  '"Coming together is a beginning; keeping together is progress; working together is success." — Henry Ford',
  '"The strength of the team is each member; the strength of each member is the team." — Phil Jackson',
  '"Talent wins games, but teamwork wins championships." — Michael Jordan',
  '"None of us is as smart as all of us." — Ken Blanchard',
  '"Coordination is just disagreement that learned some manners."',
  '"An assistant aligned with everyone is aligned with no one — so we start with you."',
  '"A computer once beat me at chess, but it was no match for me at kickboxing." — Emo Philips',
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
  const m = h.match(/^#open=(.+)/);
  if (m) openReview(decodeURIComponent(m[1]));
}

function draftChip(d) {
  const map = { drafting: ['dchip drafting', 'Drafting…'], ready: ['dchip ready', 'Draft ready'], error: ['dchip error', 'Draft failed'] };
  const c = d && map[d.status];
  return c ? `<span class="${c[0]}">${esc(c[1])}</span>` : '';
}

async function loadInbox() {
  try {
    const tasks = await api.inbox();
    if (!tasks.length) { setView('allclear'); return; }
    setView('inbox');
    $('inbox-sub').textContent = `${tasks.length} request${tasks.length > 1 ? 's' : ''} need you`;
    const draftMap = api.drafts ? await api.drafts().catch(() => ({})) : {};
    const ul = $('inbox-list'); ul.innerHTML = '';
    for (const t of tasks) {
      const who = (t.from && t.from.display) || 'someone';
      const li = document.createElement('li');
      li.className = 'row';
      li.innerHTML = `<span class="av">${esc(initial(who))}</span><span class="rmain">` +
        `<span class="rtop"><span class="who">${esc(who)}</span>${draftChip(draftMap[t.id])}<span class="ago">${esc(ago(t.status.timestamp))}</span></span>` +
        `<span class="ask">${esc(text(t.history && t.history[0] && t.history[0].parts))}</span></span>`;
      li.addEventListener('click', () => openReview(t.id));
      ul.appendChild(li);
    }
  } catch (e) { fail(e.message); }
}

async function loadHandled() {
  try {
    const tasks = await api.handled();
    setView('handled');
    const ul = $('handled-list'); ul.innerHTML = '';
    $('handled-empty').hidden = tasks.length > 0;
    for (const t of tasks) {
      const who = (t.from && t.from.display) || 'someone';
      const out = OUTCOME[t.status.state] || t.status.state;
      const li = document.createElement('li');
      li.className = 'row';
      li.innerHTML = `<span class="av">${esc(initial(who))}</span><span class="rmain">` +
        `<span class="rtop"><span class="who">${esc(who)}</span><span class="ago">${esc(out)} · ${esc(ago(t.status.timestamp))}</span></span>` +
        `<span class="ask">${esc(text(t.history && t.history[0] && t.history[0].parts))}</span></span>`;
      li.addEventListener('click', () => openReview(t.id));
      ul.appendChild(li);
    }
  } catch (e) { fail(e.message); }
}

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
  const modes = service.capabilities && Array.isArray(service.capabilities.modes) ? service.capabilities.modes : [];
  return `<li class="agent-card-item">
    <div class="agent-card-top">
      <span class="av">${esc(initial(owner.display_name || owner.handle || service.app_id))}</span>
      <span class="agent-card-title"><b>${esc(owner.display_name || owner.handle || service.app_id || 'Unknown service')}</b><span>${esc(service.gateway_url || service.service_id || '')}</span></span>
    </div>
    ${modes.length ? `<div class="tag-row">${modes.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div>` : ''}
    <div class="endpoint-list">${endpointRows(service.endpoints)}</div>
  </li>`;
}

async function loadAgentCards() {
  try {
    setView('agent-cards');
    $('node-card').innerHTML = '<div class="spinner small-spin"></div>';
    $('cards-agent-list').innerHTML = '';
    $('cards-service-list').innerHTML = '';
    $('cards-empty').hidden = true;

    const { node, service, services } = await api.agentCards();
    const cardNode = node || {};
    const svc = service || {};
    const owner = cardNode.owner || svc.owner || {};
    $('cards-mode').textContent = cardNode.mode || 'unknown';
    $('cards-mode').classList.toggle('tee', cardNode.mode === 'tee');
    $('cards-sub').textContent = owner.display_name || owner.handle
      ? `${owner.display_name || owner.handle}'s published agent identity and routing surface.`
      : 'Published identity and routing details for this private space.';

    $('node-card').innerHTML = `<div class="node-main">
      <div><span class="node-label">Owner</span><b>${esc(owner.display_name || owner.handle || 'Unclaimed')}</b></div>
      <div><span class="node-label">Node</span><code title="${esc(cardNode.node_id || '')}">${esc(shortId(cardNode.node_id))}</code></div>
      <div><span class="node-label">Gateway</span><code title="${esc(cardNode.gateway_url || '')}">${esc(cardNode.gateway_url || '')}</code></div>
      <div><span class="node-label">Version</span><b>${esc(cardNode.version == null ? '-' : cardNode.version)}</b></div>
      <div><span class="node-label">Attestation</span><code title="${esc(cardNode.attestation_digest || '')}">${esc(cardNode.attestation_digest ? shortId(cardNode.attestation_digest) : 'local mode')}</code></div>
      <div><span class="node-label">Updated</span><b>${esc(ago(cardNode.updated_at))}</b></div>
    </div>
    <div class="endpoint-list">${endpointRows(svc.endpoints)}</div>`;

    const agents = Array.isArray(cardNode.agents) ? cardNode.agents : [];
    $('cards-agent-list').innerHTML = agents.map(renderAgentCard).join('');
    const knownServices = Array.isArray(services) && services.length ? services : (service ? [service] : []);
    $('cards-service-list').innerHTML = knownServices.map(renderServiceCard).join('');
    $('cards-empty').hidden = !!(agents.length || knownServices.length);
  } catch (e) { fail(e.message); }
}

async function openReview(id) {
  try {
    const t = await api.show(id); current = t;
    const who = (t.from && t.from.display) || 'someone';
    $('rv-who').textContent = who;
    $('rv-age').textContent = ago(t.status.timestamp);
    $('rv-chip').hidden = false; // v1: every known peer shows as a connection
    $('rv-ask').textContent = text(t.history && t.history[0] && t.history[0].parts);
    $('rv-compose').hidden = true; $('rv-compose-text').value = ''; $('rv-followup').classList.remove('on');

    const terminal = ['completed', 'canceled', 'rejected'].includes(t.status.state);
    $('rv-actions').hidden = terminal;
    if (terminal) {
      const sent = t.status.state === 'completed';
      $('rv-draft').textContent = sent ? (text(t.artifacts && t.artifacts[0] && t.artifacts[0].parts) || '(no reply)') : '(declined — nothing was sent)';
      $('rv-prov').textContent = '';
      $('rv-consequence').innerHTML = `<b>${sent ? 'Sent ✓' : 'Declined'}</b> · ${esc(ago(t.status.timestamp))}`;
    } else {
      $('rv-draft').textContent = text(t.artifacts && t.artifacts[0] && t.artifacts[0].parts) || '(no draft yet)';
      $('rv-prov').textContent = 'Drafted in your private space. Raw local files weren’t sent.';
      $('rv-consequence').innerHTML = `Approving <b>sends this reply to ${esc(who)}</b>.`;
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
    try { await api.setup({ url }); $('connect-err').hidden = true; setView('consent'); }
    catch (e) { $('connect-err').textContent = setupErrorMessage(e); $('connect-err').hidden = false; }
  });
  $('consent-approve').addEventListener('click', seedAndEnter);
  $('consent-skip').addEventListener('click', loadInbox);
  $('seeded-go').addEventListener('click', loadInbox);
  $('consent-info').addEventListener('click', () => { const l = $('leaves'); l.hidden = !l.hidden; });
  $('open-inbox').addEventListener('click', loadInbox);
  $('open-cards').addEventListener('click', loadAgentCards);
  $('cards-back').addEventListener('click', loadInbox);
  $('open-handled').addEventListener('click', loadHandled);
  $('allclear-handled').addEventListener('click', loadHandled);
  $('handled-back').addEventListener('click', loadInbox);
  $('open-prefs').addEventListener('click', () => setView('prefs'));
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
  $('rv-approve').addEventListener('click', async () => { try { await api.approve(current.id); toast('Approved — sent.'); loadInbox(); } catch (e) { fail(e.message); } });
  $('rv-decline').addEventListener('click', async () => { try { await api.decline(current.id); toast('Declined.'); loadInbox(); } catch (e) { fail(e.message); } });
  $('rv-followup').addEventListener('click', () => {
    const c = $('rv-compose'); c.hidden = !c.hidden;
    $('rv-followup').classList.toggle('on', !c.hidden);
    if (!c.hidden) $('rv-compose-text').focus();
  });
  $('rv-compose-send').addEventListener('click', async () => {
    const msg = $('rv-compose-text').value.trim(); if (!msg) return;
    try { await api.followup(current.id, msg); toast('Sent to your assistant.'); openReview(current.id); }
    catch (e) { fail(e.message); }
  });
}

wire();
boot();
