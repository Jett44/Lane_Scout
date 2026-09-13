/* ---------------- offline lookup + self-update ---------------- */

/* Order of preference for the data, newest wins:
     1. fetched from the repo just now
     2. cached in this browser from an earlier launch
     3. baked into this file  (always works, even offline) */

sampleFn = true;

var CACHE_KEY   = "lanescout.data.v1";
var PINS_KEY    = "lanescout.pins.v1";
var RECENT_KEY  = "lanescout.recent.v1";
var SIDEBAR_KEY = "lanescout.sidebar.v1";

var DATA = { briefs: BRIEFS, patch: META.patch, builtAt: META.builtAt };
var INDEX = {}, COVERED = [];
var LIVE_PATCH = null;
var CAN_GENERATE = false;
var VARIANT = null;

/* ARCHIVED — the "Anything else" contextual rewrite. Parked, not deleted; the
   whole path still exists behind this flag. See README. */
var CONTEXT_FEATURE = false;

var COVERAGE = { done: META.count, total: META.target || 0 };

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
} catch (e) {}

/* ---------------- Riot icons ---------------- */

/* Names in a brief are prose ("Doran's Shield + Health Potion"), while Riot
   indexes by id — so match on the exact name first, then the best containment
   either way. Anything unmatched simply renders without an icon: the text has
   always been the thing carrying the meaning. */
var DD = "https://ddragon.leagueoflegends.com";
var iconCache = {};

function lookupIcon(kind, name){
  var map = ASSETS && ASSETS[kind];
  if (!map || !name) return null;
  var ck = kind + "|" + name;
  if (ck in iconCache) return iconCache[ck];

  var k = String(name).toLowerCase().trim();
  var file = map[k];

  if (!file){
    var best = null;
    for (var cand in map){
      if (k.indexOf(cand) !== -1 || cand.indexOf(k) !== -1){
        if (!best || cand.length > best.length) best = cand;
      }
    }
    if (best) file = map[best];
  }

  var url = null;
  if (file){
    if (kind === "rune")      url = DD + "/cdn/img/" + file;
    else if (kind === "item") url = DD + "/cdn/" + ASSETS.version + "/img/item/" + file;
    else if (kind === "spell")url = DD + "/cdn/" + ASSETS.version + "/img/spell/" + file;
    else if (kind === "champ")url = DD + "/cdn/" + ASSETS.version + "/img/champion/" + file;
  }
  iconCache[ck] = url;
  return url;
}

function iconImg(kind, name, cls){
  var url = lookupIcon(kind, name);
  if (!url) return "";
  return '<img class="ic ' + (cls || "") + '" src="' + esc(url) + '" alt="" loading="lazy" '
    + 'onerror="this.style.display=\'none\'">';
}

/* ---------------- styles ---------------- */
(function(){
  var s = document.createElement("style");
  s.textContent =
    /* scrollbar gutter keeps the header from re-wrapping as briefs change length */
    "html{scrollbar-gutter:stable}" +
    ".field[hidden]{display:none!important}" +
    ".go{flex:none}" +

    /* --- icons --- */
    ".ic{width:22px;height:22px;border-radius:3px;vertical-align:middle;flex:none;" +
      "background:var(--surface-2)}" +
    ".ic.sm{width:17px;height:17px;border-radius:2px}" +
    ".ic.lg{width:28px;height:28px}" +
    ".ic.rune{border-radius:50%;background:transparent}" +

    /* --- sidebar --- */
    "#sb{position:fixed;top:0;left:0;bottom:0;width:246px;background:var(--surface);" +
      "border-right:1px solid var(--line);z-index:40;display:flex;flex-direction:column;" +
      "transform:translateX(0);transition:transform .22s ease;overflow:hidden}" +
    "body.sb-closed #sb{transform:translateX(-246px)}" +
    "body.sb-open{padding-left:246px}" +
    "@media (max-width:900px){body.sb-open{padding-left:0}#sb{box-shadow:var(--shadow)}}" +
    "#sb .sbhead{display:flex;align-items:center;justify-content:space-between;gap:8px;" +
      "padding:14px 14px 12px;border-bottom:1px solid var(--line)}" +
    "#sb .sbhead b{font-family:var(--display);font-weight:700;font-size:17px;" +
      "letter-spacing:.10em;text-transform:uppercase;line-height:1}" +
    "#sb .sbbody{overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:20px;flex:1}" +
    "#sb h4{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;" +
      "color:var(--ink-3);margin:0 0 8px;font-weight:400}" +
    ".sbitem{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;" +
      "background:transparent;border-radius:3px;padding:5px 6px;cursor:pointer;color:var(--ink-2);" +
      "font-family:var(--display);font-weight:600;font-size:14.5px;letter-spacing:.01em}" +
    ".sbitem:hover{background:var(--surface-2);color:var(--ink)}" +
    ".sbitem.on{color:var(--accent)}" +
    ".sbitem .vs{font-size:10px;letter-spacing:.1em;color:var(--ink-3);padding:0}" +
    ".sbempty{font-family:var(--mono);font-size:10px;line-height:1.6;color:var(--ink-3)}" +
    ".sbtoggle{border:1px solid var(--line-strong);background:transparent;border-radius:3px;" +
      "cursor:pointer;color:var(--ink-2);font-family:var(--mono);font-size:13px;line-height:1;" +
      "padding:9px 10px}" +
    ".sbtoggle:hover{border-color:var(--accent);color:var(--accent)}" +
    "#sbopen{position:fixed;top:12px;left:12px;z-index:39;display:none}" +
    "body.sb-closed #sbopen{display:block}" +
    /* the sidebar carries the wordmark while it is open — don't print it twice */
    "body.sb-open .mark{display:none}" +
    "body.sb-closed .bar-inner{padding-left:44px}" +

    /* --- progress --- */
    ".prog{display:flex;flex-direction:column;gap:7px}" +
    ".prog-track{height:4px;border-radius:99px;background:var(--surface-2);overflow:hidden}" +
    ".prog-fill{height:100%;background:var(--accent);border-radius:99px;transition:width .5s ease;min-width:2px}" +
    ".prog-line{display:flex;flex-direction:column;gap:3px;font-family:var(--mono);font-size:10px;" +
      "letter-spacing:.06em;color:var(--ink-3);line-height:1.5}" +
    ".prog-line b{color:var(--ink);font-weight:500;font-variant-numeric:tabular-nums}" +
    ".prog-line .eta{color:var(--accent)}" +

    /* --- champion picker --- */
    ".pickwrap{position:relative}" +
    "#pick{position:absolute;z-index:60;background:var(--surface);border:1px solid var(--line-strong);" +
      "border-radius:4px;box-shadow:var(--shadow);width:322px;max-height:326px;overflow-y:auto;padding:7px}" +
    "#pick .pgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:2px}" +
    ".pick-it{display:flex;align-items:center;gap:8px;border:0;background:transparent;cursor:pointer;" +
      "border-radius:3px;padding:5px 6px;text-align:left;color:var(--ink);font-family:var(--display);" +
      "font-weight:600;font-size:14px;letter-spacing:.01em;min-width:0}" +
    ".pick-it span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".pick-it:hover,.pick-it.sel{background:var(--accent);color:#fff}" +
    ".pick-it.has{color:var(--accent)}" +
    ".pick-it.has:hover,.pick-it.has.sel{color:#fff}" +
    /* not written yet: visible, but clearly not the same thing */
    ".pick-it.none{color:var(--ink-3)}" +
    ".pick-it.none .ic{opacity:.45;filter:grayscale(1)}" +
    ".pick-it.none:hover,.pick-it.none.sel{color:#fff}" +
    ".pick-it.none:hover .ic,.pick-it.none.sel .ic{opacity:1;filter:none}" +

    /* --- skill order --- */
    ".skills{display:flex;gap:3px;flex-wrap:wrap}" +
    ".sk{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:19px}" +
    ".sk .lv{font-family:var(--mono);font-size:8.5px;color:var(--ink-3);font-variant-numeric:tabular-nums}" +
    ".sk .ab{width:19px;height:19px;display:grid;place-items:center;border-radius:2px;" +
      "font-family:var(--display);font-weight:700;font-size:12px;background:var(--surface-2);color:var(--ink)}" +
    ".sk.r .ab{background:var(--accent);color:#fff}" +
    ".skillnote{font-family:var(--mono);font-size:10px;letter-spacing:.05em;color:var(--ink-3);margin:9px 0 0}" +
    ".pick-none{padding:12px;font-family:var(--mono);font-size:10.5px;color:var(--ink-3);line-height:1.6}" +
    ".pickhint{padding:5px 7px 8px;font-family:var(--mono);font-size:9px;letter-spacing:.1em;" +
      "text-transform:uppercase;color:var(--ink-3);border-bottom:1px solid var(--line);margin-bottom:6px}" +

    /* --- icon rows --- */
    ".item .nm{display:flex;align-items:center;gap:8px}" +
    ".keystone .nm{display:flex;align-items:center;gap:9px}" +
    ".runerow .rv{display:flex;flex-wrap:wrap;align-items:center;gap:4px 7px}" +
    ".runerow .rv .rn{display:inline-flex;align-items:center;gap:5px}" +
    ".sum{display:inline-flex;align-items:center;gap:7px}";
  document.head.appendChild(s);
})();

/* ---------------- index ---------------- */

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
function label(key){ var r = DATA.briefs[key]; return r ? r.you + " › " + r.them : null; }
function currentKey(){ return keyFor(state.you, state.them, state.lane); }

function setNote(text, warn){
  $("barnote").className = warn ? "barnote warn" : "barnote";
  $("barnote").textContent = text;
}
function baseNote(){
  return briefCount() + " matchups · patch " + (DATA.patch || "unknown") + " · works offline";
}

/* ---------------- sidebar ---------------- */

var sb = document.createElement("aside");
sb.id = "sb";
sb.innerHTML =
  '<div class="sbhead"><b>Lane Scout</b>'
  + '<button class="sbtoggle" id="sbclose" aria-label="Hide sidebar" title="Hide sidebar">&#10005;</button></div>'
  + '<div class="sbbody">'
  +   '<section><h4>Coverage</h4><div class="prog" id="progbox"></div></section>'
  +   '<section><h4>Saved</h4><div id="sbpins"></div></section>'
  +   '<section><h4>Recent</h4><div id="sbrecent"></div></section>'
  + '</div>';
document.body.insertBefore(sb, document.body.firstChild);

var sbOpenBtn = document.createElement("button");
sbOpenBtn.id = "sbopen";
sbOpenBtn.className = "sbtoggle";
sbOpenBtn.setAttribute("aria-label", "Show sidebar");
sbOpenBtn.title = "Show sidebar";
sbOpenBtn.innerHTML = "&#9776;";
document.body.appendChild(sbOpenBtn);

function setSidebar(open){
  document.body.classList.toggle("sb-open", open);
  document.body.classList.toggle("sb-closed", !open);
  try { localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0"); } catch (e) {}
}
$("sbclose").addEventListener("click", function(){ setSidebar(false); });
sbOpenBtn.addEventListener("click", function(){ setSidebar(true); });

/* narrow screens start collapsed; otherwise honour the last choice */
(function(){
  var stored = null;
  try { stored = localStorage.getItem(SIDEBAR_KEY); } catch (e) {}
  setSidebar(stored === null ? window.innerWidth > 900 : stored === "1");
})();

/* ---------------- progress ---------------- */

function etaPhrase(days){
  if (days <= 0)  return "complete";
  if (days < 1)   return "complete today";
  if (days < 2)   return "complete in about a day";
  if (days < 14)  return "complete in " + Math.round(days) + " days";
  if (days < 60)  return "complete in " + Math.round(days / 7) + " weeks";
  return "complete in " + Math.round(days / 30.4) + " months";
}

function renderProgress(){
  var box = $("progbox"); if (!box) return;
  var done = COVERAGE.done || 0, total = COVERAGE.total || 0;
  if (!total){ box.innerHTML = ""; return; }

  var pct = Math.min(100, (done / total) * 100);
  /* each line must be one element — .prog-line is a column flex container, so
     loose text nodes and inline tags would each become their own row */
  var lines = ["<b>" + done.toLocaleString() + "</b> of <b>" + total.toLocaleString() + "</b>"
    + " &middot; " + (pct < 0.1 && pct > 0 ? "&lt;0.1" : pct.toFixed(1)) + "%"];

  if (done >= total){
    lines.push('<span class="eta">every matchup written</span>');
  } else if (COVERAGE.ratePerDay > 0 && COVERAGE.etaDays != null){
    lines.push(COVERAGE.ratePerDay.toFixed(1) + "/day");
    lines.push('<span class="eta">' + etaPhrase(COVERAGE.etaDays) + "</span>");
  } else if (COVERAGE.why){
    lines.push(esc(COVERAGE.why));
  }

  box.innerHTML = '<div class="prog-track"><div class="prog-fill" style="width:' + pct.toFixed(2) + '%"></div></div>'
    + '<div class="prog-line">'
    + lines.map(function(l){ return "<div>" + l + "</div>"; }).join("")
    + '</div>';
}

/* ---------------- pins & history ---------------- */

function isPinned(key){ return pins.indexOf(key) !== -1; }
function live(list){ return list.filter(function(k){ return !!DATA.briefs[k]; }); }

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

function sbRow(key, starred){
  var r = DATA.briefs[key]; if (!r) return "";
  var on = key === currentKey() ? " on" : "";
  return '<button class="sbitem' + on + '" data-key="' + esc(key) + '">'
    + iconImg("champ", r.you, "sm")
    + '<span class="vs">›</span>'
    + iconImg("champ", r.them, "sm")
    + '<span>' + esc(r.you) + " › " + esc(r.them) + '</span></button>';
}

function renderRail(){
  var p = live(pins);
  var r = live(recents).filter(function(k){ return p.indexOf(k) === -1; });

  $("sbpins").innerHTML = p.length
    ? p.map(function(k){ return sbRow(k, true); }).join("")
    : '<div class="sbempty">Star a matchup and it lands here.</div>';

  $("sbrecent").innerHTML = r.length
    ? r.map(function(k){ return sbRow(k, false); }).join("")
    : '<div class="sbempty">Matchups you open show up here.</div>';

  /* the old in-header rail is replaced by the sidebar */
  $("recents").hidden = true;
}

sb.addEventListener("click", function(e){
  var b = e.target.closest("button[data-key]"); if (!b) return;
  var rec = DATA.briefs[b.dataset.key]; if (!rec) return;
  $("you").value = rec.you; $("them").value = rec.them;
  syncTiles(); scout();
  if (window.innerWidth <= 900) setSidebar(false);
});

/* ---------------- champion picker ---------------- */

/* Replaces the native datalist. Clicking a field selects the text so typing
   overwrites it, and opens the full roster with portraits — the list is the
   point, not just autocomplete once you already know the name. */
["you", "them"].forEach(function(id){ $(id).removeAttribute("list"); });

var pick = document.createElement("div");
pick.id = "pick";
pick.hidden = true;
document.body.appendChild(pick);

var pickFor = null, pickSel = 0, pickList = [];

/* The field arrives already filled and selected, ready to be typed over. If we
   filtered by that existing value the panel would show one champion — the one
   you are about to replace. So the list stays unfiltered until you actually
   type a character. */
var pickTyped = false;

function pickCandidates(which, q){
  /* Always offer the whole roster. Showing only champions that happen to have
     a brief makes the app look broken: you go looking for Gnar, he is not
     there, and nothing explains why. Written ones sort first and are marked,
     the rest stay visible but dimmed, and picking one says plainly that it has
     not been written yet. */
  var covered = which === "them"
    ? (INDEX[$("you").value.trim()] || [])
    : COVERED;
  var all = covered.concat(CHAMPS.filter(function(c){ return covered.indexOf(c) === -1; }));
  if (!q) return all;
  var lq = q.toLowerCase();
  var starts = [], contains = [];
  all.forEach(function(c){
    var lc = c.toLowerCase();
    if (lc.indexOf(lq) === 0) starts.push(c);
    else if (lc.replace(/[^a-z]/g, "").indexOf(lq.replace(/[^a-z]/g, "")) !== -1) contains.push(c);
  });
  return starts.concat(contains);
}

function hasBrief(which, champ){
  if (which === "you") return !!INDEX[champ];
  var you = $("you").value.trim();
  return (INDEX[you] || []).indexOf(champ) !== -1;
}

function placePick(input){
  var r = input.getBoundingClientRect();
  pick.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 334)) + "px";
  pick.style.top = (r.bottom + 6) + "px";
  pick.style.position = "fixed";
}

function renderPick(){
  if (!pickFor) return;
  var input = $(pickFor);
  pickList = pickCandidates(pickFor, pickTyped ? input.value.trim() : "");
  if (pickSel >= pickList.length) pickSel = 0;

  var written = pickList.filter(function(c){ return hasBrief(pickFor, c); }).length;
  var hint = (pickFor === "them" ? "opponents" : "champions")
    + " — " + written + " written, dimmed ones not yet";

  pick.innerHTML = pickList.length
    ? '<div class="pickhint">' + hint + '</div><div class="pgrid">'
      + pickList.slice(0, 120).map(function(c, i){
          return '<button class="pick-it ' + (hasBrief(pickFor, c) ? "has" : "none")
            + (i === pickSel ? " sel" : "") + '" data-champ="' + esc(c) + '">'
            + iconImg("champ", c, "sm") + '<span>' + esc(c) + '</span></button>';
        }).join("") + '</div>'
    : '<div class="pick-none">No champion matches that.</div>';

  placePick(input);
  pick.hidden = false;
}

function closePick(){ pick.hidden = true; pickFor = null; }

function choose(champ){
  if (!pickFor) return;
  var which = pickFor;
  $(which).value = champ;
  syncTiles();
  closePick();
  if (which === "you"){
    // opponent may no longer be covered for this champion — let them pick again
    $("them").focus();
  } else {
    scout();
  }
}

["you", "them"].forEach(function(id){
  var el = $(id);
  el.addEventListener("focus", function(){
    el.select();                 // typing overwrites instead of appending
    pickFor = id; pickSel = 0; pickTyped = false; renderPick();
  });
  el.addEventListener("click", function(){
    if (pick.hidden){ pickFor = id; pickSel = 0; pickTyped = false; renderPick(); }
  });
  el.addEventListener("input", function(){
    pickFor = id; pickSel = 0; pickTyped = true; renderPick();
  });
  el.addEventListener("keydown", function(e){
    if (pick.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      pickSel += (e.key === "ArrowDown" ? 1 : -1);
      if (pickSel < 0) pickSel = pickList.length - 1;
      if (pickSel >= pickList.length) pickSel = 0;
      renderPick();
      var selEl = pick.querySelector(".pick-it.sel");
      if (selEl) selEl.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter"){
      e.preventDefault();
      if (pickList[pickSel]) choose(pickList[pickSel]);
    } else if (e.key === "Escape"){
      closePick();
    }
  });
  el.addEventListener("blur", function(){
    // let a click on the panel land before it closes
    setTimeout(function(){ if (pickFor === id) closePick(); }, 140);
  });
});

pick.addEventListener("mousedown", function(e){ e.preventDefault(); });
pick.addEventListener("click", function(e){
  var b = e.target.closest("button[data-champ]"); if (!b) return;
  choose(b.dataset.champ);
});
window.addEventListener("resize", function(){ if (!pick.hidden && pickFor) placePick($(pickFor)); });
window.addEventListener("scroll", function(){ if (!pick.hidden && pickFor) placePick($(pickFor)); }, true);

/* ---------------- rendering ---------------- */

/* Overrides the plain-text version from the template so build rows carry
   Riot's item art. Declared later in the same scope, so every caller — the
   renderer included — picks this up. */
function itemRow(it, slotLabel, numbered, sit){
  if (!it) return "";
  var why = sit ? '<span class="ifk">IF </span>' + esc(it.when) : esc(it.why);
  return '<div class="item' + (sit ? " sit" : "") + '">'
    + '<div class="slot' + (numbered ? " n" : "") + '">' + esc(slotLabel) + '</div>'
    + '<div><div class="nm">' + iconImg("item", it.item) + '<span>' + esc(it.item) + '</span></div>'
    + '<p class="wy">' + why + '</p></div></div>';
}

/* Runes and summoners are built inside the template's renderer, so decorate
   them afterwards from the same data rather than duplicating the renderer. */
/* Skill order comes straight from the measured data, not from the model —
   there is no reason to round-trip a fact through a language model. One cell
   per level, with the ultimate picked out. */
function skillOrderHtml(rec){
  var so = rec && rec.stats && rec.stats.skillOrder && rec.stats.skillOrder[0];
  var order = so && so.order;
  if (!order || !order.length) return "";

  var cells = order.map(function(ab, i){
    var a = String(ab).toUpperCase();
    return '<div class="sk ' + a.toLowerCase() + '">'
      + '<div class="lv">' + (i + 1) + '</div>'
      + '<div class="ab">' + esc(a) + '</div></div>';
  }).join("");

  return '<section class="sec"><h2>Skill order</h2>'
    + '<div class="skills">' + cells + '</div>'
    + (so.winRate != null
        ? '<p class="skillnote">' + so.winRate + '% over ' + so.play + ' games</p>'
        : "")
    + '</section>';
}

function decorate(brief, rec){
  var runes = brief.runes || {};

  var ks = document.querySelector(".keystone .nm");
  if (ks && runes.keystone){
    ks.innerHTML = iconImg("rune", runes.keystone, "lg rune") + "<span>" + esc(runes.keystone) + "</span>";
  }

  var rows = document.querySelectorAll(".runerow");
  var sets = [runes.primary, runes.secondary, runes.shards];
  for (var i = 0; i < rows.length && i < sets.length; i++){
    var list = arr(sets[i]);
    if (!list.length) continue;
    var rv = rows[i].querySelector(".rv");
    if (!rv) continue;
    // shards have no Riot art; they render as plain text
    rv.innerHTML = list.map(function(n){
      var ic = i === 2 ? "" : iconImg("rune", n, "sm rune");
      return '<span class="rn">' + ic + esc(n) + "</span>";
    }).join('<em>/</em>');
  }

  var picks = arr(brief.summoners && brief.summoners.picks);
  var sums = document.querySelectorAll(".sum");
  for (var j = 0; j < sums.length && j < picks.length; j++){
    sums[j].innerHTML = iconImg("spell", picks[j], "sm") + "<span>" + esc(picks[j]) + "</span>";
  }

  /* Slot the skill order into the rail, straight after the build order. */
  var html = skillOrderHtml(rec);
  if (html){
    var rail = document.querySelector(".rail");
    var secs = rail && rail.querySelectorAll(".sec");
    if (rail && secs && secs.length){
      var holder = document.createElement("div");
      holder.innerHTML = html;
      rail.insertBefore(holder.firstChild, secs[1] || null);
    }
  }
}

function stampMeta(rec, key, shownContext){
  var m = document.querySelector(".metaline");
  if (!m) return;
  var bits = [];

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
  if (CONTEXT_FEATURE && !shownContext && CAN_GENERATE && state.ctx){
    bits.push('<button class="pinbtn" id="ctxbtn">↻ rewrite for “' + esc(state.ctx) + '”</button>');
  }

  m.innerHTML = bits.join("");

  var pb = $("pinbtn");  if (pb) pb.addEventListener("click", function(){ togglePin(key); });
  var cb = $("ctxbtn");  if (cb) cb.addEventListener("click", function(){ generateNow(state.you, state.them, state.ctx); });
  var bb = $("backbtn"); if (bb) bb.addEventListener("click", function(){ VARIANT = null; scout(); });
}

/* ---------------- writing on demand ---------------- */

function showWriting(you, them, ctx){
  $("app").innerHTML = '<div class="state"><div class="pulse"><i></i><i></i><i></i><i></i><i></i></div>'
    + '<p class="s1">' + (ctx ? "Rewriting " : "Writing ") + esc(you) + ' into ' + esc(them) + '</p>'
    + '<p class="s2" aria-live="polite">Takes about a minute. It gets saved, so this only ever happens once '
      + 'for a given matchup — and anyone you sent the file to picks it up on their next launch.</p></div>';
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
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (!j.ok){
        $("app").innerHTML = '<div class="state">'
          + '<p class="s1">Couldn’t write that one</p>'
          + '<p class="s2">' + esc(j.error || "unknown error") + '</p>'
          + (j.fatal
              ? '<p class="s2">That usually means the account is out of room for now, or the CLI needs signing in again.</p>'
              : '<button class="go" id="retryGen">Try again</button>')
          + '</div>';
        var rb = $("retryGen");
        if (rb) rb.addEventListener("click", function(){ generateNow(you, them, ctx); });
        return;
      }

      var rec = j.record;
      if (j.variant){
        VARIANT = rec;
        render({ you: rec.you, them: rec.them, lane: rec.lane, context: rec.context, brief: rec.brief },
               { kind: "offline" });
        decorate(rec.brief, rec);
        stampMeta(rec, keyFor(rec.you, rec.them, rec.lane), rec.context);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      DATA.briefs[keyFor(rec.you, rec.them, rec.lane)] = rec;
      DATA.builtAt = Math.max(DATA.builtAt || 0, rec.generatedAt || 0);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(DATA)); } catch (e) {}
      reindex();
      $("you").value = rec.you; $("them").value = rec.them;
      syncTiles();
      scout();
      setNote(baseNote() + " · just written", false);
      fetch("/api/status", { cache: "no-store" })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(st){ if (st && st.coverage){ COVERAGE = st.coverage; renderProgress(); } })
        .catch(function(){});
    })
    .catch(function(e){
      $("app").innerHTML = '<div class="state"><p class="s1">Lost the connection</p>'
        + '<p class="s2">The local server stopped responding — ' + esc(e.message) + '. '
        + 'Restart it with <code>node scripts/serve.mjs</code>.</p></div>';
    });
}

/* ---------------- lookup ---------------- */

function showMissing(you, them){
  var mine = INDEX[you] || [];
  $("app").innerHTML = '<div class="state">'
    + '<p class="s1">' + (CAN_GENERATE ? "Not written yet" : "Not in this build") + '</p>'
    + '<p class="s2">' + esc(you) + ' into ' + esc(them) + ' hasn’t been written yet. '
      + (CAN_GENERATE
          ? 'You can write it now — it takes about a minute, gets saved permanently, and goes out to everyone else on their next launch.'
          : 'This file ships a fixed set of matchups and checks for newer ones on launch, '
            + 'so it can only show what has been written so far.') + '</p>'
    + (CAN_GENERATE ? '<button class="go" id="genbtn" style="margin-bottom:22px">Write this matchup</button>' : "")
    + (mine.length
        ? '<p class="s2" style="margin-bottom:8px"><strong>' + esc(you) + '</strong> is covered against:</p>'
          + '<div class="browse" style="display:flex;flex-wrap:wrap;gap:7px">'
          + mine.map(function(t){
              return '<button class="chip" data-them="' + esc(t) + '">'
                + iconImg("champ", t, "sm") + " " + esc(t) + '</button>'; }).join("")
          + '</div>'
        : '<p class="s2">Nothing for <strong>' + esc(you) + '</strong> yet.</p>')
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
  decorate(rec.brief, rec);
  stampMeta(rec, key);
  remember(key);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

var lastRendered = null, autoTimer = null;
function maybeAuto(){
  clearTimeout(autoTimer);
  autoTimer = setTimeout(function(){
    var k = keyFor($("you").value.trim(), $("them").value.trim(), state.lane);
    if (DATA.briefs[k] && k !== lastRendered){ lastRendered = k; scout(); }
  }, 120);
}
["you", "them"].forEach(function(id){ $(id).addEventListener("input", maybeAuto); });
$("go").addEventListener("click", function(){ closePick(); scout(); });

function renderCurrent(){
  if (DATA.briefs[currentKey()]){ scout(); return; }
  var resume = live(recents)[0] || live(pins)[0] || Object.keys(DATA.briefs)[0];
  if (resume){
    var r = DATA.briefs[resume];
    $("you").value = r.you; $("them").value = r.them;
    syncTiles(); scout();
  } else {
    render(EXAMPLE, { kind: "example" });
  }
}

/* ---------------- background checks ---------------- */

function checkPatch(){
  fetch(DD + "/api/versions.json", { cache: "no-store" })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(v){
      if (!v || !v.length) return;
      LIVE_PATCH = v[0];
      if (DATA.patch && LIVE_PATCH !== DATA.patch){
        setNote(baseNote() + " · live is " + LIVE_PATCH + ", some briefs may be stale", true);
      }
      renderCurrent();
    })
    .catch(function(){});
}

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
      renderCurrent();
      var added = briefCount() - before;
      setNote(baseNote() + (added > 0 ? " · updated, +" + added + " new" : " · updated"), false);
    })
    .catch(function(){});
}

function checkLocalApi(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  fetch("/api/status", { cache: "no-store" })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if (!j || !j.canGenerate) return;
      CAN_GENERATE = true;
      if (CONTEXT_FEATURE) document.querySelector(".ctx").hidden = false;
      if (j.coverage){ COVERAGE = j.coverage; renderProgress(); }
      setNote(baseNote() + " · writing enabled", false);
      if (!DATA.briefs[currentKey()] && state.you && state.them) showMissing(state.you, state.them);
    })
    .catch(function(){});
}

/* ---------------- boot ---------------- */
(function(){
  document.querySelector(".ctx").hidden = true;

  renderRail();
  renderProgress();
  setNote(briefCount() ? baseNote() : "This build has no matchups baked in yet.", false);
  renderCurrent();
  syncTiles();

  checkLocalApi();
  checkPatch();
  checkForNewData();
})();
