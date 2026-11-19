# BRIEF — build lane `kn-4a2` — **Knows** on a cast member, and three fixes to the entry's screens (programme 1.4)

Repo `/home/jody/github/serene-pub` (app; no SDK change). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/REPORT-kn-4a1-2026-11-16.md` (the door you build on, the sentences already on screen, and the scope
review at the end), `plans/briefs/BRIEF-kn-4a.md` (section C and the "Cold review corrections": the rules of
judging, owner-only, `toEntryRow` untouched, all apply here), `plans/INVENTORY-knowledge-screens-2026-11-16.md`
§3–§4, §7, `STYLE-GUIDE.md` (tabs ~1268, drop states ~1388, a11y ~2422, read-only is words ~2166, copy rules),
`NOMENCLATURE.md` rows **hand tie**, **Known by**, **entry knowledge door**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write` (nor a scratch-copy
equivalent). Never commit. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4a2-<n>.log 2>&1"`,
one run at a time; wait for other lanes with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No migration. No full run, no build.

## Owner

"The pool on the character and *Known by* on the entry are the two ends of the same ties." Earlier, of the
character's side: "a 'pool' view where entries can be dragged in and out". Programme 1.4: "**Knows** on the cast
member (buttons + drag)". Owner only. "Pickers explain why."

## Step 1 — three fixes from the scope review (do these first; each with a test)

1. The **Not common knowledge** toggle and the **Known by** tab show only when the owner-only read succeeded
   (`knowledge.loaded`), not on `readOnly` / `mayEdit` (a session's notes book calls every member an owner):
   `EntryWorkspace.svelte` (`knowledgeToggleShown`, the `knowledge.open` effect), `sections/EntryInspector.svelte`
   (`knownByShown`). A non-owner sees neither, and no refusal sentence.
2. `knowledge/knownByWords.ts` `noteOf`: the *…but ‹reason› is newer and wins.* note shows only when the winner's
   **effect differs** from the switch (the switch says Knows and the member is kept from it, or the reverse);
   when the result is the same, no note. The word "newer" is used only when a later date decided; a nearer line
   says so (★ wording, e.g. *…but ‹reason› on this line wins.*). `winningTies` / the door return the
   timeline-aware date (null when the book's timeline is off), so no row says *as of ‹date›* where dates play
   no part.
3. `docs/lorebooks.md` Bulk edit: the mark is one request for the whole selection, all or none, and is not in
   the edit history.

## Step 2 — the **Knows** tab on a cast member

- A tab in `lorebooks/CastWorkspace.svelte` after Lore (`memberTabs`, a `role="tabpanel"`), shown only to the
  lorebook's owner (the same `knowledge.loaded` gate; the store is the existing `BookKnowledge`, provided where
  the cast workspace can reach it: the entry workspace and the cast workspace are never mounted together
  (`lenses/PoolMount.svelte` 77–117), so provide the store at the level both share or once per workspace; one
  listener either way). Tab count: entries this member knows through a tie.
- The tab reads `entryKnowledge:list` by `castMemberId` (the door already answers it) and shows **two zones**:
  - **Knows** (🚧 zone titles are yours, ★): every entry this member is tied to or is kept from, each row with
    the entry's name, type, the same three-way switch **Default · Knows · Kept from** and the same result words
    as Known by (reuse `knownByWords.ts`; one wording for both ends);
  - **The lorebook's entries** not yet in the first zone: marked entries first (they are the ones a tie
    changes), then the rest behind a filter box; each row has a button **Knows** (and, in its menu or beside it,
    **Kept from**).
  - **Drag** a row from the second zone into the first to set **Knows**; drag out of the first to return to
    Default (native `rowDrag`, the existing drop-state styles; the hint shows only while dragging). Every drag
    has the button path above; works at phone width; 44px targets; keyboard reachable.
  - A row for an entry that is common knowledge says *Changes nothing until the entry is marked not common
    knowledge.* (the existing sentence); nothing is marked silently.
  - Long lists: the second zone pages or virtualises as the entry pool does (find and reuse; do not load every
    entry's text: names and types only; if the door returns only marked and tied entries, the "rest" comes from
    the book's existing entry list store, not a new read).
- Writes go through `entryKnowledge:setTie`; after a write both zones reflect the judged result from the door's
  reply. The entry's Known by tab, if opened later, shows the same tie (one store, one truth).

## Docs and names

`docs/lorebooks.md` (What a character knows: the member's side) and the cast page if it lists the member's tabs
(`docs/lorebook-cast.md`); `NOMENCLATURE.md`: a row for **Knows** (the tab), §25.

## Files owned

`client/lorebooks/CastWorkspace.svelte`, `client/lorebooks/knowledge/*` (new components for the tab; fixes to
`knownByWords.ts`, the store), `EntryWorkspace.svelte` and `sections/EntryInspector.svelte` (fix 1 only),
`server/lorebooks/entryKnowledge.ts` (fix 2's date only), `server/sockets/entryKnowledge.ts` (only if the
by-member read needs a field), tests, the two docs pages, `NOMENCLATURE.md`. Lane `ss-5` is running on
`sessions/settingsForm.ts`, `pipelines/registrations/values.ts`, `config/*` and the session settings row
components: not your files.

## Out of scope

Changing the judging or the precedence (D39); the test-view cause line (D40); play writing ties (the SDK outlet
exists, placed by nothing); cast Memory; a graph view; any setting.

## Stop and ask when

CLAUDE.md §Decisions applies; the store cannot be shared without a second listener; the second zone needs a
new server read of every entry.

## Done means

Tests (capped): the three fixes (a non-owner notes member sees no toggle and no tab; each note case; timeline
off shows no date; docs are not tested); the tab (owner only; both zones; the switch; drop sets Knows, drag out
returns to Default; each button path; a common-knowledge row's sentence; count); axe clean on the tab; the
existing kn-4a1 tests still green. `tsc` 0; `npm run check` 0 errors in lane files.

## Report

Final message = the report (lead saves `plans/REPORT-kn-4a2-<date>.md`): the fixes; what the tab shows in each
state with every sentence marked ★; where the store is provided; changed files; tests; **Noticed, not done**.
Under about 600 words.
