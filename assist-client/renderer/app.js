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
      days: 30,
      bySource: { claude: 40, codex: 15, openclaw: 4, pi: 3, opencode: 2, hermes: 2 },
    }),
    health: async () => ({ ok: true }),
    pickFolder: async () => '/Users/you/Documents/example',
    inbox: async () => tasks.filter((t) => ['input-required', 'auth-required'].includes(t.status.state)),
    handled: async () => tasks.filter((t) => ['completed', 'canceled', 'rejected'].includes(t.status.state)),
    show: async (id) => tasks.find((t) => t.id === id),
    approve: async (id) => { const t = tasks.find((t) => t.id === id); t.status.state = 'completed'; return t; },
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

const SECTIONS = ['loading', 'welcome', 'connect', 'consent', 'seeding', 'folders', 'inbox', 'allclear', 'review', 'handled', 'prefs', 'error'];
const OUTCOME = { completed: 'Sent', canceled: 'Declined', rejected: 'Declined' };
const ONBOARDING = new Set(['loading', 'welcome', 'connect', 'consent', 'seeding']);
function setView(v) {
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

function backendBase() {
  return ($('connect-url').value || 'http://localhost:8080').trim().replace(/\/$/, '');
}

function refreshBackendPreview() {
  const base = backendBase();
  $('ep-claim').textContent = `${base}/owner/claim`;
  $('ep-owner').textContent = `${base}/owner/a2a`;
  $('ep-services').textContent = `${base}/services`;
  $('ep-ask').textContent = `${base}/ask-albi?mode=quick`;
}

async function boot() {
  setView('loading');
  try {
    const b = await api.bootstrap();
    if (MOCKED) $('priv').textContent = 'Private · demo';
    startHealthPolling();
    if (!b.connected) return setView('welcome');
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
  list.slice(0, 10).forEach((f) => ul.appendChild(folderRow(f, true))); // option 2: pre-check all suggested
  _moreFolders = list.slice(10);
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
function renderSeedSources(bySource) {
  const el = $('seed-sources'); el.innerHTML = '';
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
  try { res = await api.seed(); } catch (e) { /* non-fatal — proceed to the inbox */ }
  clearInterval(_quoteTimer); _quoteTimer = null;
  if (res && res.bySource) {
    renderSeedSources(res.bySource);
    $('seed-progress').textContent = `Seeded ${res.uploaded} prompt/output pairs from the last ${res.days || 30} days.`;
    await new Promise((r) => setTimeout(r, 1500)); // let the ticks land
  }
  await loadInbox();
}

// Deep-link to a specific request, e.g. from a notification: index.html#open=<taskId>
function openFromHash() {
  const h = location.hash || '';
  if (h === '#folders') return openFolders();
  if (h === '#handled') return loadHandled();
  const m = h.match(/^#open=(.+)/);
  if (m) openReview(decodeURIComponent(m[1]));
}

async function loadInbox() {
  try {
    const tasks = await api.inbox();
    if (!tasks.length) { setView('allclear'); return; }
    setView('inbox');
    $('inbox-sub').textContent = `${tasks.length} request${tasks.length > 1 ? 's' : ''} need you`;
    const ul = $('inbox-list'); ul.innerHTML = '';
    for (const t of tasks) {
      const who = (t.from && t.from.display) || 'someone';
      const li = document.createElement('li');
      li.className = 'row';
      li.innerHTML = `<span class="av">${esc(initial(who))}</span><span class="rmain">` +
        `<span class="rtop"><span class="who">${esc(who)}</span><span class="ago">${esc(ago(t.status.timestamp))}</span></span>` +
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
    const url = $('connect-url').value.trim();
    const token = $('connect-token').value.trim();
    if (!url) { $('connect-err').textContent = 'Enter your space address.'; $('connect-err').hidden = false; return; }
    try { await api.setup({ url, token }); $('connect-err').hidden = true; setView('consent'); }
    catch (e) { $('connect-err').textContent = e.message; $('connect-err').hidden = false; }
  });
  $('consent-approve').addEventListener('click', seedAndEnter);
  $('consent-skip').addEventListener('click', loadInbox);
  $('open-inbox').addEventListener('click', loadInbox);
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
    for (const f of _moreFolders) $('folders-list').appendChild(folderRow(f, true));
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
