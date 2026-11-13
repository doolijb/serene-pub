# REPORT — hist-F: docs and vocabulary for the history build — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs and reports: `plans/briefs/{BRIEF,REPORT}-hist-F-w{1,2}.md`. No code changed.

## Pages
- **`lorebook-time.md`:** one entry per date, rule C forking, the first-write fork, Compile forking riding sessions, and the next-chapter clock link.
- **`summarization.md`:** New uses the day's entry; scene notes; Compile always merges through the model and stays a person's press.
- **`sessions.md`:** branch off carries uncompiled scenes; next chapter carries the clock; a scene isn't a lorebook write.
- **`lorebooks.md`:** the two Loose-ends chores.
- **`genre-dungeon-crawler.md`:** no cairns (deceased, narrator, scene → compile); the lasting fallen list; the Story clock from 08:00; a new "Scenes and history" section; "crawls from before this version".
- **`lorebook-cast.md`:** a deceased member reads as background.
- **`pipelines.md`:** scenes first, Note it in the scene, the pipeline history write and its refusals, `write_entry`, the cast state, `W_WRITES_HISTORY` and C40.
- The generated docs were rebuilt (158 pages).

## NOMENCLATURE
- **New rows:**
  - §4: scenes first; note-scene; the pipeline history write; `W_WRITES_HISTORY`/C40/`declaredNodeParams`; cast state.
  - §8: one entry per date / the day's entry / owning line; the chores; scene note.
  - §9: `line_on_first_write` and friends; the fallen.
- **Amended:** background member; the story clock's `current-date` meaning; the §9 Dungeon Crawler row.
- **§23 retired:** the cairn as a history entry; the `crawl-time` time decl.
- **§25:** one ledger block (16 rows).
- No R1 collision.

## STYLE-GUIDE
No change.

## Tests
- `docs:build`: OK.
- Docs tests: 7 files, 86/86.

## Brief vs code
1. The fork refusal is "on or before the fork" (and any dated write on a dateless fork), not only the fork day. The docs follow the code.
2. The DC passes are described from D2's brief. Check them against REPORT-hist-D2.

## Open ★
None new. The docs quote provisional copy still open:
- hist-A ★1/★2;
- hist-B1 ★3;
- hist-G ★G-1/★G-2;
- hist-C ★C-1;
- hist-D1 ★D1-1;
- D2's "Cairn of ‹name›".

## Noticed, not done
- No client UI shows a scene note (a P1 concern).
- DC has no Chronicle widget, so it compiles via Lorebooks › Session notes.
- `genre-dungeon-crawler.md:18` uses the retired "Create lorebook from session".
- iterateNext's toast says the date moved forward even when it reused an entry.
- No release notes.
- The §9 DC row is partly stale (channels and envoys).
