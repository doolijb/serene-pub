# BRIEF — worker `kn-4a1-w2` — the knowledge store, the **Known by** tab and the **Not common knowledge** toggle (client)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `kn-4a1`. Report: your final message. The SDK and every
server file are not touched (a parallel worker builds the server door; you code against its wire types).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout` / `restore`; never `prettier --write` (nor a scratch-copy equivalent).
`NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .` and `npm run check`; name, never fix,
errors in files you do not own. Browser code runs on plain-http LAN and phones: no `crypto.randomUUID`, no
`navigator.clipboard`.

## The wire (already written; read, do not change)

`src/lib/shared/sockets/types.ts`, namespace `Sockets.EntryKnowledge` (search `namespace EntryKnowledge`): `Moment`,
`Hand` (`"knows" | "kept_from"`), `Winner`, `Row`, and the three events `List`, `SetCommonKnowledge`, `SetTie`.
The client event map entries (`"entryKnowledge:list"`, `…:setCommonKnowledge`, `…:setTie` and their `:error`) are in
`src/lib/client/sockets/typedSocket.ts`; all three replies are in `SCOPED_EVENTS` keyed by `lorebookId`
(`src/lib/shared/sockets/interest.ts`), so a reply is heard on `interestKey(event, lorebookId)`. Every reply and
refusal echoes `requestId`. The read and every write are the lorebook row's owner's only; anyone else is refused.

What the server answers per (member, entry) `Row`: `known` (the judgement's result at the reading), `winner` (the
tie that wins, or null when none reads: then the result comes from the mark alone), `hand` (what the hand switch
shows: the member's live hand tie, `kept_from` when both are live), `placeEntry`, `name`. `winner.hand` is true for a
hand tie (undated, every line); `winner.kind` null is an ordinary relationship (`relationshipType` is its word, e.g.
`keeps`), `was_told` / `has_been_there` are play's kinds, a `knows` / `kept_from` winner with `hand: false` is dated.
`setTie` with `hand: null` ends the member's hand ties for the entry; play's rows and ordinary relationships are
never touched. `setCommonKnowledge` marks or clears many entries in one request and answers with the book's whole
`markedEntryIds`.

## Files owned (edit only these)

- New: `src/lib/client/lorebooks/knowledge/bookKnowledge.svelte.ts` (the store + its socket api),
  `src/lib/client/lorebooks/knowledge/KnownByList.svelte`, `src/lib/client/lorebooks/knowledge/knownByWords.ts` (pure
  words for a row), and their tests under `src/lib/client/lorebooks/knowledge/`.
- `src/lib/client/lorebooks/EntryWorkspace.svelte` (create + provide the store; the toggle).
- `src/lib/client/lorebooks/sections/EntryInspector.svelte`, `src/lib/client/lorebooks/sections/index.ts` (declare the
  tab on doors), `src/lib/client/lorebooks/editor/inspectorTabs.ts` (+ its test if one exists, `grep -rl inspectorTabsFor src`).

Not yours: `LorebooksWorkspace.svelte`, `EntryPool.svelte`, `BulkEditBar.svelte`, `bulkEdit.ts`, `EntryMarks.svelte`
(the next worker uses your store there), `Layout.svelte`, any server file, `CastWorkspace.svelte`.

## Rules your work depends on (quoted)

- CLAUDE.md Sockets: "one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." Here the store is that one listener for `entryKnowledge:*`. **Nothing in this lane calls `toaster` / `notify`.** A refusal is said in place (a `role="alert"` line where the person acted). Layout's catch-all may also toast it until the lead lists the events (queued by the supervisor, not your job).
- CLAUDE.md: "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." Use `declareInterest` and keep its release, as `src/lib/client/lorebooks/relationships.svelte.ts` does.
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- Memory "Untrack reads in effect-called store methods": a store method called from an `$effect` wraps its body in `untrack(...)` (see `BookRelationships.open`), or the effect re-runs on the state it writes.
- STYLE-GUIDE §2.4 / EntryWorkspace's `markToggle`: an entry mark is a toggle, `preset-pressed` with `aria-pressed` while on, the check saying it without colour.
- STYLE-GUIDE 1287–1291: "A segmented control is a row of its options … a `role="group"` of options, the chosen one `preset-pressed` with `aria-pressed`, and one consequence line under it in a polite live region."
- STYLE-GUIDE §9: "Every interactive element is a real `button` … with an accessible name"; "Targets are 44px on touch. A 32px control gets a 44px hit area on coarse pointers" (`pointer-coarse:min-h-11`); "Nothing is hover-only."
- STYLE-GUIDE §10: sentence case; "Help is one sentence."; "Labels are nouns, hints are sentences"; "errors say what went wrong and what to do"; "No filler".
- Lane brief: the toggle is "Owner only; others do not see it. Written at once like Archive (not part of the form's dirty state), through the new door." The mark is not in edit history and never goes through `entries:update` / `entries:setMarks`.
- Lane brief: Known by is "an inspector tab (`SectionDescriptor.inspector`, `EntryInspector.svelte`), on every door whose entries the filter judges". The filter judges every `lorebook_entries` row whatever its type, so: every door with `store: "entries"` (world, characters, history, items, places, all, and `rulesListDoor`), never scenes (`store: "scenes"`), and never a scene row met in the Everything list (`item.kind === SCENE_KIND`).
- Lane brief: "Tab count: the number of members who know the entry by any tie" → count rows with `known && winner !== null && winner.kind !== "kept_from"`.
- Lane brief correction 4: "An administrator who is not the owner gets nothing" → the tab and the toggle are not drawn unless the reader is the owner (`getBookData().readOnly === false`, i.e. `bookAccess === "owner"`).

## Build

### 1. The store — `knowledge/bookKnowledge.svelte.ts`

Follow `relationships.svelte.ts` (class store, provided by context) and `places/placeStatsApi.ts` (an api object
over `awaitReply` with a per-call `requestId`, `match` on it, `matchError: refusalFor(requestId)`, rejecting with the
server's sentence; fallback sentences: list `"Who knows this entry could not be read."`, setCommonKnowledge
`"The entries could not be marked."`, setTie `"Who knows this entry could not be saved."`). Request ids without
`crypto.randomUUID` (copy `placeStatsApi`'s counter, prefix `entry-knowledge-`).

The API is fixed (the next worker codes against it):

```ts
export type KnowledgeRow = Sockets.EntryKnowledge.Row
export interface KnowledgeReading { branchId: number | null; moment: Sockets.EntryKnowledge.Moment | null }
export interface KnowledgeApi {
	list(p: Omit<Sockets.EntryKnowledge.List.Params, "requestId">): Promise<Sockets.EntryKnowledge.List.Response>
	setCommonKnowledge(p: Omit<Sockets.EntryKnowledge.SetCommonKnowledge.Params, "requestId">): Promise<Sockets.EntryKnowledge.SetCommonKnowledge.Response>
	setTie(p: Omit<Sockets.EntryKnowledge.SetTie.Params, "requestId">): Promise<Sockets.EntryKnowledge.SetTie.Response>
}
export function socketKnowledgeApi(socket: Pick<TypedSocket, "emit">): KnowledgeApi
export class BookKnowledge {
	constructor(api: KnowledgeApi)
	readonly lorebookId: number | null
	/** The book's marks have been read. */
	readonly loaded: boolean
	isMarked(entryId: number): boolean            // reactive (SvelteSet)
	/** Turn to one book: read its marks, hear the two write replies (other tabs' writes). Returns the release. Untracked. */
	open(lorebookId: number): () => void
	readonly entryId: number | null
	readonly rows: KnowledgeRow[]
	readonly rowsLoaded: boolean
	readonly rowsError: string | null
	/** Read the rows of one entry at a reading (null clears). Untracked; a later call wins over an earlier answer. */
	showEntry(entryId: number | null, reading: KnowledgeReading): void
	/** One request for many entries; marks follow the reply; re-reads the open entry's rows when it is among them. Rejects with the server's sentence. */
	setMark(entryIds: number[], notCommonKnowledge: boolean): Promise<Sockets.EntryKnowledge.SetCommonKnowledge.Response>
	/** Sets the hand switch; the open entry's row follows the reply. Rejects with the server's sentence. */
	setTie(castMemberId: number, entryId: number, hand: Sockets.EntryKnowledge.Hand | null): Promise<Sockets.EntryKnowledge.SetTie.Response>
}
export function setBookKnowledge(k: BookKnowledge): void
export function getBookKnowledge(): BookKnowledge | undefined   // undefined when not provided (tests, other mounts)
```

- `open` declares interest on `interestKey("entryKnowledge:setCommonKnowledge", id)` (marks := reply's
  `markedEntryIds`; re-read the open entry's rows if it is among `entryIds`) and on
  `interestKey("entryKnowledge:setTie", id)` (when the reply's entry is the open entry: replace that member's row
  when the reply's `branchId`/`moment` equal the store's reading, else re-read). Both handlers ignore another
  book's replies. The release takes off exactly those handlers.
- A stale answer (an earlier `showEntry` or another book) never overwrites a newer one.
- The store never toasts and holds no UI copy except the fallback sentences above.

### 2. Provide it — `EntryWorkspace.svelte`

Create one `BookKnowledge(socketKnowledgeApi(useTypedSocket()))` and `setBookKnowledge` it at init (so the pool and
the inspector below find it by context). `$effect`: when the reader is the owner (`!readOnly`), `open(lorebookId)`
and return its release. `$effect`: `showEntry(selectedSource?.id ?? null, reading)` for an owner on an entries door
with a stored row (not a new draft, not a library row), where `reading = { branchId: route.branch ?? null, moment }`
and `moment` comes from `momentDate(route.moment)` (`./time/moment`) as `{ year, month: ?? null, day: ?? null }`
(see how `sections/PlaceEditor.svelte` builds its `reading`).

### 3. The toggle — `EntryWorkspace.svelte`

🚧 **Not common knowledge**, wherever **Pinned** and **Off** are drawn (the `⋯` menu's `markToggle`s when not
railed, ~2556; the entry zone's when railed, ~2777 — there, after Off, not tied to `zoneOf`: the mark has one value
per entry, never dated). Same `markToggle` look: `aria-pressed`, `preset-pressed` while on, the check; an icon from
`@lucide/svelte` that is not already a mark's (e.g. `EyeOff`); `data-lore-mark="not-common"`. Its help is one
sentence, drawn under the button as a 12px muted line (`text-meta text-surface-600-400`) that the button names in
`aria-describedby` (extend `markToggle` with an optional describedby, or a sibling snippet):
*Only the cast members you name under Known by read this entry when they speak.*
Shown only when `!readOnly && !libraryOpen && !isNew && selectedSource && activeDoor.store === "entries"` and the
row is one this workspace lets the owner change (honour whatever already makes Pinned/Off read-only for the row,
e.g. a *could exist here* row of another line). Pressed: `knowledge.setMark([id], !on)`; disabled while the request
is out; it is never part of the draft, `hasUnsavedChanges` or Save. On refusal, one `role="alert"` line under it
with the server's sentence, cleared on the next press or another entry. `on` is `knowledge.isMarked(id)`.

### 4. The tab — `sections/index.ts`, `editor/inspectorTabs.ts`, `sections/EntryInspector.svelte`

- 🚧 `const KNOWN_BY_TAB: InspectorTab = { id: "known-by", label: "Known by" }` added last to `inspector` of every
  `store: "entries"` door listed above (the route value `known-by` is new: list it in your report).
- `inspectorTabsFor`: optional `knownBy?: number` in `InspectorCounts`; the `known-by` tab's label is
  `Known by ‹n›` when the count is given, `Known by` while not loaded. References/Contains unchanged.
- `EntryInspector`: `getBookKnowledge()`; drop the `known-by` tab when there is no store, when `!mayEdit`, when
  `item.kind === SCENE_KIND`, or when the store's `entryId !== source.id`. Body: `<KnownByList>` fed from the store
  (rows, loaded, error, `marked = knowledge.isMarked(source.id)`), `onSet = (memberId, hand) => knowledge.setTie(memberId, source.id, hand)`.

### 5. `knowledge/KnownByList.svelte` + `knowledge/knownByWords.ts`

Presentational: props `{ marked: boolean; rows: KnowledgeRow[]; loaded: boolean; error: string | null;
formatDate: (m: Sockets.EntryKnowledge.Moment) => string; onSet: (castMemberId: number, hand: Hand | null) => Promise<unknown> }`
(EntryInspector passes `formatDate` from `./historyDates`). It keeps its own per-row pending state and per-row refusal.

Top of the tab (each a 12–13px muted line; the exact words, all 🚧 for the owner's wording):
- marked: *Only the cast members who know this entry read it when they speak.*
- not marked: *This entry is common knowledge: every cast member reads it unless it is kept from them.*
- always: *These are this lorebook's ties; a session's notes can hold newer ones, which win in that session.*
- not loaded: *Reading who knows this entry…*; error: the sentence in a `role="alert"` line; loaded with no rows:
  *This lorebook has no cast members yet.*

One list (`<ul>`), one `<li>` per row: the member's name (14px medium), then the three-way switch
**Default · Knows · Kept from** — a `role="group"` labelled by the name (`aria-labelledby`), three real `<button>`s,
the chosen one `preset-pressed` + `aria-pressed="true"`, the others `preset-tonal-surface`, `btn btn-sm
pointer-coarse:min-h-11`; chosen = `row.hand ?? "default"`; pressing another sends `onSet(id, "knows" | "kept_from" | null)`;
disabled while that row's request is out. Under it, one 12px muted result line in a polite live region
(`aria-live="polite"`), from a pure `knownByWords(row, marked, formatDate)` returning `{ result: string; note: string | null }`:

result (the winner decides; null winner: the mark decides):
- `winner === null`, `known` → *Knows it: common knowledge*
- `winner === null`, not known → *Does not know it*
- `kind: "knows"`, `hand` → *Knows it*
- `kind: "kept_from"`, `hand` → *Kept from it*
- `kind: "knows"`, not hand → *Knows it, as of ‹date›* (undated: *Knows it*)
- `kind: "kept_from"`, not hand → *Kept from it, as of ‹date›* (undated: *Kept from it*)
- `kind: "was_told"` → *Knows it: was told*; `"has_been_there"` → *Knows it: has been there*
- `kind: null` → *Knows it: tied as “‹relationshipType›”*
- and when `placeEntry` and the result is kept from: append *, except while standing there*

note (one more 12px line, or none):
- `row.hand` set and the winner is not a hand tie of that kind → *‹Knows | Kept from›, but ‹what wins› is newer and wins.*
  with ‹what wins› = “was told” · “has been there” · “‹relationshipType›” (ordinary) · a tie dated ‹date› (a dated
  knows / kept from).
- `row.hand === "knows"`, winner is that hand tie, and the entry is not marked → *Changes nothing until the entry is marked not common knowledge.*
- otherwise null.

A refusal for a row: one `role="alert"` line under that row with the server's sentence, cleared on its next press.
Works at 399px wide (the switch wraps under the name; no horizontal scroll).

## Tests (Done means)

Under `src/lib/client/lorebooks/knowledge/`, copying the DOM test setup of `src/lib/client/lorebooks/bulkEditBar.dom.test.svelte.ts`
(mount/unmount, `vi.mock("$app/environment", …)`, mocking `$lib/client/sockets/typedSocket` and
`$lib/client/utils/awaitReply` where a socket is needed):
- `knownByWords.test.ts`: every result and note above, both Default wordings, the place suffix.
- `knownByList.dom.test.svelte.ts`: three states (the pressed button follows `hand`), Default wording both ways
  (marked and not), a play row (`was_told`) shows its reason and still offers the switch, the override note,
  pressing Kept from calls `onSet(id, "kept_from")` and Default calls `onSet(id, null)`, a refusal shows in an alert,
  and **axe** (`import axe from "axe-core"`; `axe.run(target, { rules: { "color-contrast": { enabled: false } } })`,
  violations `[]`, as `src/lib/client/components/connections/finder.dom.test.svelte.ts` ~400 does).
- `bookKnowledge.dom.test.svelte.ts` (or `.test.ts` if no DOM is needed): `open` reads the marks; `isMarked`;
  `setMark` sends ONE request for several ids and the marks follow the reply; a stale `showEntry` answer is dropped;
  `setTie` replaces the row; a refusal rejects with the server's sentence.
- The toggle (an existing EntryWorkspace DOM test harness: `EntryWorkspaceFixture.svelte` and
  `entryWorkspace.versions.dom.test.svelte.ts` show how to mount it): shown for the owner, absent for a reader
  (`bookAccess: "shared"` and `"admin"`), pressing it sends one `entryKnowledge:setCommonKnowledge` with
  `{ entryIds: [id], notCommonKnowledge: true }`, it does not make the form dirty. If the harness cannot reach it in
  reasonable effort, test the toggle as its own small component instead and say so.
- The tab: `inspectorTabsFor` counts; the tab is absent for a non-owner and for a scene.

Also run the existing tests of every file you touched (`grep -rl` for their names under `src/lib/client/lorebooks`).

**How to run tests (only this way, one run at a time):** first
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4a1-w2-<n>.log 2>&1"`
and read the log (never pipe vitest into `head`). Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
and `NODE_OPTIONS=--max-old-space-size=10240 npm run check` (0 errors in your files; the server door is being written
in parallel, so a missing server symbol is not yours), and `npx prettier --check` on each touched file.

## Stop and report (do not decide) when

A sentence a person reads is needed beyond the ones above; a new setting, event, or file outside the list seems
needed; the store cannot be provided from EntryWorkspace to EntryInspector/the pool by context.

## Report

Changed files; the store API as built (any deviation from the fixed API above, and why); every sentence a person can
read, listed; tests with pass counts and log paths; tsc/check results; noticed and not done.
