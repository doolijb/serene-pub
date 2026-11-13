# BRIEF pl2-w1 — a place's world value in the notes' overlay (code + tests)

Lane **pl2** (supervisor: lane-supervisor, Opus). You are a `lane-worker` (Sonnet). Work from `/home/jody/github/serene-pub`. Report back in your final message (the supervisor reads it; do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal (owner ruling ★pl-1, 2026-11-05: "In the notes' overlay, like the rules' place fields.")
In a session that **can't write its book** (`keepsValuesInOwnBook(db, sessionId)` in `lorebooks/ownBook.ts`: it reads no book, or one its owner does not own), a **world-scope** attribute value (`getAttributeSlot(slotId)?.scope === "world"`) on a **place of the attached book** (owner `session_location` X mapped to the book's place, or an explicit `location` X whose entry is in the attached book) is kept in **the notes' rule-fed overlay**, keyed by the book's place (entry) id — never a copied entry, never an `attribute_values` row on the attached book. Reads take the overlay's value first, then the book's. The attached book gains nothing.

Context you must not undo: `rulesets/ties.ts` ~430–530 (the rule-fed overlay `RuleFedOverlay`, `overlayInNotes`, `overlayPath`, `ruleFedOverlayOf`: kept on the notes' own row `lorebooks.extra_json.ruleFed`, every change imprinted under its message so Back takes it — `lorebooks/imprints.ts` `overlay` subject, generic by path `<kind>.<id>.<field>`); `state/worldScope.ts` (`worldOwnerOf`, m3b-V2/pl); `state/write.ts` (`setValue` ~2045, `applyAutomatic` ~2251, `assertSessionOwner` place branch ~1574, `assertOwnBookWriter` ~1688, `isOwnBookOwner` ~422, `anchorFor` ~537); `state/resolve.ts` (`SessionLinks` ~240, `sessionLinks` ~550, `valueOf` ~818, `fromLayers` ~898, `chainFor` ~962, `locationsFor` ~1701).

## Design (decided by the supervisor — build exactly this; anything else → stop and report)

### 1. `src/lib/server/rulesets/ties.ts` — additive only, inside the overlay section
- `RuleFedOverlay` gains 🚧 `placeValues: Record<string, Record<string, unknown>>` — a world-scope attribute value of the attached book's place, by entry id → slot id → value (null = cleared, read the book's). Extend its doc comment by one bullet. `overlayOfJson` parses it (`{}` when absent); `ruleFedOverlayOf`'s emptiness test counts it too.
- `overlayPath.placeValue = (entryId, slotId) => \`placeValues.${entryId}.${slotId}\`` (slot ids may hold `.`; the imprint accessor rejoins the rest — check `atOverlayPath` does too).
- Export `layPlaceValue(db, notesId, entryId, slotId, value, anchor: ImprintAnchor | null)`: `overlayInNotes` with that one path imprinted under `anchor` (null anchor → no imprint, as today).
- Export a pure reader `placeValuesOf(extraJson: unknown): Record<string, Record<string, unknown>>` (the notes row's `extra_json` → `ruleFed.placeValues`, `{}` when none), via `overlayOfJson`.
- Change nothing else in ties.ts.

### 2. `src/lib/server/state/worldScope.ts` — the keeps branch (also fixes pl's residual)
Inside `if (await keepsValuesInOwnBook(db, sessionId)) { … }`, after the existing `session` and `session_cast` arms:
- `session_location` or `location` → `await assertOwnBookWriter(db, sessionId, userId)` (writer first), then return `{ kind: "location", id: owner.id }`.
- every other kind → `return owner` (an explicit book, member or card goes where it is named; `setValue`'s checks judge it). The keeps branch must **never** reach `attachedOrOwnBookOf` (it calls `ownBookFor` — makes the notes — before any writer check: pl's residual). Update the module comment by a sentence (places → the notes' overlay).

### 3. `src/lib/server/state/write.ts`
- New private `overlaidPlace(db, sessionId, owner, slotId): Promise<boolean>`: true only when `owner.kind === "location"`, the slot is world-scope, the entry's `lorebook_id` equals the session's `sessions.lorebook_id` (non-null: the attached book, not the notes), and `keepsValuesInOwnBook` — cheapest checks first, one doc comment citing ★pl-1.
- `setValue`: first line — when `overlaidPlace(...)`, return `setOverlaidPlaceValue(db, ctx, change, messages)` instead.
- New private `setOverlaidPlaceValue`, mirroring `setValue`'s order:
  1. `assertSessionOwner(db, ctx.sessionId, { kind: "session_location", id: change.owner.id }, ctx.userId)` — the place is one this session sees (no book-writer check on the attached book);
  2. `assertOwnBookWriter(db, ctx.sessionId, ctx.userId)` — before the notes are made or touched;
  3. `config = configFor(db, { sessionId, owner: change.owner, slotId })`; `assertUnlocked(db, ctx, config)`;
  4. `anchor = anchorFor(db, ctx, { kind: "session_location", id: change.owner.id }, messages)` — the world's open anchor, as the session's own place layer gets (so Back takes it);
  5. `notes = ownBookFor(db, ctx.sessionId)`;
  6. `db.transaction(async (tx) => { lockStateVersion(tx); holdOwner(tx, change.owner); movedSinceBase(tx, …) → throw if moved; value = slotValueForStorage(await nextValue(tx, ctx, change, config)); validateValue(tx, {…, owner: change.owner, value, config}); nextStateVersion(tx); layPlaceValue(tx, notes.id, change.owner.id, change.slotId, value, { sessionId, messageId: anchor, runId: null }) })` — `tx` only inside; ties.ts by dynamic `await import(...)` (as write.ts already does for other modules). Return `0` (no `attribute_values` row). **Check** every consumer of `applyChange`/`applyAutomatic`/`setValue`'s returned id (`state/write.ts` `applyChangeSet`, `pipelines/runtime/bindings.state.ts` ~1019, `sockets/state.ts`): if any looks a row up by that id, stop and report it rather than work around it.
- `applyAutomatic`: the mode gate also skips an overlaid place (`&& !(await overlaidPlace(db, ctx.sessionId, change.owner, change.slotId))`, after the existing checks) — the notes are exempt from the write mode (★M3b-W-3).
- Touch nothing else in write.ts (lane `ed` follows in this file; additive hunks only).

### 4. `src/lib/server/state/resolve.ts`
- `SessionLinks` gains 🚧 `placeValues?: Record<string, Record<string, unknown>> | null` — the notes' overlay place values, set only when `valuesOwnBookId` is (doc comment: ★pl-1; read before the book's place row).
- `sessionLinks`: `placeValues: keeps && ownBook ? placeValuesOf(ownBook.extraJson) : null` (ownBook is the full row already read; dynamic import of ties; no extra query).
- `fromLayers` gains an optional last param `placeValues`; at a layer of kind `location`, when the overlay holds a non-null, non-undefined value for `(layer.id, slotId)` return it; null/absent → fall through to that layer's rows as now.
- `valueOf` and `locationsFor` pass `links?.placeValues` / `links.placeValues`. `chainFor` and `resolutionChain` unchanged.

### 5. `src/lib/server/lorebooks/ownBook.ts` — the carry, additive
`cloneWithChanges` (~1083) rekeys the rule-fed overlay's `entryFields`/`castStates` to the copy's ids: add `placeValues: rekey(fed.placeValues, maps.entries)` (and the field in the inline type). Nothing else (Apply to the lorebook and Share as a lorebook leave the overlay alone today — leave them).

### 6. Tests — `src/lib/server/state/worldScope.int.test.ts` (additive describes at the end; reuse its helpers: `world`, `memberOnProvidedBook`, `memberSessionWithGuest`, `setState`, `socketOf`, `setMode`, `ownBookIdOf`, `allValuesOnBook`)
Declare a world-scope **integer** slot on places (e.g. `test:slot/lamps@1`, `appliesTo: ["location"]`, `scope: "world"`) in `declareSlots` and the genre's slots. A place = a `lorebook_entries` row of the book with `typeId: LOCATION_TYPE_ID` (`$lib/shared/entries/types`) that the session sees (check `placesOnReading`'s sight rules). Cases:
1. A member's session on a book they don't own: a run's write (`set-state`, owner `session_location` X) lands in the notes' `extra_json.ruleFed.placeValues[X][slot]`; `valueOf(session_location X)` and `stateFor`'s place read it back; a book value (a `location` X row, `sessionId: null`) is the fallback before any write; a second write (socket `state:set` by the session's owner) updates the overlay; the book gains nothing (no `attribute_values` row for `location` X, no new entry or binding in the book).
2. The same under the book owner's **Review** and **Off**: the place write still applies to the overlay, no proposal.
3. **Back / Forward**: with session messages, a run's place write anchored to the newest message; `retractStateAnchoredTo(db, messageId, { ticks: "take", scenes: "take" })` puts the read back to the book's value (overlay key gone or as before); `restoreRetractedState(db, taken)` brings the value back. (See `lorebooks/imprints.int.test.ts` / `state/write.int.test.ts` for how messages and retraction are set up.)
4. The owner's own book: unchanged — the value lands on an `attribute_values` `location` X row (`sessionId` null) and the notes' overlay holds no `placeValues`.
5. A guest's refused place write makes nothing: `memberSessionWithGuest`, own book deleted first; the guest's `state:set` on `session_location` X is refused; no own book, no overlay, no value row. **The residual**: in a session with **no** attached book and its own book deleted, a guest's world write on an owner of another kind (an explicit `location` and a `card`) is refused and makes no own book.
Every new `describe`/`test` keeps the file's 60 s timeouts.

## Files owned (edit only these)
`src/lib/server/rulesets/ties.ts` (overlay section, additive), `src/lib/server/state/worldScope.ts`, `src/lib/server/state/write.ts` (the hunks above only), `src/lib/server/state/resolve.ts` (the hunks above only), `src/lib/server/lorebooks/ownBook.ts` (the one rekey line), `src/lib/server/state/worldScope.int.test.ts`.
## Files readable
Anything under `src/`, `../serene-pub-sdk/` (read only).
## Out of scope (never build)
A copied entry; a second history mechanism (story-clock dating of the overlay, a version column); configs (`state:configure`) on places; the statTrail/ledger; docs and NOMENCLATURE (the supervisor writes them); any SDK edit; any migration; `lorebooks/imprints.ts` (if it needs a change, stop and report).

## Stop and report (don't decide) when
A new name beyond `placeValues`, `layPlaceValue`, `placeValuesOf`, `overlaidPlace`, `setOverlaidPlaceValue`; a change outside the files owned; a consumer that reads the returned id; any case where the design above can't hold; a migration.

## Rules (quoted from CLAUDE.md / NOMENCLATURE — they bind you)
- CLAUDE.md Decisions: "Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report." "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."
- CLAUDE.md P1: "Code decides what code can… every automatic action shows its cause." P2: "A module owns its data and every write to it… Two writers of one thing is a bug." — the overlay's only writer is ties.ts's `overlayInNotes`; reach it only through `layPlaceValue`.
- Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never add a top-level `await` to `src/lib/server/db/index.ts`." "Never `kill -9` the dev server." "It is a **session**, never a *chat*."
- Standing ruling: "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass" — this change adds a key inside existing JSON and needs neither; if you find otherwise, stop.
- NOMENCLATURE R1 "One word, one meaning" · R2 "Prefer distinctive words" · R3 "Qualify, never the bare noun" · R6 "🚧 Provisional — designed but not built, so the words may still move". Mark every new name 🚧 in its doc comment. §24: "Grep for it first — across `src`, the SDK, and the schema. If it collides, either pick another or rename the other use in the same change."
- Tests: run only the targeted files below. "**Never pipe vitest into `head`**: the SIGPIPE leaks PGlite temp dirs." "An int test that opens a DB inside an `it` needs a 60 s timeout under load." If a test fails on an `@serene-pub/sdk` dist import, another lane may be rebuilding the SDK: wait a minute and re-run.
- Other lanes edit this tree: re-read a file right before each edit; additive hunks; never reformat a file (several are dirty at HEAD — no prettier --write).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: no SDK edit.)

## Done means
`npx vitest run src/lib/server/state/worldScope.int.test.ts src/lib/server/state/owners.test.ts src/lib/server/state/write.int.test.ts src/lib/server/state/resolve.int.test.ts src/lib/server/state/locations.int.test.ts src/lib/server/state/locationStat.int.test.ts src/lib/server/rulesets/ties.int.test.ts src/lib/server/lorebooks/imprints.int.test.ts src/lib/server/lorebooks/cloneWithChanges.int.test.ts` green (report counts per file; a failure that also fails at HEAD's behaviour, say so with evidence); `npx tsc --noEmit -p .` shows no error in the files you touched (filter its output by path; report others as pre-existing, untouched).

## Report (final message)
Changed files with line ranges; the design as built (any deviation and why); tests run with pass/fail counts; the consumers of the returned id you checked; Noticed, not done.
