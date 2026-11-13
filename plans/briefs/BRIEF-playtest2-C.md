# BRIEF playtest2-C — connections and models: app-created local ONNX rows, the finder inline (ruled set)

Lane id `playtest2-C` · wave 3 (starts only when `plans/REPORT-m2e-D-2026-11-04.md` is filled in AND says ★47's seed landed in `db/defaults.ts`) · report `plans/REPORT-playtest2-C-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2.

## Goal
Plan `plans/PLAN-story-playtest-fixes-2026-11-03.md`: § Rulings (tail: §0-H, items 16, 17, 20), § Build plan 2 (your row + reconciliation point 3), §0-H (77–90), item 16 (594–640), item 17 (641–697), item 20 (698–745), `plans/REPORT-playtest-C-2026-11-04.md` (this morning: Get a model as a pane). Build:
1. **Item 17 app-created rows.** Two connection rows, **Local embeddings** (`local-onnx`) and **Local named entities** (`local-onnx-ner`), seeded by the `seedKey` boot pass in `src/lib/server/db/defaults.ts` (read the file's header rules: matched on `seedKey`, never on `id`; rebase on ★47's new literal), joined to `defaults.seedKey.int.test.ts` and a second-boot-changes-nothing test. **Undeletable** (the delete handler refuses with one sentence; the UI hides Delete on them; remove a model's files instead). **Fold** (★17b): existing hand-made rows of each type fold into the kept one — the one a loadout names, else the oldest — by generalising the KoboldCPP managed fold (`koboldCppManagedFold.ts`), with a test on a dir holding two. **Never fills a loadout** (★17c) and **never becomes the active one per modality by seeding** (one active per modality is a person's choice). Name fixed (★17e). The ONNX list fetch (`localOnnxModels.ts:1103-1105`) is gated on a model on disk or a loadout naming the row, not on the row existing. Amend the `defaults.ts` comment about connection defaults once (quote the live line in the report; the challenger could not find "connection defaults NEVER" by grep).
2. **Item 16.** Closes with 1 (the message seen was the finder's dead end, ruled). Also key `local_models` per modality (`schema.ts:4326` UNIQUE on filename → per modality; `db:generate`, stop and ask with the shape first); the finder's `destinationsFor("entities")` test is non-empty once the row exists.
3. **Item 20.** The **quant picker** and **Add by name** come out of their dialogs into the Models view's pane (steps 4–5 of item 20); **Set up chat stays a dialog** (ruled). STYLE-GUIDE §5.2 paragraph from this morning may need one sentence — list it for the lead.
Docs: `docs/connections.md` (the two rows, undeletable, fold), `docs/embeddings-and-rag.md:171`.

## Files owned (by name; re-read each immediately before editing)
`src/lib/server/db/defaults.ts` (after ★47; the two literals + the comment), `src/lib/server/connections/koboldCppManagedFold.ts` → the generalised fold (name it), the connection delete handler (one refusal), `src/lib/server/localModels/localOnnxModels.ts` (the fetch gate + the per-modality key), `src/lib/server/db/schema.ts` (`local_models` unique only), migrations via `db:generate`, `src/lib/client/connections/finder.ts`, `ModelFinderView.svelte`, `ModelsSidebar.svelte`, the quant picker + Add by name components, the connection row's Delete control, `docs/connections.md`, `docs/embeddings-and-rag.md`, tests beside each.
NOT yours: `core-catalog/src/loadouts.ts` and `loadouts/seed.ts` (M2e ★47 — read only), the first-run stepper (stays), `NOMENCLATURE.md` / `STYLE-GUIDE.md` (lead).

## Files readable
Everything. NOMENCLATURE §10 Connections, §1, §24; `docs/connections.md`; the 2026-11-04 §25 rows (Get a model row amended this morning); memory rulings: plugins are blind to connections; all connections start as API presets; one active per modality is a person's choice.

## Out of scope
Filling any loadout; making a seeded row active; a third row; renaming the types; moving Set up chat; a setting.

## Stop and ask when
Before `db:generate`; ★47 is not yet in `defaults.ts` (wait, do item 20 first); a name is new; CLAUDE.md §Decisions applies.

## Done means
Green: `defaults.seedKey.int.test.ts` (+ the two rows), the fold test, the delete-refusal test, `localOnnxModels*.test.ts`, `finder.test.ts`, `ModelFinderView`/`ModelsSidebar` DOM tests, the migration's second-boot test; new cases: fresh dir → two rows, no loadout filled, no active row set; second boot unchanged; two hand-made rows fold into the loadout-named one; delete refused; list fetch not called with no model on disk and no loadout naming the row; quant picker and Add by name render inline.
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest2-C-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-C-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
