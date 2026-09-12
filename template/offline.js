/* ---------------- offline lookup + self-update ---------------- */

/* The shared build has no Claude behind it, so it can never write a brief.
   What it can do is pick up fresher data that was pushed since the file was
   sent, and tell the truth about which patch its briefs were written on.

   Order of preference, newest wins:
     1. data fetched from the repo just now
     2. data cached in this browser from an earlier launch
     3. the data baked into this file  (always works, even offline) */

sampleFn = true;

var CACHE_KEY = "lanescout.data.v1";
var DATA = { briefs: BRIEFS, patch: META.patch, builtAt: META.builtAt };
var INDEX = {}, COVERED = [];

try {
  var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  if (cached && cached.briefs && cached.builtAt > DATA.builtAt) DATA = cached;
} catch (e) { /* private window, or storage disabled — baked data is fine */ }

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

function setNote(text, warn){
  $("barnote").className = warn ? "barnote warn" : "barnote";
  $("barnote").textContent = text;
}

function baseNote(){
  return briefCount() + " matchups · patch " + (DATA.patch || "unknown") + " · works offline";
}

/* ---------------- rendering ---------------- */

function stampMeta(rec){
  var m = document.querySelector(".metaline");
  if (!m) return;
  var bits = ['<span class="stamp">written ' + esc(new Date(rec.generatedAt).toISOString().slice(0,10)) + '</span>'];
  if (rec.patch) bits.push('<span class="badge">patch ' + esc(rec.patch) + '</span>');
  if (LIVE_PATCH && rec.patch && LIVE_PATCH !== rec.patch){
    bits.push('<span class="badge hot">live is ' + esc(LIVE_PATCH) + '</span>');
  }
  m.innerHTML = bits.join("");
}

function showMissing(you, them){
  var mine = INDEX[you] || [];
  $("app").innerHTML = '<div class="state">'
    + '<p class="s1">Not in this build</p>'
    + '<p class="s2">' + esc(you) + ' into ' + esc(them) + ' hasn’t been written yet. '
      + 'This file ships a fixed set of matchups and checks for newer ones on launch, '
      + 'so it can only show what has been written so far.</p>'
    + (mine.length
        ? '<p class="s2" style="margin-bottom:8px"><strong>' + esc(you) + '</strong> is covered against:</p>'
          + '<div class="recents" style="border-top:0;padding-top:0">'
          + mine.map(function(t){ return '<button class="chip" data-them="' + esc(t) + '">' + esc(t) + '</button>'; }).join("")
          + '</div>'
        : '<p class="s2">Nothing for <strong>' + esc(you) + '</strong> yet. Covered so far: '
          + COVERED.slice(0,14).map(esc).join(", ")
          + (COVERED.length > 14 ? ", and " + (COVERED.length - 14) + " more." : ".") + '</p>')
    + '</div>';

  $("app").onclick = function(e){
    var b = e.target.closest("button[data-them]"); if (!b) return;
    $("them").value = b.dataset.them; syncTiles(); scout();
  };
}

function scout(){
  syncTiles();
  var you = state.you, them = state.them, lane = state.lane;
  if (!you || !them) return;

  var rec = DATA.briefs[keyFor(you, them, lane)];
  if (!rec){ showMissing(you, them); return; }

  render({ you: rec.you, them: rec.them, lane: rec.lane, context: "", brief: rec.brief },
         { kind: "offline" });
  stampMeta(rec);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* The chip rail is a champion browser: pick who you play, and the opponent
   field jumps to something this build actually covers. */
function loadRecents(){
  if (!COVERED.length){ $("recents").hidden = true; return; }
  $("recents").hidden = false;
  $("recents").innerHTML = '<span class="rl">Covered</span>' + COVERED.map(function(c){
    return '<button class="chip" data-you="' + esc(c) + '">' + esc(c) + '</button>';
  }).join("");
  $("recents").onclick = function(e){
    var b = e.target.closest("button[data-you]"); if (!b) return;
    $("you").value = b.dataset.you;
    var first = (INDEX[b.dataset.you] || [])[0];
    if (first) $("them").value = first;
    syncTiles(); scout();
  };
}

function renderCurrent(){
  var seed = DATA.briefs[keyFor(state.you, state.them, state.lane)];
  if (seed){ scout(); return; }
  var keys = Object.keys(DATA.briefs);
  if (keys.length){
    var r = DATA.briefs[keys[0]];
    $("you").value = r.you; $("them").value = r.them;
    syncTiles(); scout();
  } else {
    render(EXAMPLE, { kind: "example" });
  }
}

/* ---------------- background freshness checks ---------------- */

var LIVE_PATCH = null;

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
      loadRecents();
      renderCurrent();
      var added = briefCount() - before;
      setNote(baseNote() + (added > 0 ? " · updated, +" + added + " new" : " · updated"), false);
    })
    .catch(function(){ /* offline or repo unreachable — baked data stands */ });
}

/* ---------------- boot ---------------- */
(function(){
  loadRecents();
  setNote(briefCount() ? baseNote() : "This build has no matchups baked in yet.", false);
  renderCurrent();   // paint immediately from what we already have
  syncTiles();

  checkPatch();      // then quietly find out if anything is stale
  checkForNewData();
})();
