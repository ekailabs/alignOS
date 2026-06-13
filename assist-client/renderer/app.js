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
  ];
  return {
    bootstrap: async () => ({ connected: true, url: 'demo' }),
    setup: async () => ({ ok: true }),
    inbox: async () => tasks.filter((t) => ['input-required', 'auth-required'].includes(t.status.state)),
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
const ago = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
};

const SECTIONS = ['loading', 'connect', 'inbox', 'allclear', 'review', 'prefs', 'error'];
function setView(v) {
  for (const s of SECTIONS) $(s).hidden = s !== v;
  $('head').hidden = (v === 'loading' || v === 'connect');
}

let current = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2200); }
function fail(msg) { $('error-text').textContent = msg || 'Unknown error'; setView('error'); }

async function boot() {
  setView('loading');
  try {
    const b = await api.bootstrap();
    if (MOCKED) $('priv').textContent = 'Private · demo';
    if (b.connected) { await loadInbox(); openFromHash(); return; }
    setView('connect');
  } catch (e) { fail(e.message); }
}

// Deep-link to a specific request, e.g. from a notification: index.html#open=<taskId>
function openFromHash() {
  const m = (location.hash || '').match(/^#open=(.+)/);
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

async function openReview(id) {
  try {
    const t = await api.show(id); current = t;
    const who = (t.from && t.from.display) || 'someone';
    $('rv-who').textContent = who;
    $('rv-age').textContent = ago(t.status.timestamp);
    $('rv-chip').hidden = false; // v1: every known peer shows as a connection
    $('rv-ask').textContent = text(t.history && t.history[0] && t.history[0].parts);
    $('rv-draft').textContent = text(t.artifacts && t.artifacts[0] && t.artifacts[0].parts) || '(no draft yet)';
    $('rv-prov').textContent = 'Drafted in your private space. Raw local files weren’t sent.';
    $('rv-consequence').innerHTML = `Approving <b>sends this reply to ${esc(who)}</b>.`;
    $('rv-compose').hidden = true; $('rv-compose-text').value = ''; $('rv-followup').classList.remove('on');
    setView('review');
  } catch (e) { fail(e.message); }
}

function wire() {
  $('connect-go').addEventListener('click', async () => {
    const url = $('connect-url').value.trim();
    if (!url) { $('connect-err').textContent = 'Enter your space address.'; $('connect-err').hidden = false; return; }
    try { await api.setup({ url }); $('connect-err').hidden = true; loadInbox(); }
    catch (e) { $('connect-err').textContent = e.message; $('connect-err').hidden = false; }
  });
  $('open-inbox').addEventListener('click', loadInbox);
  $('open-prefs').addEventListener('click', () => setView('prefs'));
  $('prefs-back').addEventListener('click', loadInbox);
  $('rv-back').addEventListener('click', loadInbox);
  $('retry').addEventListener('click', boot);
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
