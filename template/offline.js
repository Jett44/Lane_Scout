/* ---------------- offline lookup + self-update ---------------- */

/* The shared build has no Claude behind it, so it can never write a brief.
   What it can do is pick up fresher data that was pushed since the file was
   sent, and tell the truth about which patch its briefs were written on.

   Order of preference, newest wins:
     1. data fetched from the repo just now
     2. data cached in this browser from an earlier launch
     3. the data baked into this file  (always works, even offline) */

sampleFn = true;

var CACHE_KEY  = "lanescout.data.v1";
var PINS_KEY   = "lanescout.pins.v1";
var RECENT_KEY = "lanescout.recent.v1";

var DATA = { briefs: BRIEFS, patch: META.patch, builtAt: META.builtAt };
var INDEX = {}, COVERED = [];
var LIVE_PATCH = null;
var browsing = false;

/* True only when this page is being served by scripts/serve.mjs on the
   owner's machine. A copy opened as a file, or sent to someone else, never
   finds the API and stays read-only. */
var CAN_GENERATE = false;

/* The situational rewrite currently on screen, if any. Never stored in DATA. */
var VARIANT = null;

/* ARCHIVED — the "Anything else" contextual rewrite.
 *
 * Parked, not deleted. The whole path still exists and works end to end
 * (offline.js -> /api/generate -> generate.mjs -> data/variants/), but the
 * model returned an incomplete brief for a context-laden prompt and the
 * validator correctly rejected it, so the feature is off rather than shipping
 * something that fails in front of a reader.
 *
 * Flip this to true to bring it back; nothing else needs changing. The prompt
 * in lib.mjs buildPrompt() is where the fix would go. */
var CONTEXT_FEATURE = false;

/* Every read and write is guarded: a private window, or a browser set to
   block site data, throws on access rather than returning empty. */
function readList(key){
  try {
    var v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function writeList(key, v){
  try { localStorage.setItem(key, JSON.stringify(v.slice(0, 40))); } catch (e) {}
}

var pins    = readList(PINS_KEY);
var recents = readList(RECENT_KEY);

try {
  var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  if (cached && cached.briefs && cached.builtAt > DATA.builtAt) DATA = cached;
} catch (e) { /* baked data is a fine fallback */ }

/* ---------------- small style additions for the rail ---------------- */
(function(){
  var s = document.createElement("style");
  s.textContent =
    ".chip.pin{border-color:var(--accent);color:var(--accent)}" +
    ".chip .st{color:var(--accent);margin-right:4px}" +
    ".railsep{width:1px;align-self:stretch;background:var(--line);margin:0 4px}" +
    ".chip.ghost{border-style:dashed;color:var(--ink-3)}" +
    ".pinbtn{border:1px solid var(--line-strong);background:transparent;border-radius:3px;" +
      "font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;" +
      "padding:4px 9px;cursor:pointer;color:var(--ink-2)}" +
    ".pinbtn[aria-pressed=\"true\"]{background:var(--accent);border-color:var(--accent);color:#fff}" +
    ".browse{display:flex;flex-wrap:wrap;gap:7px;padding:9px 0 0;width:100%}" +
    /* Without a reserved gutter the scrollbar appears and disappears as briefs
       change length, the viewport width jumps, and the bar re-wraps — which
       looked like the layout randomly breaking. */
    "html{scrollbar-gutter:stable}" +
    ".ctx{flex:1 1 200px;min-width:160px}" +
    ".go{flex:none}" +
    ".prog{width:100%;padding:9px 0 2px;display:flex;flex-direction:column;gap:6px}" +
    ".prog-track{height:4px;border-radius:99px;background:var(--surface-2);overflow:hidden}" +
    ".prog-fill{height:100%;background:var(--accent);border-radius:99px;" +
      "transition:width .5s ease;min-width:2px}" +
    ".prog-line{display:flex;flex-wrap:wrap;gap:5px 14px;align-items:baseline;" +
      "font-family:var(--mono);font-size:10px;letter-spacing:.07em;color:var(--ink-3)}" +
    ".prog-line b{color:var(--ink);font-weight:500;font-variant-numeric:tabular-nums}" +
    ".prog-line .eta{color:var(--accent)}" +
    /* .field is display:flex, which wins over the hidden attribute's UA rule */
    ".field[hidden]{display:none!important}";
  document.head.appendChild(s);
})();

/* ---------------- coverage bar ---------------- */

/* Starts from what shipped with the file, then the local API replaces it with
   live numbers and a completion estimate. A friend's copy keeps the shipped
   figures, which still explain why a given matchup isn't there. */
var COVERAGE = { done: META.count, total: META.target || 0 };

var progEl = document.createElement("div");
progEl.className = "prog";
document.querySelector(".bar .wrap").insertBefore(progEl, document.getElementById("recents"));

function etaPhrase(days){
  if (days <= 0)  return "complete";
  if (days < 1)   return "complete today";
  if (days < 2)   return "complete in about a day";
  if (days < 14)  return "complete in " + Math.round(days) + " days";
  if (days < 60)  return "complete in " + Math.round(days / 7) + " weeks";
  return "complete in " + Math.round(days / 30.4) + " months";
}

function renderProgress(){
  var done = COVERAGE.done || 0;
  var total = COVERAGE.total || 0;
  if (!total){ progEl.innerHTML = ""; return; }

  var pct = Math.min(100, (done / total) * 100);
  var bits = [
    "<b>" + done.toLocaleString() + "</b> of <b>" + total.toLocaleString() + "</b> matchups",
    "<span>" + (pct < 0.1 && pct > 0 ? "<0.1" : pct.toFixed(1)) + "%</span>"
  ];

  if (done >= total){
    bits.push('<span class="eta">every matchup written</span>');
  } else if (COVERAGE.ratePerDay > 0 && COVERAGE.etaDays != null){
    bits.push("<span>" + COVERAGE.ratePerDay.toFixed(1) + "/day</span>");
    bits.push('<span class="eta">' + etaPhrase(COVERAGE.etaDays)
      + " · " + new Date(COVERAGE.etaAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })
      + "</span>");
  } else if (COVERAGE.why){
    bits.push("<span>estimate: " + esc(COVERAGE.why) + "</span>");
  }

  progEl.innerHTML =
    '<div class="prog-track"><div class="prog-fill" style="width:' + pct.toFixed(2) + '%"></div></div>'
    + '<div class="prog-line">' + bits.join("") + '</div>';
}

function reindex(){
  INDEX = {};
  for (var k in DATA.briefs){
    var r = DATA.briefs[k];
    (INDEX[r.you] = INDEX[r.you] || []).push(r.them);
  }
  for (var y in INDEX) INDEX[y].sort();
  COVERED = Object.keys(INDEX).sort();
}
reindex();

function briefCount(){ return Object.keys(DATA.briefs).length; }
function label(key){
  var r = DATA.briefs[key];
  return r ? r.you + " › " + r.them : null;
}
function currentKey(){ return keyFor(state.you, state.them, state.lane); }

function setNote(text, warn){
  $("barnote").className = warn ? "barnote warn" : "barnote";
  $("barnote").textContent = text;
}
function baseNote(){
  return briefCount() + " matchups · patch " + (DATA.patch || "unknown") + " · works offline";
}

/* ---------------- pins and history ---------------- */

function isPinned(key){ return pins.indexOf(key) !== -1; }

function togglePin(key){
  var i = pins.indexOf(key);
  if (i === -1) pins.unshift(key); else pins.splice(i, 1);
  writeList(PINS_KEY, pins);
  renderRail();
  var btn = $("pinbtn");
  if (btn){
    btn.setAttribute("aria-pressed", String(isPinned(key)));
    btn.textContent = isPinned(key) ? "★ Saved" : "☆ Save";
  }
}

function remember(key){
  var i = recents.indexOf(key);
  if (i !== -1) recents.splice(i, 1);
  recents.unshift(key);
  recents = recents.slice(0, 12);
  writeList(RECENT_KEY, recents);
  renderRail();
}

/* Only show entries this build still has data for — a pin made before an
   update could point at a matchup that no longer exists. */
function live(list){
  return list.filter(function(k){ return !!DATA.briefs[k]; });
}

function chip(key, pinned){
  return '<button class="chip' + (pinned ? " pin" : "") + '" data-key="' + esc(key) + '">'
    + (pinned ? '<span class="st">★</span>' : "") + esc(label(key)) + '</button>';
}

function renderRail(){
  var el = $("recents");
  if (!COVERED.length){ el.hidden = true; return; }
  el.hidden = false;

  var p = live(pins);
  var r = live(recents).filter(function(k){ return p.indexOf(k) === -1; });
  var html = "";

  if (p.length){
    html += '<span class="rl">Saved</span>' + p.map(function(k){ return chip(k, true); }).join("");
  }
  if (r.length){
    if (p.length) html += '<div class="railsep"></div>';
    html += '<span class="rl">Recent</span>' + r.map(function(k){ return chip(k, false); }).join("");
  }
  if (!p.length && !r.length){
    html += '<span class="rl">Start</span><span class="stamp">Save a matchup and it lands here</span>';
  }

  html += '<div class="railsep"></div>'
    + '<button class="chip ghost" id="browsebtn">' + (browsing ? "Hide champions" : "Browse " + COVERED.length + " champions") + '</button>';

  if (browsing){
    html += '<div class="browse">' + COVERED.map(function(c){
      return '<button class="chip" data-you="' + esc(c) + '">' + esc(c) + '</button>';
    }).join("") + '</div>';
  }

  el.innerHTML = html;
}

/* one delegated handler for the whole rail */
document.getElementById("recents").addEventListener("click", function(e){
  var b = e.target.closest("button");
  if (!b) return;

  if (b.id === "browsebtn"){ browsing = !browsing; renderRail(); return; }

  if (b.dataset.key){
    var rec = DATA.briefs[b.dataset.key];
    if (!rec) return;
    $("you").value = rec.you; $("them").value = rec.them;
    syncTiles(); scout();
    return;
  }

  if (b.dataset.you){
    $("you").value = b.dataset.you;
    var first = (INDEX[b.dataset.you] || [])[0];
    if (first) $("them").value = first;
    browsing = false;
    syncTiles(); scout();
  }
});

/* When a datalist suggestion popup is open the browser eats the first Enter to
   commit the highlighted option, so a keydown handler alone never fires and
   typing a champion then pressing Enter appears to do nothing. keyup lands
   after the popup has closed. scout() only re-renders, so the occasional
   double call is harmless. */
["you", "them", "ctx"].forEach(function(id){
  $(id).addEventListener("keyup", function(e){
    if (e.key === "Enter") scout();
  });
});

/* Enter alone is not dependable here: while a suggestion popup is open the
   browser can consume the whole keypress to commit the highlighted option, so
   neither keydown nor keyup reaches the field. Rather than fight that, the
   brief loads as soon as both names name a matchup we actually have — no
   Enter, no button press. The Scout button stays for the case where nothing
   matches and the reader wants to be told so. */
var lastRendered = null;
var autoTimer = null;

function maybeAuto(){
  clearTimeout(autoTimer);
  autoTimer = setTimeout(function(){
    var k = keyFor($("you").value.trim(), $("them").value.trim(), state.lane);
    if (DATA.briefs[k] && k !== lastRendered) scout();
  }, 120);
}

/* Typing context does not change which brief is shown, so nothing would
   re-render — but the offer to rewrite lives in that header, so restamp it. */
$("ctx").addEventListener("input", function(){
  syncTiles();
  if (VARIANT) return;
  var key = currentKey();
  var rec = DATA.briefs[key];
  if (rec) stampMeta(rec, key, null);
});

["you", "them"].forEach(function(id){
  $(id).addEventListener("input", maybeAuto);
  // committing a suggestion with the mouse fires change, not input
  $(id).addEventListener("change", function(){ refreshOpponentList(); maybeAuto(); });
});

/* The opponent picker offers only matchups that actually exist for the
   champion you typed, so the dropdown never promises a brief this build
   cannot show. Falls back to the full roster for an uncovered champion. */
var oppList = document.createElement("datalist");
oppList.id = "champs-them";
document.body.appendChild(oppList);
$("them").setAttribute("list", "champs-them");

function refreshOpponentList(){
  var you = $("you").value.trim();
  /* With generation available every champion is reachable, so offer the whole
     roster; without it, only what this build can actually show. */
  var covered = INDEX[you] || [];
  var opts = CAN_GENERATE
    ? covered.concat(CHAMPS.filter(function(c){ return covered.indexOf(c) === -1; }))
    : (covered.length ? covered : CHAMPS);
  oppList.innerHTML = opts.map(function(c){
    return '<option value="' + esc(c) + '">';
  }).join("");
}

/* Covered champions sort to the top of the "you play" list. */
function refreshYouList(){
  var rest = CHAMPS.filter(function(c){ return COVERED.indexOf(c) === -1; });
  $("champs").innerHTML = COVERED.concat(rest).map(function(c){
    return '<option value="' + esc(c) + '">';
  }).join("");
}

$("you").addEventListener("input", refreshOpponentList);

/* ← and → step through history, as long as you are not typing in a field */
document.addEventListener("keydown", function(e){
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  var t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

  var list = live(recents);
  if (list.length < 2) return;
  var i = list.indexOf(currentKey());
  if (i === -1) i = 0;
  var next = list[(i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length];
  var rec = DATA.briefs[next];
  if (!rec) return;
  e.preventDefault();
  $("you").value = rec.you; $("them").value = rec.them;
  syncTiles(); scout();
});

/* ---------------- rendering ---------------- */

function stampMeta(rec, key, shownContext){
  var m = document.querySelector(".metaline");
  if (!m) return;
  var bits = [];

  // a situational rewrite is not in the database, so there is nothing to pin
  if (!shownContext){
    bits.push('<button class="pinbtn" id="pinbtn" aria-pressed="' + isPinned(key) + '">'
      + (isPinned(key) ? "★ Saved" : "☆ Save") + '</button>');
  } else {
    bits.push('<span class="badge hot">rewritten for: ' + esc(shownContext) + '</span>');
    bits.push('<button class="pinbtn" id="backbtn">↩ standard brief</button>');
  }

  bits.push('<span class="stamp">written ' + esc(new Date(rec.generatedAt).toISOString().slice(0, 10)) + '</span>');
  if (rec.patch) bits.push('<span class="badge">patch ' + esc(rec.patch) + '</span>');
  if (LIVE_PATCH && rec.patch && LIVE_PATCH !== rec.patch){
    bits.push('<span class="badge hot">live is ' + esc(LIVE_PATCH) + '</span>');
  }

  /* Context typed, but you are looking at the standard brief: offer the
     rewrite rather than silently ignoring what was typed. */
  if (CONTEXT_FEATURE && !shownContext && CAN_GENERATE && state.ctx){
    bits.push('<button class="pinbtn" id="ctxbtn">↻ rewrite for “' + esc(state.ctx) + '”</button>');
  }

  m.innerHTML = bits.join("");

  var pb = $("pinbtn");
  if (pb) pb.addEventListener("click", function(){ togglePin(key); });

  var cb = $("ctxbtn");
  if (cb) cb.addEventListener("click", function(){ generateNow(state.you, state.them, state.ctx); });

  var bb = $("backbtn");
  if (bb) bb.addEventListener("click", function(){ VARIANT = null; scout(); });
}

/* ---------------- writing a matchup on demand ---------------- */

function showWriting(you, them, ctx){
  $("app").innerHTML = '<div class="state"><div class="pulse"><i></i><i></i><i></i><i></i><i></i></div>'
    + '<p class="s1">' + (ctx ? "Rewriting " : "Writing ") + esc(you) + ' into ' + esc(them) + '</p>'
    + (ctx
        ? '<p class="s2" aria-live="polite">For <em>' + esc(ctx) + '</em>. Takes about a minute. '
          + 'Situational rewrites stay on this machine — they describe your game, not the matchup, '
          + 'so they are not added to the shared file.</p>'
        : '<p class="s2" aria-live="polite">Takes about a minute. It gets saved, so this only ever happens once '
          + 'for a given matchup — and anyone you sent the file to picks it up on their next launch.</p>')
    + '</div>';
}

function generateNow(you, them, context){
  var lane = state.lane;
  var ctx = (context || "").trim();
  showWriting(you, them, ctx);

  fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ you: you, them: them, lane: lane, context: ctx })
  })
    .then(function(r){ return r.json().then(function(j){ return { status: r.status, j: j }; }); })
    .then(function(out){
      var j = out.j;
      if (!j.ok){
        $("app").innerHTML = '<div class="state">'
          + '<p class="s1">Couldn’t write that one</p>'
          + '<p class="s2">' + esc(j.error || "unknown error") + '</p>'
          + (j.fatal
              ? '<p class="s2">That usually means the account is out of room for now, or the CLI needs signing in again.</p>'
              : '<button class="go" id="retryGen">Try again</button>')
          + '</div>';
        var rb = $("retryGen");
        if (rb) rb.addEventListener("click", function(){ generateNow(you, them); });
        return;
      }

      var rec = j.record;

      /* A situational rewrite is shown but never folded into the database —
         it describes one game, not the matchup. */
      if (j.variant){
        VARIANT = rec;
        render({ you: rec.you, them: rec.them, lane: rec.lane, context: rec.context, brief: rec.brief },
               { kind: "offline" });
        stampMeta(rec, keyFor(rec.you, rec.them, rec.lane), rec.context);
        window.scrollTo({ top: 0, behavior: "smooth" });
        setNote(baseNote() + " · situational rewrite, kept local", false);
        return;
      }

      DATA.briefs[keyFor(rec.you, rec.them, rec.lane)] = rec;
      DATA.builtAt = Math.max(DATA.builtAt || 0, rec.generatedAt || 0);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(DATA)); } catch (e) {}
      reindex();
      renderRail();
      refreshYouList();
      refreshOpponentList();
      $("you").value = rec.you; $("them").value = rec.them;
      syncTiles();
      scout();
      setNote(baseNote() + " · just written", false);
      // pull fresh coverage and a re-estimated completion date
      fetch("/api/status", { cache: "no-store" })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(st){ if (st && st.coverage){ COVERAGE = st.coverage; renderProgress(); } })
        .catch(function(){});
    })
    .catch(function(e){
      $("app").innerHTML = '<div class="state">'
        + '<p class="s1">Lost the connection</p>'
        + '<p class="s2">The local server stopped responding — ' + esc(e.message) + '. '
        + 'Restart it with <code>node scripts/serve.mjs</code>.</p></div>';
    });
}

function showMissing(you, them){
  var mine = INDEX[you] || [];
  $("app").innerHTML = '<div class="state">'
    + '<p class="s1">' + (CAN_GENERATE ? "Not written yet" : "Not in this build") + '</p>'
    + '<p class="s2">' + esc(you) + ' into ' + esc(them) + ' hasn’t been written yet. '
      + (CAN_GENERATE
          ? 'You can write it now — it takes about a minute, gets saved permanently, and goes out to everyone else on their next launch.'
          : 'This file ships a fixed set of matchups and checks for newer ones on launch, '
            + 'so it can only show what has been written so far.') + '</p>'
    + (CAN_GENERATE
        ? '<button class="go" id="genbtn" style="margin-bottom:22px">Write this matchup</button>'
        : "")
    + (mine.length
        ? '<p class="s2" style="margin-bottom:8px"><strong>' + esc(you) + '</strong> is covered against:</p>'
          + '<div class="browse">'
          + mine.map(function(t){ return '<button class="chip" data-them="' + esc(t) + '">' + esc(t) + '</button>'; }).join("")
          + '</div>'
        : '<p class="s2">Nothing for <strong>' + esc(you) + '</strong> yet. Covered so far: '
          + COVERED.slice(0, 14).map(esc).join(", ")
          + (COVERED.length > 14 ? ", and " + (COVERED.length - 14) + " more." : ".") + '</p>')
    + '</div>';

  $("app").onclick = function(e){
    var g = e.target.closest("#genbtn");
    if (g){ generateNow(you, them, CONTEXT_FEATURE ? state.ctx : ""); return; }
    var b = e.target.closest("button[data-them]"); if (!b) return;
    $("them").value = b.dataset.them; syncTiles(); scout();
  };
}

function scout(){
  syncTiles();
  var you = state.you, them = state.them, lane = state.lane;
  if (!you || !them) return;

  var key = keyFor(you, them, lane);
  var rec = DATA.briefs[key];
  if (!rec){ showMissing(you, them); return; }

  render({ you: rec.you, them: rec.them, lane: rec.lane, context: "", brief: rec.brief },
         { kind: "offline" });
  stampMeta(rec, key);
  lastRendered = key;
  remember(key);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCurrent(){
  if (DATA.briefs[currentKey()]){ scout(); return; }

  /* prefer where the reader left off, then a pin, then anything */
  var resume = live(recents)[0] || live(pins)[0] || Object.keys(DATA.briefs)[0];
  if (resume){
    var r = DATA.briefs[resume];
    $("you").value = r.you; $("them").value = r.them;
    syncTiles(); scout();
  } else {
    render(EXAMPLE, { kind: "example" });
  }
}

/* ---------------- background freshness checks ---------------- */

/* Riot's Data Dragon is public and CORS-open, so even a file:// page can ask
   which patch is live. This only ever adds an honest caveat — it never
   changes a brief. */
function checkPatch(){
  fetch("https://ddragon.leagueoflegends.com/api/versions.json", { cache: "no-store" })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(v){
      if (!v || !v.length) return;
      LIVE_PATCH = v[0];
      if (DATA.patch && LIVE_PATCH !== DATA.patch){
        setNote(baseNote() + " · live is " + LIVE_PATCH + ", some briefs may be stale", true);
      }
      renderCurrent();
    })
    .catch(function(){ /* offline: the file still works, just without the caveat */ });
}

/* Pull fresher briefs if any have been published since this file was sent. */
function checkForNewData(){
  if (!REMOTE_URL) return;
  fetch(REMOTE_URL, { cache: "no-store" })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if (!j || !j.briefs || !(j.builtAt > DATA.builtAt)) return;
      var before = briefCount();
      DATA = { briefs: j.briefs, patch: j.patch, builtAt: j.builtAt };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(DATA)); } catch (e) {}
      reindex();
      renderRail();
      COVERAGE = { done: j.count || briefCount(), total: j.target || COVERAGE.total };
      renderProgress();
      refreshYouList();
      refreshOpponentList();
      renderCurrent();
      var added = briefCount() - before;
      setNote(baseNote() + (added > 0 ? " · updated, +" + added + " new" : " · updated"), false);
    })
    .catch(function(){ /* offline or repo unreachable — baked data stands */ });
}

/* Is this the owner's own copy, served with generation switched on? A file://
   page cannot usefully ask, and a friend's copy will simply get nothing. */
function checkLocalApi(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  fetch("/api/status", { cache: "no-store" })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if (!j || !j.canGenerate) return;
      CAN_GENERATE = true;
      if (CONTEXT_FEATURE) document.querySelector(".ctx").hidden = false;
      refreshOpponentList();
      if (j.coverage){ COVERAGE = j.coverage; renderProgress(); }
      setNote(baseNote() + " · writing enabled", false);
      // if the reader is already staring at a miss, offer the button now
      if (!DATA.briefs[currentKey()] && state.you && state.them) showMissing(state.you, state.them);
    })
    .catch(function(){ /* no local server — read-only, which is the normal case */ });
}

/* ---------------- boot ---------------- */
(function(){
  /* Hidden until we know a local API can act on it. Without one there is no
     model behind this file, so the field could only ever discard what was
     typed — and a control that silently does nothing is worse than absent. */
  document.querySelector(".ctx").hidden = true;

  renderRail();
  renderProgress();
  refreshYouList();
  refreshOpponentList();
  setNote(briefCount() ? baseNote() : "This build has no matchups baked in yet.", false);
  renderCurrent();   // paint immediately from what we already have
  syncTiles();

  checkLocalApi();   // can this copy write new matchups?
  checkPatch();      // then quietly find out if anything is stale
  checkForNewData();
})();
