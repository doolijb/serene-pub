# BRIEF — build lane `kn-4a` — the knowledge screens: **Known by** on an entry, **Knows** on a cast member (programme 1.4, first half)

Repo `/home/jody/github/serene-pub` (app). The SDK is not touched (the SDK write API and recipes are lane
`kn-4b`). Supervisor: read `.claude/guides/multi-agent.md`, then `plans/INVENTORY-knowledge-screens-2026-11-16.md`
(the facts; **re-verify every file:line**), `plans/PLAN-entry-time-and-lines-2026-11-14.md` lines 60–70, 120–128,
220–230, 310–316, 355–362 (the owner's rulings), `plans/REPORT-kn-2a-2026-11-16.md` (how the filter judges),
`docs/lorebooks.md` ~110–122, `STYLE-GUIDE.md` (bulk bar ~1057, tabs ~1268, drop states ~1388, forms ~1205,
a11y ~2422, copy rules), `NOMENCLATURE.md` §1, §24 and rows ~959–965, the Skeleton section for any Skeleton
component used (`grep -n "^# <Name>" AI-TEMP/skeleton-llms-svelte.txt`, that section only).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write` (nor a scratch-copy
equivalent). Never commit. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4a-<n>.log 2>&1"`,
one run at a time; wait for other lanes with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No migration is expected (the columns
exist, 0167); if one seems needed, stop. Inside `db.transaction` only `tx`. No full run, no `npm run build`.

## Owner (verify each quote in the plan file)

- "The pool on the character and *Known by* on the entry are the two ends of the same ties."
- "A filter always shows its cause: *not known by ‹name›* … in the entry's test view and the character's pool.
  Bulk-marking entries not common knowledge warns with the count."
- Only the lorebook's owner marks entries and sets who knows what.
- Ruled ★15: "knowledge as one list with a three-way switch".
- "Yes everyone by default" (an entry is common knowledge until marked).
- "(hand: **Knows** and **Kept from**; play's rows show their own reason): 'That works, …'"
- Programme 1.4: "Knowledge screens: **Known by** on the entry, **Knows** on the cast member (buttons + drag),
  bulk mark".

## Build

### A. Server door (the module that owns the data owns every write: `server/lorebooks/entryKnowledge.ts`)

- The entry's wire shape carries the mark (`toEntryRow`: `notCommonKnowledge`), so lists and the form can show it.
- One socket family for knowledge, in its own file beside the lorebook sockets (🚧 names; follow the naming of
  sibling families and record them in NOMENCLATURE §25):
  - a read: every knowledge tie of a book (member, entry, kind, status, and for play's kinds the reason play
    recorded, if any is stored: check) — only what the asker may see (the owner; an admin exactly as other
    lorebook reads treat an admin: find the rule and follow it; a non-owner gets nothing);
  - set the mark on one or many entries in one request (bulk is one transaction, one event);
  - set a hand tie for (member, entry) to **Knows**, **Kept from** or none (none ends the hand tie; play's rows
    are never ended or overwritten by hand: a hand tie and a play tie for the same pair can coexist only if
    `judgeEntryKnowledge` already defines the result; read it and state the precedence in the report).
- Every write calls the existing functions (`setEntryCommonKnowledge`, `writeKnowledgeTie`, `endKnowledgeTie`);
  no second writer, no SQL in the socket. Refusals use the existing sentences.
- Events are scoped to the book (`SCOPED_EVENTS` with `lorebookId` in every payload) and gated like their
  siblings; one client context listens (extend the lorebook's existing domain context or the `BookRelationships`
  pattern; do not add listeners in views); only that context toasts.
- The mark is not in edit history (NOMENCLATURE:961): keep it so.

### B. On an entry

- **The mark**: a toggle in the entry zone beside Pinned / Off, same `markToggle` pattern: 🚧 **Not common
  knowledge** with help in one sentence (*Only the cast members you name under Known by read this entry when
  they speak.*). Owner only; others do not see it. Written at once like Archive (not part of the form's dirty
  state), through the new door.
- **Known by**: an inspector tab (`SectionDescriptor.inspector`, `EntryInspector.svelte`), on every door whose
  entries the filter judges (find which entry types `judgeEntryKnowledge` covers; a type it never judges gets no
  tab). One list of the book's cast members, each row a three-way switch **Default · Knows · Kept from**
  (ruled ★15). What **Default** means is said on the row from the entry's state: *Knows it: common knowledge* or
  *Does not know it*. A row play wrote shows its reason read-only (*Was told*, *Has been there*) and still
  offers the hand switch only if the precedence in A allows it. While the entry is common knowledge the tab says
  so in one line and still lists **Kept from** (if `judgeEntryKnowledge` honours *kept from* on a common entry;
  otherwise the tab says the switch has no effect until the entry is marked: report which).
  Tab count: the number of members with a hand or play tie.
- **The cause** (ruled): where the entry's existing test view shows whether it fires (the `fires` tab), a line
  *Not known by ‹name›* for each member the filter would drop it for, when it is marked. If that view has no
  per-speaker notion today, add nothing there and report.

### C. On a cast member

- **Knows**: a tab in `CastWorkspace.svelte` after Lore: the same ties from the member's end. One list: every
  entry of the book that is marked not common knowledge, plus any entry this member has a tie to, each row the
  same three-way switch and the same Default wording; a filter box when the list is long (reuse the pool's).
- **Drag**: an entry row dragged from the entry pool onto the tab or its tab button sets **Knows** (native
  `rowDrag`, the existing drop-state styles). **Buttons**: every drag has a button path (the switch itself; an
  **Add an entry** picker that explains why an entry is or is not offered, per "pickers explain why"). Works at
  phone width; 44px targets.
- Dropping an entry that is common knowledge: it becomes a **Knows** tie that changes nothing until the entry is
  marked; say so on the row (do not mark the entry silently: P1, nothing hidden).

### D. Bulk

`BulkEditBar` / `bulkEdit.ts`: two actions, **Mark not common knowledge** and **Mark common knowledge**, owner
only, one request for the whole selection; before marking, the confirm step warns with the count (ruled: "warns
with the count"; use the bar's existing confirm pattern, as bulk delete does); what it did is said under the bar
(`role="status"`), never in a toast.

### E. Docs and names

`docs/lorebooks.md` (replace "There is no screen yet…" with what the screens do; the cast page if it lists the
member's tabs); `NOMENCLATURE.md` (rows for the tab names and the socket family; update :405 and :961–962 where
they say "the next lane"; §25). Comments state the rule, not the story.

## Files owned

`server/lorebooks/entryKnowledge.ts` (read helpers for the door only; the judging stays as is), the new socket
file and its registration, `shared/sockets/*` type and interest lists, `server/utils/lorebookEntries.ts`
(`toEntryRow`), client: `lorebooks/EntryWorkspace.svelte`, `lorebooks/sections/*` (descriptor tab lists,
`EntryInspector.svelte`), `lorebooks/editor/inspectorTabs.ts`, new components under `lorebooks/` for the two
lists, `lorebooks/CastWorkspace.svelte`, `lorebooks/BulkEditBar.svelte`, `bulkEdit.ts`, the lorebook domain
context that listens; tests; `docs/lorebooks.md`, `NOMENCLATURE.md`. Not `sockets/narrativeGraph*.ts` (ties stay
out of the graph), not `pipelines/*`, not the SDK.

## Out of scope

The SDK write API and recipes (`kn-4b`); play writing `was_told` / `has_been_there` (programme 1.6); cast
Memory (1.5); presence (`kn-2b`); a graph view of knowledge; changing how the filter judges; model-judged
knowledge; any setting.

## Stop and ask when

CLAUDE.md §Decisions applies; hand and play ties for one pair have no defined precedence; a non-owner would see
a mark or a tie; the entry wire shape change breaks an importer or a plugin read; a migration seems needed.

## Done means

Tests (capped): the door (owner only; bulk in one transaction; scoped event carries `lorebookId`; a non-owner
reads nothing; play's rows untouched by hand writes); `toEntryRow` carries the mark; DOM tests for **Known by**
(three states, Default wording both ways, play's row read-only, count), **Knows** (list, switch, drop sets
Knows, button path), the mark toggle, bulk (count warning, one request, status under the bar); an integration
test that a tie set through the door changes what `knownToSpeaker` returns for that member; axe clean on the
new components (the repo's axe technique, if a helper exists). `tsc` 0; `npm run check` 0 errors in lane files.

## Report

Final message = the report (lead saves `plans/REPORT-kn-4a-<date>.md`): the door's events and names; the
precedence of hand vs play ties; what each screen shows in each state (the exact sentences, each marked ★ for
the owner's wording); what was not built and why; changed files; tests; **Noticed, not done**. Under about 800 words.

## Cold review corrections (2026-11-16) — these rule over the text above. This lane is now `kn-4a1`

**Scope cut:** this lane builds **the door (A), the mark toggle and Known by (B), bulk mark (D), docs (E)**.
Section C (the **Knows** tab on a cast member) is lane `kn-4a2`, not launched: the entry pool and the cast
workspace are never mounted together (`lenses/PoolMount.svelte` 77–117), so the member's tab needs its own
two-zone pool (the owner's picture: "a 'pool' view where entries can be dragged in and out"). Build the door so
that lane can use it unchanged (a read by member as well as by entry).

**How the filter really judges (read `entryKnowledge.ts` 21–23, 97–170, 289; the screens must say exactly this):**
- An **ordinary link** from a cast member to an entry counts as knowing it (owner ★2, 2026-11-14: "A tie to an
  entry counts as knowing it", NOMENCLATURE:965): the query picks up every active cast→entry row of any kind.
- **One tie wins per (member, entry):** the later date, then the nearer line (a session's notes are nearest),
  then *kept from*. **Hand ties are written undated** (`historyEntryId ?? null`, :489), so a dated play tie or
  dated ordinary link beats a hand **Kept from**; hand Knows vs hand Kept from, both undated: Kept from wins.
- **Kept from works on a common-knowledge entry too** (136–138): the tab offers it there and says what it does.
- `writeKnowledgeTie` inserts without looking for an existing tie (:480): two live hand ties for a pair are possible.
- The place a member stands in counts as known even against Kept from (37–43, 316–327; D27 is open).

So:
1. **The read returns the judged result**, not a guess from the hand tie: for each (member, entry) asked,
   what `judgeEntryKnowledge` decides at the workspace's line and moment, the winning reason (hand Knows, hand
   Kept from, *Was told*, *Has been there*, an ordinary link with its name, common knowledge, nothing), and the
   hand tie if one exists. The row shows the result and its reason in words; where the hand switch is set but
   something else wins, the row says so (★ wording: *Kept from, but ‹reason› is newer and wins.*). On a place
   entry a Kept from row adds *…except while standing there* (★; D27 open). The tab count is the number of
   members who know the entry by any tie.
2. **Changing the switch** ends that member's hand ties for the entry, then writes the new one, in one outer
   transaction passing `tx` to the existing functions (extend their signatures to take `tx` if they do not; no
   second writer). Hand ties stay undated and on every line (`null`), as today; the precedence itself is not
   changed in this lane (DISCUSS-LATER D39).
3. **`toEntryRow` is not touched** (it feeds export, pipeline and plugin rows and reads by share recipients:
   the mark would leak and the file format would widen, D37). The owner-only knowledge read returns the ids of
   marked entries; the client merges the mark into what the owner sees (the toggle, the list badge, bulk).
4. **Who may:** the read and every write are gated on `book.userId === userId` (the row's owner), exactly as
   the writers already are (`entryKnowledge.ts:451`): not `findOwnedBook` / `lorebookAccessFor`, which admit
   every member of a session to its notes book. An administrator who is not the owner gets nothing (★ in the
   report). The tab says in one line that it shows this lorebook's ties and that a session's notes can hold
   newer ones that win there (★ wording).
5. **The cause in the entry's test view** (`EntryFireTest` takes no speaker, `EntryInspector.svelte` 177–182):
   not built; it is recorded as DISCUSS-LATER D40. The Known by tab itself is where the cause shows in this lane.

Done-means tests change accordingly: the judged result and reason per case (ordinary link; dated play tie over
hand Kept from; hand Kept from over hand Knows; common entry with Kept from; a place entry); the switch leaves
exactly one live hand tie; `toEntryRow` unchanged and the export fixture test still green; a session member who
is not the notes book's owner reads nothing.
