'use strict';
// Background drafting: poll the inbox, draft every undrafted request via the local CLI,
// store the result, notify the renderer. Network + notification deps are injected so this is
// unit-testable with no Electron and no node running.
const cfg = require('./config');
const scope = require('./scope');
const store = require('./draft-store');
const runner = require('./agent-runner');

const STALE_DRAFTING_MS = 10 * 60 * 1000; // a 'drafting' entry older than this = crashed run

function workspaceFor() {
  const agent = cfg.agentConfig();
  if (agent.workspace) return agent.workspace;
  const folders = scope.load().folders;
  if (folders && folders.length) return folders[0];
  return process.cwd();
}

function needsDraft(taskId) {
  const d = store.get(taskId);
  if (!d) return true;
  if (d.status === 'error') return true;
  if (d.status === 'drafting') {
    const age = d.at ? Date.now() - Date.parse(d.at) : Infinity;
    return age > STALE_DRAFTING_MS; // resume after a crash; otherwise leave it alone
  }
  return false; // 'ready'
}

// Draft one task now. Used by the loop, the redraft IPC handler, and the CLI.
async function draftTask(task, { onUpdate, runDraft = runner.runDraft, instruction } = {}) {
  const agent = cfg.agentConfig();
  const workspace = workspaceFor();
  const previous = store.get(task.id);
  const currentDraft = previous && previous.status === 'ready' ? previous.text : '';
  store.set(task.id, { status: 'drafting', workspace, text: '', error: '', instruction: instruction || '' });
  if (onUpdate) onUpdate(task.id);
  try {
    const { text, cli } = await runDraft(task, { workspace, agent, instruction, currentDraft });
    store.set(task.id, { status: 'ready', text, cli, error: '', instruction: instruction || '' });
  } catch (e) {
    store.set(task.id, { status: 'error', error: e.message });
  }
  if (onUpdate) onUpdate(task.id);
  return store.get(task.id);
}

// One sweep: draft every input-required task that still needs it, bounded concurrency.
async function sweep({ listInbox, onUpdate, runDraft } = {}) {
  if (cfg.agentConfig().autoDraft === false) return { drafted: 0 };
  let tasks = [];
  try { tasks = await listInbox(); } catch { return { drafted: 0 }; }
  const queue = tasks.filter((t) => needsDraft(t.id));
  let drafted = 0;
  const limit = Math.max(1, cfg.agentConfig().concurrency || 1);
  async function worker() {
    while (queue.length) {
      await draftTask(queue.shift(), { onUpdate, runDraft });
      drafted++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return { drafted };
}

let _timer = null;
function start({ listInbox, onUpdate, intervalMs = 15000 } = {}) {
  stop();
  const tick = () => sweep({ listInbox, onUpdate }).catch(() => {});
  tick();
  _timer = setInterval(tick, intervalMs);
  if (_timer.unref) _timer.unref(); // don't keep a headless `alignos watch` from exiting cleanly
  return stop;
}
function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { workspaceFor, needsDraft, draftTask, sweep, start, stop };
