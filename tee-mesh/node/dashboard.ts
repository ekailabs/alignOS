// Demo-day dashboard — served at /dashboard. Dependency-free; polls /peers and renders the
// mesh (each CVM node -> its isolated agent containers -> their skills), plus a live "ask the
// mesh" box that POSTs /route and shows which node/agent/skill answered.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>alignOS · mesh dashboard</title>
<style>
  :root{--bg:#0b0f17;--panel:#131a26;--panel2:#1b2436;--line:#243245;--fg:#e6edf3;--mut:#8aa0b6;--acc:#4cc4ff;--ok:#3fb950;--warn:#d29922;--chip:#1f2a3a}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  header{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
  h1{font-size:18px;margin:0;letter-spacing:.5px} h1 b{color:var(--acc)}
  .sum{color:var(--mut);font-size:12px} .sum b{color:var(--fg)}
  main{padding:22px;display:grid;grid-template-columns:1fr;gap:22px;max-width:1400px;margin:0 auto}
  .ask{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
  .ask h2{margin:0 0 10px;font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
  .askrow{display:flex;gap:10px} input{flex:1;background:#0d131d;border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:10px 12px;font:inherit}
  button{background:var(--acc);color:#04121d;border:0;border-radius:8px;padding:0 18px;font:inherit;font-weight:700;cursor:pointer}
  .samples{margin-top:8px;color:var(--mut);font-size:12px} .samples span{cursor:pointer;color:var(--acc);margin-right:14px}
  .result{margin-top:14px;display:none;background:#0d131d;border:1px solid var(--line);border-radius:8px;padding:14px}
  .path{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  .pill{background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:3px 11px;font-size:12px}
  .pill.skill{background:#13283a;border-color:#1d4b6b} .arrow{color:var(--mut)}
  pre{margin:0;white-space:pre-wrap;word-break:break-word;color:#bfe6ff}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px}
  .node{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .node.self{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc) inset}
  .nhead{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:8px}
  .nid{font-weight:700} .nid small{color:var(--mut);font-weight:400}
  .badges{display:flex;gap:6px;align-items:center}
  .b{font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid var(--line);color:var(--mut)}
  .b.tee{color:var(--ok);border-color:#1d3b27;background:#0f1f15}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 6px var(--ok)} .dot.stale{background:var(--warn);box-shadow:0 0 6px var(--warn)}
  .meta{padding:8px 16px;color:var(--mut);font-size:11px;border-bottom:1px solid var(--line);word-break:break-all}
  .agents{padding:12px 16px;display:flex;flex-direction:column;gap:10px}
  .agent{background:#0d131d;border:1px solid var(--line);border-radius:9px;padding:10px 12px}
  .aname{font-weight:700;color:var(--acc)} .adesc{color:var(--mut);font-size:12px;margin:2px 0 8px}
  .chips{display:flex;gap:6px;flex-wrap:wrap} .chip{background:var(--chip);border:1px solid var(--line);border-radius:6px;padding:1px 8px;font-size:11px;color:var(--mut)}
  .empty{color:var(--mut);font-style:italic;padding:6px 0}
  footer{color:var(--mut);font-size:11px;text-align:center;padding:20px}
</style></head><body>
<header>
  <h1>align<b>OS</b> · mesh</h1>
  <div class="sum" id="sum">connecting…</div>
</header>
<main>
  <div class="ask">
    <h2>Ask the mesh</h2>
    <div class="askrow"><input id="q" placeholder="e.g. how should we find PMF?" autofocus>
      <button onclick="ask()">Route</button></div>
    <div class="samples">try:
      <span onclick="setq('how should we find PMF?')">PMF / GTM</span>
      <span onclick="setq('how does remote attestation work in a TEE?')">confidential compute</span>
      <span onclick="setq('how should we design the agent routing layer?')">agent infra</span></div>
    <div class="result" id="res"></div>
  </div>
  <div class="grid" id="grid"></div>
</main>
<footer>self: <span id="self"></span> · auto-refresh 4s</footer>
<script>
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
let SELF='';
async function load(){
  try{
    const r=await fetch('/');const me=await r.json();SELF=me.node_id;document.getElementById('self').textContent=me.app_id+' ('+me.mode+')';
    const ps=await (await fetch('/peers')).json();
    const agents=ps.reduce((n,p)=>n+(p.agents?.length||0),0);
    document.getElementById('sum').innerHTML='<b>'+ps.length+'</b> nodes · <b>'+agents+'</b> agents · '+ps.filter(p=>!p.stale).length+' live';
    document.getElementById('grid').innerHTML=ps.map(card).join('');
  }catch(e){document.getElementById('sum').textContent='error: '+e}
}
function card(p){
  const self=p.node_id===SELF?' self':'';
  const ags=(p.agents||[]).map(a=>{
    const sk=(a.skills||[]).flatMap(s=>[s.name||s.id, ...(s.tags||[]).slice(0,5)]);
    return '<div class="agent"><div class="aname">'+esc(a.name)+'</div><div class="adesc">'+esc(a.description||'')+'</div>'+
      '<div class="chips">'+sk.map(t=>'<span class="chip">'+esc(t)+'</span>').join('')+'</div></div>';
  }).join('')||'<div class="empty">no agents</div>';
  return '<div class="node'+self+'"><div class="nhead"><div class="nid">'+esc((p.app_id||'').slice(0,12))+
    '<small> '+esc(p.node_id.slice(0,10))+'…</small></div><div class="badges">'+
    '<span class="b'+(p.mode==='tee'?' tee':'')+'">'+esc(p.mode)+'</span>'+
    '<span class="dot'+(p.stale?' stale':'')+'" title="'+(p.stale?'stale':'live')+'"></span></div></div>'+
    '<div class="meta">v'+p.version+' · '+esc(p.gateway_url||'')+(p.attestation_digest?'<br>quote '+esc(p.attestation_digest.slice(0,18))+'…':'')+'</div>'+
    '<div class="agents">'+ags+'</div></div>';
}
function setq(s){document.getElementById('q').value=s;ask()}
async function ask(){
  const q=document.getElementById('q').value.trim();if(!q)return;
  const res=document.getElementById('res');res.style.display='block';res.innerHTML='routing…';
  try{
    const r=await (await fetch('/route',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q})})).json();
    if(!r.routed_to){res.innerHTML='<div class="path"><span class="pill">no skill matched</span></div><pre>'+esc(JSON.stringify(r.answer,null,2))+'</pre>';return}
    const t=r.routed_to;
    res.innerHTML='<div class="path"><span class="pill">you</span><span class="arrow">→</span>'+
      '<span class="pill">'+esc(t.app_id.slice(0,12))+'</span><span class="arrow">→</span>'+
      '<span class="pill">'+esc(t.agent)+'</span><span class="pill skill">skill: '+esc(t.skill)+'</span>'+
      '<span class="pill">score '+t.score+'</span></div><pre>'+esc(JSON.stringify(r.answer,null,2))+'</pre>';
  }catch(e){res.innerHTML='<pre>error: '+esc(e)+'</pre>'}
}
document.getElementById('q').addEventListener('keydown',e=>{if(e.key==='Enter')ask()});
load();setInterval(load,4000);
</script></body></html>`;
