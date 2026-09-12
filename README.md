# Lane Scout

A shareable, offline League of Legends matchup brief generator.

`dist/lane-scout.html` is the deliverable: one self-contained file. Double-click
it, or send it to anyone. No install, no account, no API key, no network.

## Your copy: look something up, and it gets written

```
node scripts/serve.mjs        http://localhost:8099
```

Opened this way the page finds a local API and switches on writing. Search any
matchup; if it has not been written yet you get a **Write this matchup** button.
It takes about a minute, and then:

- the brief is saved to `data/briefs/` permanently
- `dist/lane-scout.html` and `briefs.json` are rebuilt
- the result is committed and pushed, so **everyone you sent the file to picks
  it up on their next launch**
- the matchup drops out of the scheduled batch queue automatically — the
  queue is derived from which files exist, so nothing is ever written twice

So the database fills from two directions at once: the batches work down the
popularity list on their own, and anything you actually look up jumps the
queue because you needed it.

The push happens after the page has already answered, so you are never left
waiting on git. If it fails the brief is still saved — the next batch run
pushes it.

The same file opened by double-clicking, or sent to a friend, finds no API and
stays read-only. The server binds to loopback only; it drives your Claude
account and is never reachable from the network.

## How updates reach people

The shared file is not frozen. On every launch it does two free, token-less
checks in the background, then falls back silently if either fails:

1. **Fresher briefs** — fetches `briefs.json` from the repo. If it is newer than
   what the file was built with, it swaps in the new data, caches it in the
   browser, and re-renders. So a copy someone downloaded months ago catches up
   on its own the next time they open it online.
2. **Patch drift** — asks Riot's Data Dragon which patch is live and, if the
   briefs were written on an older one, says so in the header rather than
   pretending to be current.

If both fail (no network), the baked-in data still works. That is the whole
point of shipping a single file.

**You publish by running a batch** — it rebuilds and pushes automatically.
Nobody ever needs a new file sent to them again.

This depends on `https://github.com/Jett44/Lane_Scout` staying **public**.
`raw.githubusercontent.com` only sends CORS headers for public repos; make it
private and every distributed copy silently stops updating (it keeps working
on its baked data).

## One-time setup

The batch job drives the Claude CLI headlessly, and the CLI keeps its own login
separate from the Claude desktop app. Until you do this, every scheduled run
will no-op:

```
C:\Users\djnof\.local\bin\claude.exe
```

Run `/login` inside it, then exit. Confirm it took:

```
node scripts/batch.mjs --n=1
```

If that writes a brief, the automation is live.

## How it fills up

Two scheduled tasks generate briefs using quota that would otherwise expire.

| Task | When | Batch |
|---|---|---|
| `LaneScout-5h` | every 5 hours, 10 min before each window closes | 25 briefs |
| `LaneScout-Weekly` | Thursdays 6pm, ahead of the 8pm weekly reset | 200 briefs |

Both are resumable by construction. Each brief is written to its own file the
moment it validates, so a run that is killed, times out, or hits the quota
ceiling keeps everything it finished — the next run continues from exactly
there. Nothing is ever generated twice.

Work is ordered by how likely you are to play the matchup, so the popular
champions are covered long before the long tail.

## Patch updates

Every batch run first checks Riot's Data Dragon for the live patch. This costs
no tokens — it is public data. If the patch moved, it diffs champion and item
data against the previous patch and invalidates only the briefs that are
actually affected:

- the brief is about a champion Riot changed, or
- the brief's build recommends an item Riot changed

Those files are deleted, which puts them back in the queue ahead of the
never-written ones, so the next few runs refresh them automatically. A typical
patch touches ~13 of 173 champions and a handful of items, which works out to
roughly 200 of 3,080 briefs — about one Thursday batch.

```
node scripts/patch.mjs           report what changed and what is stale
node scripts/patch.mjs --apply   invalidate them now instead of waiting
```

`data/patch-state.json` records the last patch seen. Every brief stores the
patch it was written on.

## Commands

```
node scripts/batch.mjs --status      coverage so far
node scripts/batch.mjs --n=3 --dry   what it would do next, spends nothing
node scripts/batch.mjs --n=25        generate 25 briefs, then rebuild
node scripts/build.mjs               rebuild dist/ from what exists
node scripts/verify.mjs              check the build before sharing it
```

## Layout

```
data/briefs/<you>__<them>__<lane>.json   one brief per file, the source of truth
template/app.html                        UI shell (CSS + renderer)
template/offline.js                      offline lookup spliced in at build time
scripts/lib.mjs                          champion pool, prompt, validation
dist/lane-scout.html                     the file you send people
logs/                                    per-run logs
```

The build splices `offline.js` into `app.html` at the marker
`/* ---------------- scout ---------------- */`, replacing the live-Claude call
with a lookup into the baked data. If you edit `app.html`, keep that marker.

## Changing scope

`POOL.Top` in `scripts/lib.mjs` is the champion list, ordered by how often you
meet them. Add a champion and the new pairs are picked up automatically on the
next run. Adding a lane means adding a key to `POOL`, then running batches with
`--lane=Mid`.

## Known limits

- Briefs are frozen at generation time. When a patch moves items, regenerate the
  affected ones by deleting their JSON files and re-running.
- The scheduled tasks only run while you are logged in to Windows. Missed runs
  fire at next login (`-StartWhenAvailable`).
- Fonts load from Google Fonts. Offline they fall back to the stacks declared in
  the CSS, which is by design — embedding them would multiply the file size.
