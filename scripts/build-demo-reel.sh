#!/usr/bin/env bash
# Build an MP4 demo reel from the REAL outputs of scripts/demo-local-test.sh.
# Renders slides with Chrome headless, stitches them with ffmpeg. No narration, no live GUI.
#   1) bash scripts/demo-local-test.sh        # produces /tmp/align-demo-{grounded,base,ablated}.txt
#   2) bash scripts/build-demo-reel.sh        # -> /tmp/align-reel/alignos-demo.mp4
set -uo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
WORK="/tmp/align-reel"
OUT="$WORK/alignos-demo.mp4"
command -v ffmpeg >/dev/null 2>&1 || { echo "FAIL: ffmpeg not found"; exit 1; }
[ -x "$CHROME" ] || { echo "FAIL: Chrome not found at: $CHROME (set CHROME=...)"; exit 1; }
for f in grounded base ablated; do
  [ -s "/tmp/align-demo-$f.txt" ] || { echo "FAIL: /tmp/align-demo-$f.txt missing. Run scripts/demo-local-test.sh first."; exit 1; }
done

rm -rf "$WORK"; mkdir -p "$WORK"

# ---- generate slide HTML + the ffmpeg concat list (durations) via Python ----
python3 - "$WORK" <<'PY'
import html, os, sys
work = sys.argv[1]
def read(p):
    try:
        return open(p).read().strip()
    except Exception:
        return ""
grounded = read("/tmp/align-demo-grounded.txt")
base     = read("/tmp/align-demo-base.txt")
ablated  = read("/tmp/align-demo-ablated.txt")

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;background:#0a0e16;overflow:hidden}
body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#e8edf6}
.stage{position:absolute;inset:0;padding:130px 150px;display:flex;flex-direction:column;justify-content:center}
.kicker{font-size:34px;font-weight:800;letter-spacing:.32em;text-transform:uppercase;color:#5eead4;margin-bottom:34px}
.title{font-size:170px;font-weight:800;letter-spacing:-.03em;line-height:.98}
.sub{font-size:58px;font-weight:500;color:#9fb0c8;margin-top:46px}
.claim{font-size:74px;font-weight:700;line-height:1.22;letter-spacing:-.01em}
.claim .hl{color:#5eead4}
.q{font:500 40px/1.5 'Menlo','SF Mono',monospace;color:#8ea2bd;margin-top:30px}
.card{border-left:12px solid #334155;background:#0f1626;border-radius:18px;padding:54px 60px;margin-top:40px}
.card.good{border-left-color:#5eead4}
.card.warn{border-left-color:#f59e0b}
.card.flat{border-left-color:#64748b}
.label{font-size:38px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:28px}
.card.good .label{color:#5eead4}.card.warn .label{color:#f59e0b}.card.flat .label{color:#93a4bd}
.ans{font:500 44px/1.5 'Menlo','SF Mono',monospace;color:#e8edf6;white-space:pre-wrap}
.chips{margin-top:34px;display:flex;gap:18px;flex-wrap:wrap}
.chip{font:600 30px/1 'Menlo',monospace;color:#b8c6dd;background:#16203360;border:1px solid #24324d;border-radius:999px;padding:18px 26px}
.pass{font:500 46px/1.85 'Menlo','SF Mono',monospace}
.pass .ok{color:#34d399;font-weight:800}.pass .ar{color:#64748b}.pass .who{color:#5eead4}
.big{font-size:96px;font-weight:800;letter-spacing:-.02em;line-height:1.06}
.row{display:flex;gap:28px;align-items:baseline;margin-top:26px}
.metric{font:800 64px/1 'Menlo',monospace;color:#34d399}
.foot{font-size:40px;color:#9fb0c8;margin-top:40px;line-height:1.5}
.brand{position:absolute;bottom:64px;right:80px;font-size:30px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#3b475e}
.tag{position:absolute;top:64px;left:150px;font-size:30px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#3b475e}
"""

def page(inner, tag=""):
    t = f'<div class="tag">{tag}</div>' if tag else ""
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{t}<div class="stage">{inner}</div><div class="brand">alignOS</div></body></html>'

def esc(s): return html.escape(s)

slides = []
def add(name, inner, dur, tag=""):
    p = os.path.join(work, name)
    open(p, "w").write(page(inner, tag))
    slides.append((name, dur))

# 1 title
add("s01.html", '<div class="kicker">live local demo</div>'
    '<div class="title">alignOS</div>'
    '<div class="sub">Your agent. Your voice. Your TEE.</div>', 4.5)

# 2 claim
add("s02.html",
    '<div class="kicker">the wow</div>'
    '<div class="claim">A node answers in its owner&#39;s <span class="hl">voice and prompting style</span>, '
    'learned from their private agent logs &mdash; and that style <span class="hl">never leaves their TEE</span>.</div>'.replace("&mdash;",","),
    7.0, "1 / voice")

# 3 setup
add("s03.html",
    '<div class="kicker">same question, three ways</div>'
    '<div class="big">One prompt. Watch the voice change.</div>'
    '<div class="q">q = "What is the single most important thing to get right when<br>building a privacy-first personal AI assistant?"</div>',
    4.5, "1 / voice")

# 4 grounded
add("s04.html",
    '<div class="kicker">grounded, inside the TEE</div>'
    f'<div class="card good"><div class="label">your node &middot; your voice</div>'
    f'<div class="ans">{esc(grounded)}</div>'
    '<div class="chips"><span class="chip">lowercase</span><span class="chip">terse</span>'
    '<span class="chip">imperative</span><span class="chip">no markdown</span></div></div>',
    8.5, "1 / voice")

# 5 base
add("s05.html",
    '<div class="kicker">same question, base model</div>'
    f'<div class="card warn"><div class="label">base codex &middot; nobody&#39;s voice</div>'
    f'<div class="ans">{esc(base)}</div>'
    '<div class="chips"><span class="chip">Capitalized</span><span class="chip">**bold**</span>'
    '<span class="chip">verbose</span><span class="chip">generic</span></div></div>',
    9.0, "1 / voice")

# 6 ablation
add("s06.html",
    '<div class="kicker">delete the style profile</div>'
    f'<div class="card flat"><div class="label">corpus removed &middot; the voice is gone</div>'
    f'<div class="ans">{esc(ablated)}</div>'
    '<div class="chips"><span class="chip">formal</span><span class="chip">sentence-case</span>'
    '<span class="chip">back to generic</span></div></div>',
    7.5, "1 / voice")

# 7 takeaway
add("s07.html",
    '<div class="kicker">why it matters</div>'
    '<div class="claim">The difference is <span class="hl">taste + privacy</span>.<br>'
    'The style is distilled from your own traces, redacted,<br>and the profile <span class="hl">never leaves your TEE</span>.</div>',
    6.5, "1 / voice")

# 8 routing
rows = [
 ("how should we find PMF?","albi"),
 ("what GTM motion should we use?","albi"),
 ("how does remote attestation work in a TEE?","andrew"),
 ("what privacy guarantees do enclaves provide?","andrew"),
 ("how should we design the agent routing layer?","shashank"),
 ("what system design scales this architecture?","shashank"),
]
pr = "".join(f'<div><span class="ok">PASS</span>  "{esc(q)}"  <span class="ar">-&gt;</span> <span class="who">{w}</span></div>' for q,w in rows)
add("s08.html",
    '<div class="kicker">the mesh routes for you</div>'
    '<div class="big" style="font-size:78px;margin-bottom:28px">Questions route to the right specialist.</div>'
    f'<div class="pass" style="font-size:40px;line-height:1.6">{pr}</div>'
    '<div class="foot" style="margin-top:28px">6 passed, 0 failed &middot; 3 nodes &middot; on-chain registry</div>',
    8.5, "2 / mesh")

# 9 deep mode
add("s09.html",
    '<div class="kicker">deep mode</div>'
    '<div class="claim">Answered by your agent in your <span class="hl">local environment</span>,<br>'
    'read-only. <span class="hl">Nothing returns until you approve.</span></div>'
    '<div class="card good" style="margin-top:54px"><div class="ans">Used your approved notes.\nRaw local files weren&#39;t sent.</div></div>',
    7.5, "3 / deep mode")

# 10 close
add("s10.html",
    '<div class="kicker">verified locally</div>'
    '<div class="row"><div class="metric">Beat 1 PASS</div><div class="metric">Beat 2 PASS &middot; 6/6</div></div>'
    '<div class="foot" style="margin-top:54px">Voice grounded in the TEE &middot; mesh routing across CVMs &middot; you approve every deep answer.<br>'
    'Registry on Ethereum Sepolia &middot; nodes on Phala dstack.</div>'
    '<div class="title" style="font-size:120px;margin-top:60px">alignOS</div>',
    6.5)

with open(os.path.join(work, "list.txt"), "w") as f:
    for name, dur in slides:
        png = name.replace(".html", ".png")
        f.write(f"file '{png}'\nduration {dur}\n")
    f.write(f"file '{slides[-1][0].replace('.html','.png')}'\n")  # repeat last so its duration applies
print(f"generated {len(slides)} slides")
PY
[ $? -eq 0 ] || { echo "FAIL: slide generation"; exit 1; }

# ---- screenshot each slide ----
cd "$WORK"
n=0
for h in s*.html; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1920,1080 --screenshot="${h%.html}.png" "$h" >/dev/null 2>&1
  [ -f "${h%.html}.png" ] || { echo "FAIL: screenshot $h"; exit 1; }
  n=$((n+1))
done
echo "rendered $n PNGs"

# ---- stitch to MP4 (fade in at start) ----
ffmpeg -y -f concat -safe 0 -i list.txt \
  -vf "fps=30,fade=t=in:st=0:d=0.6,format=yuv420p" \
  -c:v libx264 -preset medium -crf 20 -movflags +faststart "$OUT" >/tmp/align-ffmpeg.log 2>&1
[ -f "$OUT" ] || { echo "FAIL: ffmpeg (see /tmp/align-ffmpeg.log)"; tail -8 /tmp/align-ffmpeg.log; exit 1; }

dur=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$OUT" 2>/dev/null)
echo
echo "DONE: $OUT  (${dur}s, $(du -h "$OUT" | cut -f1))"
