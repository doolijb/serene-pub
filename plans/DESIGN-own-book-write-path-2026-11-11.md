# DESIGN — Stage B: the one write path (ST0) — 2026-11-11

**Status: a read-only design pass, saved by the lead from the designer's final message. Not ruled, not challenged
yet, nothing built.** It designs to `plans/PLAN-sensible-engine-2026-11-11.md` Part 1 and Part 5.

Marks: **[R]** read at the cited line. **[I]** inferred. Paths are relative to `src/lib/server/` unless they start
with `/` or `../`.

**Short version.** A session writes only to its own book. A change to something the lorebook already holds is stored
as a turn-anchored amendment in the own book. Members keep their overlay rows. Links get overlay rows. Stats use
`session_id` as the session's layer. The list of held changes is a query over the own book, not a new table. Apply is
the only door into the parent book, and it is the settle line. A branch copies its parent's whole own book at the
fork message.

---

## Decisions

**D1. The missing piece is amendments held in the own book.** A session's change to a parent entry becomes an
`entry_amendments` row with `lorebook_id` set to the own book, `entry_id` set to the parent entry, anchored to the
turn and carrying the `base` it was drafted against.

- Why: the readers already apply amendments in one function, `entryAt` (`state/entriesOnReading.ts:133-144` [R]).
- An undated per-field overlay of parent entries already exists as JSON: the "rule-fed overlay"
  (`rulesets/ties.ts:487-492` [R]); retrieval lays it on top of the amendments
  (`pipelines/runtime/host.ts:4425-4444` [R]). This turns that JSON into table rows.
- *Rejected: own-book entry rows with `overlay_of`.* An overlay row has a new id, so every link, stat and stored
  reference naming the parent id would point at the wrong row. Every reader combining the two books would have to
  learn to hide the parent row, and branch scoping already failed open twice that way. It would also double the
  embedding vectors.

**D2. One shape per kind of row.**

| Kind | A new row | A change to an existing parent row |
|---|---|---|
| Entries, places, history entries | Own-book row (as today) | Held amendment |
| An own-book entry changed by a later turn | — | Also a held amendment (no imprint, no splicing) |
| Links | Own-book row; its ends may be parent entries or members (precedent: member–entry links keep the member end in the parent, `lorebooks/ownBook.ts:910-958` [R]) | Overlay row (`narrative_relationships.overlay_of`); formalises the ties code's "overlaid by the notes' own copy" (`ties.ts:336-342` [R]) |
| Cast members | Own-book member | Overlay member plus character versions (built: `characters/versions.ts:1859-1895` [R]); always used when the member is in the parent |
| Scenes | Own-book row; Apply sets `lorebook_id` and `branch_id` | — |
| Stat values | Session layer (D9) | Session layer (D9) |
| Lorebook annex | Own book's document, overlaid key by key (built: `lorebooks/annex.ts:9-16` [R]) | Same |
| Rule-fed overlay JSON | Retires: `entryFields` become held amendments, `castStates` overlay versions, `placeValues` session-layer `location` values | |

Sessions write scenes, not history (S14). An own-book day entry is filed onto the parent's entry for that day at Apply.

**D3. Held amendments are the nearest layer when reading.** Order: the line's amendments as the reading leaves them
(`amendmentsOnLine`), then the held ones, oldest anchor first. A dated held amendment applies only at or before the
moment; an undated one always applies. Today the table refuses an undated row by design: "An amendment IS a date"
(`db/schema.ts:9204-9206` [R]; `year` NOT NULL at `:9239`). Under this design only a held amendment may be undated (Q2).

**D4. One write path.** Sentence for modders: *"A session writes only to its own book; a change to something its
lorebook already holds is kept there as a change on top, and reaches the lorebook only by Apply."*

- `sessionWriteBook(db, sessionId)` returns the own book, made if missing. `sessionBooks(db, sessionId)` returns
  `{ own, parent }` for reads (today's `lorebooksReadBy`).
- Retire: `loreWriteRoute`, `loreWriteTargetFor`, `loreWriteBookIdOf`, `keepsValuesInOwnBook`,
  `attachedOrOwnBookOf` (`ownBook.ts:236-488` [R]), `ensureSessionLine`, `sessionLoreWriteMode`
  (`state/loreWriteMode.ts:56-70` [R]).
- Kept: the genre's `writes.lore` refusal (`messages/writes.ts:101-116` [R]); a different question.

**D5. The held-changes list is derived, not stored.** `heldChangesOf(sessionId)` reads the own book; the own book
*is* the durable list. Each item: `{ kind, subject, anchorMessageId, origin, additive, diff, conflict }`.

| Kind | Additive? |
|---|---|
| `entry-new`, `link-new`, `member-new`, `scene` | yes |
| `entry-change`, `link-change`, `member-change` | no |
| `value`, `annex-key` | only if the parent has no value for it |

Replaces, from review row G2.5: the "This session only" card (`overlayItemsOf`, `ownBook.ts:1123` [R]); review-gate
cards (routines become Off or On; their writes land as held changes); Revert/Keep on a kept entry. Does not replace:
library proposals; `state_proposals` (whether it serves anything beyond Review mode is unverified).

**D6. Apply: `applyHeld(db, { sessionId, by: {userId} | {automatic: cause}, items? })`.**

- Who: the parent's owner only (as built, `ownBook.ts:1176` [R]). An automatic Apply also requires that the session's
  owner is the book's owner, that the session is not a branch (`branchOfSessionId` null), and that items are additive
  or clean. Everything else stays held, with its reason.
- Conflicts, re-checked at accept time (F6): amendment — the parent's resolved field now differs from `base`; link
  overlay — the parent row's fields differ from the base recorded in the overlay row's change record; member — the
  parent's version in force is not `copied_from_version_id`; value — a book row for the same owner and slot on the
  session's line has a higher id than the session's earliest held row for that slot; annex key — `annex_versions`
  for that owner has moved since; new entry — a near-duplicate name (F4) holds it as "possible duplicate".
- Each held amendment: dated — the row moves (`lorebook_id` to the parent, `branch_id` to the session's line),
  superseded not overwritten (F9); undated — folded into the parent row, `before` kept in the change record.
- A new row moves with its held amendments folded in.
- Values: only slots with `scope: 'world'` are re-filed as book rows; the write `recordToTimeline` already makes
  (`state/durable.ts:241-254` [R]).

**D7. Settle line and Forward.** Apply settles through the newest anchor among the items it applied
(`settleThrough`, `sessions/settle.ts:123` [R]) and discards the Forward stack, as today (`ownBook.ts:1192-1194`
[R]). Removed as triggers: settling by `sources` (`host.ts:11592-11598` [R]) and when a scene's summary is done
(`settle.ts:62-83` [R]). `lore_sources` stays as provenance; F7 reads it.

**D8. What "taken back" means.** Every Apply writes change records grouped under one `batch` with its `cause`. "From
this session" lists the batches. Taking one back moves its additive rows back into the own book, unless something
now stands on them (another session's link, a compiled day) — then it refuses with a sentence (F8); and restores
edits by the imprint rule, only while a field still holds `after`. The settle line goes back only when the batch
taken back is the session's newest.

**D9. Stats.** `session_id` on `attribute_values` and `attribute_configs` already means "the session's layer, gone
with the session": the FK cascades (`db/schema.ts:10407-10409` [R]) and durable rows set it to null on purpose
(`durable.ts:248-251` [R]). So it becomes *the* layer, and owner kinds drop from nine (`state/owners.ts:38-48` [R])
to five: `card`, `cast_member`, `lorebook`, `location`, `player_seat`.

| Old kind | New |
|---|---|
| `session` | (`lorebook`, the book the session reads) + `session_id` |
| `seated_member` | (`cast_member`, the member) + `session_id` |
| `session_location` | (`location`, the entry) + `session_id` |
| `session_cast` | already scheduled to go in S5 |

Read order: (owner, session rows) → (owner, the book's rows on the line) → the next owner. `resolutionChain` loses
its own-book-member layer. A slot's own `scope` decides whether Apply takes it. Statement for modders: *"A stat lives
on its owner. What a session writes is the session's — Back takes it and it goes with the session. A stat declared
Across sessions reaches the lorebook when the session applies."* `player_seat` stays a kind, because its id is a
seat [I].

**D10. One change record: widen `lore_imprints` in place.** Name through NOMENCLATURE (★S6). Session annex keys:
subject id = the session, field `<owner>/<key>`. Seat bench: subject id = the seat row, field `character.benched` or
`player.benched`. Ruleset conversion: subject id = the session, field = the ruleset id. The splice rule
(`lorebooks/imprints.ts:21-26` [R]) becomes the one rule for every kind; the "kept" branch goes, because no turn
writes a real book any more. *Rejected: a sibling table* (two copies of the splice, two queries behind "From this
session").

**D11. Branch cut: one cut by fork message.** The branch gets a copy of the parent's *whole* own book as of the
fork: entries, held amendments, links, members *and* overlay members with their versions, values and the annex.
Seats point at the copies. Goes: the overlay chain (`state/reading.ts:288-306` [R]), branch retire marks, session
cuts on cast versions, `purgeKeptOwnBooks` (`ownBook.ts:588` [R]), members riding (`ownBook.ts:666-668` [R]).

**A gap the plan does not name:** once the parent session *applies* after the fork, its changes are the book's, and
the branch reads the book live. Rule 3's "nothing the parent does later reaches it" is then false. See Q1.

**D12. Session-made lorebook lines.** Sessions stop creating lines. `line_on_first_write`
(`sessions/branch.ts:150` [R]) and `forkRidingSessions` (`sockets/scenes.ts:1102-1139` [R]) are removed. Existing
lines stay as author lines; sessions on them stay on them. Apply lands on the session's line, as today
(`ownBook.ts:1184` [R]).

**D13. What triggers Apply.** **Scene end** means *the scene's summary is saved* when the genre summarises scenes,
else *the scene closes*; cause `{kind:'scene', sceneId}`. Replaces the `recordToTimeline` calls at
`sockets/scenes.ts:494` and `:2556` [R]. **Close out** covers all four doors (G2.8): `closeOutSession`
(`sockets/sessionArchive.ts:21` [R]) calls it after its summaries. S4a: a genre with no scenes applies at Close out,
which includes starting the next chapter.

**D14. Book-scoped pipelines.** `registrations` gains `scope_kind 'lorebook'` with a `lorebook_id` FK (today genre,
preset, session: `db/schema.ts:8323-8345` [R]). Core declares the book defaults in code. Two new events:
`lorebook-applied`, `lorebook-date-advanced`.

- **"The date advances"**, per line L: after an Apply or a clock move, present(L) is the later of L's clock and the
  newest dated scene applied to L. Each day strictly before it that holds applied, summarised, uncompiled scenes is
  compiled, oldest first, one compile per day. A line with neither a clock nor dated scenes never compiles by itself.
- Model: the pub's capability default through the registration's step config, as the Compile press does today
  (`sockets/scenes.ts:1200-1228` [R]).
- Caps: the book's registration row `state` holds `runsSincePerson`; the limits are the system's cron caps
  (`db/schema.ts:4205-4219` [R]). At most `maxRunsInRow` days per trigger; the rest wait and say so on their day's
  step line.
- An automatic compile lands at once; the entry's previous content goes into a change record with `origin
  'book-run'` and no session, so it can be taken back. The graph builds once per batch.

**D15. `new-world` and the lorebook annex.** `new-world` copies the chosen world *into the own book*, with no
parent, as starter kits are copied into session notes; today it makes a real "(copy)" book
(`sockets/sessions.ts:1543-1553` [R]). A `scope:'lorebook'` annex write lands in the own book's document and reaches
the parent at Apply; the guide's "every session of this book sees and moves the same number"
(`../serene-pub-sdk/guides/storage.md:434-441`) becomes "…after Apply". Writes from a book-level run stay lasting at
once (`:467`).

**D16. Upgrade path:** the table at the end of the schema section.

---

## Schema changes (one generated migration; next index above 0153)

- **`entry_amendments`**: add `source_message_id int` (held rows only) and `base jsonb`; `year` nullable with CHECK
  `year IS NOT NULL OR base IS NOT NULL`.
- **`narrative_relationships`**: add `overlay_of` (FK to itself, set null) and `source_message_id int`. Cross-book
  ends only from an own book to its parent, enforced by the writer.
- **`character_versions`** (added after pr-7, free to reshape): add `copied_from_version_id`.
- **`lorebooks`**: add `apply_automatically`, `compile_history_automatically`, `build_graph_automatically` (boolean,
  NOT NULL, default true); drop `lore_write_mode` after seeding; `extra_json.ruleFed` emptied by a boot pass.
- **`lore_imprints`** (the change record): `session_id` and `lorebook_id` nullable, CHECK that one is set; add
  `origin text NOT NULL default 'run'` (run · routine · press · person · apply · book-run · upgrade), `batch text`,
  `cause jsonb`; subject kinds + `session_annex`, `seat`, `ruleset`, − `overlay` (after its pass); status
  `standing | settled`.
- **`registrations`**: scope CHECK adds `lorebook`; add `lorebook_id` (FK, cascade).
- **`attribute_values` / `attribute_configs` / `zone_contents`**: owner-kind CHECK shrinks to five (ST9, after its pass).
- **`lore_sources`**: drop `lorebook_id`.
- **Dropped:** `annex_deltas` (after conversion); `sessions.line_on_first_write`; `sessions.branch_ancestry.mark`
  (only if the cut needs no marks, Q1); `user_settings.lore_write_mode`.

**Upgrade path (D16)**

| Data | First stored | What it needs |
|---|---|---|
| Standing imprints on real books (sessions that wrote through) | pr-7 (0124) | Boot pass: one `upgrade` batch per session; settle line moved to their newest message (Q5) |
| `kept` imprints | pr-7 | Same batch, re-marked standing: Revert becomes take back, Keep becomes dismiss |
| Rows written through with no record (`ownBook.ts:412` [R]) | pr-7 | Nothing: they are the book's |
| Own books that overlay a book, and their entries | pr-7 (0104) | Nothing: they are held additions |
| `ruleFed` JSON | pr-7 (`entryFields`, `castStates`); `placeValues` after pr-7 | Boot pass to held amendments, overlay versions, values |
| The four session owner kinds | pr-7 | ST9 boot pass, one transaction per session |
| `annex_deltas`, `rulesetConversions` | pr-7 (0127, 0130) | Per-key records |
| `seatBenches` | after pr-7 | Records, or drop |
| `lore_write_mode` | pr-7 | Set `apply_automatically = (mode = 'full')`, then drop |
| `line_on_first_write`, `branch_ancestry` riders | after pr-7 (0146) | Clear the flag; copy pass or label (dev data only) |
| 0.5.3 | via the attic | Nothing beyond `ensureOwnBooks` |

---

## Read paths that change

- `lorebooks/ownBook.ts`: `sessionEntriesAsRead` lays held amendments on the parent's rows; `lorebooksReadBy` →
  `sessionBooks`.
- `state/entriesOnReading.ts`: `entryOverlaysFor` gains `holderIds`; `entriesAsRead`, `entryAt`, `amendmentDeciding`
  sort held amendments last (D3).
- Shared resolver `/home/jody/github/serene-pub/src/lib/shared/lorebooks/amendments.ts` and `lineReading.ts`:
  `Amendment.held`; `amendmentsOnLine` puts held amendments last.
- `pipelines/runtime/host.ts`: retrieval (~4405-4444) `ruleFed` replaced by held amendments; `resolveLoreLinkEnd`
  (1408-1458) resolves over both books, and a change to a parent entry is allowed.
- Links: `linksOnReadingThatWay`, `tiesOnWire` hide a parent row whose id is an own-book row's `overlay_of` [I].
- `state/reading.ts`: `overlayChainOf`, `cutsOfAncestry` go (or stay, for Q1=B); `rowsOnReading` gains a provenance
  cut (Q1=B).
- `state/resolve.ts`: `sessionLinks` drops `valuesOwnBookId` and `placeValues` (`:797-809` [R]); `owners.ts`
  `resolutionChain` shrinks.
- `cast/memberAsRead.ts`: the overlay chain is only the session's own book [I].

## Write paths that change

**Callers of the old routing functions**

- `loreWriteTargetFor`: `host.ts:1595-1604`; `state/durable.ts:192-195`; `characters/versions.ts:1860-1865`;
  `rulesets/ties.ts:242-247` [R].
- `loreWriteBookIdOf`: `host.ts:3856` [R].
- `keepsValuesInOwnBook`: `state/worldScope.ts:105`; `state/write.ts:1863`, `:2487`; `state/resolve.ts:797` [R].
- `attachedOrOwnBookOf`, each to be sorted into "read the parent" or "write the own book" [I per site]:
  `state/clockProposal.ts:98` · `state/worldScope.ts:121` · `annotations/queue.ts:376` · `state/storyTime.ts:464`,
  `:527` · `sockets/state.ts:1133` · `sockets/summarize.ts:99` (write) · `state/presencesOnReading.ts:138` (read) ·
  `sockets/storyClock.ts:161` · `sockets/pipelines.ts:4944` · `rulesets/read.ts:606` (read) ·
  `scenes/liveScenes.ts:1315` (write) · `sessions/sweptRelationships.ts:79` · `host.ts:5680`, `5987`, `6037`,
  `6499` (vocabulary, read), `6730` (links, write), `6866`.

**Everything else**

- `host.ts`: `changeLoreEntry` (2002-2087) inserts a held amendment instead of updating; `update-lore-entry`
  (11477-11610) stops refusing changes to parent entries; `forkedLoreLine`, `pendingLineFork` go.
- `characters/versions.ts` `storyWrite`: always targets the overlay row for a parent member.
- `rulesets/ties.ts`: `rowForSide` makes overlay rows; `overlayInNotes`, `layPlaceValue` retire.
- `state/durable.ts` `recordToTimeline`: replaced by Apply for values.
- `ownBook.ts`: `applyOverlayItems` → `applyHeld`; `overlayItemsOf` → `heldChangesOf`; `copyOwnBookToBranch` copies
  everything.
- `sockets/sessions.ts:8105-8160`: the Apply sockets. `sessions/branch.ts:113-150`: no marks, no riding.
  `lorebooks/sessionLine.ts`: deleted. `sessions/settle.ts`: only Apply settles. `sessions/annexChanges.ts`,
  `coreAnnex.ts`: per-key records. `sockets/scenes.ts`: the compile path runs through the book registration.
  `sockets/sessions.ts:1543`: `new-world`.

---

## Lanes

| Lane | What | Depends on | Size |
|---|---|---|---|
| **B0** | Held-last ordering in the shared resolver; `entryOverlaysFor` reads several holder books. Pure, with tests; changes nothing until writes exist. **Can run now.** | — | S |
| **B1** | The one schema migration above (minus ST9's CHECK change) | ★S6 name | M |
| **ST3b** | Widen the change record; per-key annex records; boot pass for `annex_deltas` and the core logs (merges with Stage A ST3) | B1 | M |
| **ST6a** | One write path for entries and links: held amendments, cross-book link ends, link overlay rows, callers split into read and write. **Sole holder of `host.ts`.** | B0, B1 | L |
| **ST6b** | Members always overlaid; rule-fed JSON boot pass | B1, ST6a (`ties.ts`) | M |
| **ST7** | `heldChangesOf`, `applyHeld`, conflicts, triggers, settle line, batches and take-back, lore write mode retired | ST6a, ST6b, ST3b | L |
| **ST8** | Whole-book copy at the fork; overlay chain, retire marks, kept books and lines retired; provenance cut if Q1=B | ST7 (`ownBook.ts`) | L |
| **ST9** | Owner kinds 9→5, `session_id` as the layer, boot pass | ST6a, Stage A ST2–ST4 (`state/write.ts`), seat-cast S5 | L |
| **ST14a** | Registration scope and the three book settings | B1 | M |
| **ST14b** | Date-advance and graph triggers, caps | ST7, ST14a | M |
| **NW** | `new-world` copies into the own book | ST6a | S |

`ownBook.ts` goes to one lane at a time: ST6a → ST7 → ST8.

---

## Rulings this design touches

| Ruling | Date | Effect |
|---|---|---|
| Lore writes default **Full** | 2026-10-16 | Reversed (S1) |
| "Personal > Lorebook > Session" lore write mode | 2026-10-21 | Reversed; one book setting replaces it (S4) |
| ★M3b-W-1, values on the owner's own book | 2026-11-05 | Reversed |
| §31 "a branch's first book write makes a book-owned line"; "a session branch forks a line" | 2026-11-05 | Reversed for sessions |
| §30 "Fork what gets changed, when it gets changed" | 2026-11-05 | Narrowed: true within a book, not between sessions |
| §33 "retire mark (not kept rows) for branches; parent's never-surfaced notes outlive it while branches ride them" | 2026-11-05 | Reversed (copy at the fork) |
| §31 "seats point at parent's people"; ★CV-14 | 2026-11-05 | Narrowed: the book's people yes; the parent session's own-book people become copies |
| "All sessions have a lorebook, own book or overlay. No exceptions"; "overlays can have their parent merged in place"; "the session is a patron … doesn't own it" | 2026-11-05 | Kept |
| ★H2 "the first-write fork carries the session's uncompiled scenes"; "compiling forks a riding branch session first" | 2026-11-10 | Reversed |
| "A fork made at NOW stores no date and keeps following main" | 2026-09-23 | Kept for author lines |
| Settle at `max(sources)`; "the line is by KIND of write"; `on-write` "the ONE preset-proof lock" | 2026-10-24 | Reversed (S3) |
| "Three homes: annex · messages · lorebook" | 2026-10-24 | Kept, now true |
| Runtime keys → annex owner `core` | 2026-10-24 | Reversed for the two undo logs (S6) |
| "An amendment IS a date" (schema charter) | 2026-09-23 | Narrowed: only a held amendment may be undated |
| A12, book-scoped registrations | 2026-10-24 | Kept; built here |
| ★B-3 surfaced books; the book lock; ruling 15 "most recently used line" | 2026-11-08 / 10-24 / 09-27 | Kept |

---

## Open questions for the owner

1. **Should a branch see what its parent session applies after the fork?** *Recommendation:* no — the reading cuts
   parent-book rows by provenance (the applying session and message), as `rowsOnReading` already does for values
   (`reading.ts:582-601` [R]). *Trade-off:* every row kind must carry its source, plus a read predicate everywhere
   (L); rows written through before the upgrade cannot be cut, so they are labelled approximate.
2. **An undated held change at Apply.** *Recommendation:* fold it into the parent row and keep `before` in the change
   record. *Trade-off:* in a clockless book, "supersede" becomes "overwrite with take-back".
3. **When exactly is "scene end"?** *Recommendation:* when the summary is saved; at close for genres that do not
   summarise. *Trade-off:* a scene whose summary never arrives waits for Close out.
4. **S4a: Apply in a genre with no scenes.** *Recommendation:* Close out only (it includes next chapter).
   *Trade-off:* a long sceneless session holds everything until then.
5. **Sessions that already wrote through: where does their settle line go?** *Recommendation:* to the newest message
   that wrote the book (refuse rather than guess). *Trade-off:* Back stops earlier than it did on those sessions.
6. **One change record: widen `lore_imprints` or add a sibling?** *Recommendation:* widen; rename at the RC1 squash.
   *Trade-off:* the charter "a change to a lorebook row" and the NOT NULLs change.
7. **`new-world`: real copy, or own book?** *Recommendation:* own book. *Trade-off:* the copy no longer appears on
   the shelf until "Share as a lorebook". *Alternative:* keep the real copy and let automatic apply carry changes.
8. **Stat owner kinds: drop to five now?** *Recommendation:* yes, in ST9. *Trade-off:* the published SDK owner kinds
   (`SessionStateOwnerV1`) change — the owner's call.

---

## What the designer could not determine

- Whether own-book members existed in pr-7 data (decides whether the branch copy pass has pr-era riders).
- What each `attachedOrOwnBookOf` site in `host.ts` uses the book for, beyond the names.
- Whether retrieval re-embeds amended text; if not, a held amendment is ranked by the parent's vector.
- What `state_proposals` serves apart from Review mode.
- Whether session-made lines can be told apart in stored data (no marker column on `lorebook_branches`).
- Whether the ties code finds "the notes' own copy" of a link by its ends or by a stored id (`rowForSide` past 369).
- How library write mode interacts with Apply.

---

## Challenger round (2026-11-11, one round) — all accepted; the design above is amended by this section

A cold `plan-challenger` checked the design against the code. Five objections and a sixth on lanes. The lead accepts
all six. Where this section and the text above disagree, this section wins. **Stage B does not start, B0 included,
until the owner rules the questions at the end.**

**C1 (HIGH) — held amendments would fail open in most readers and leak in a few.** D1 files a held amendment under
the own book while it names a parent entry, breaking the schema's stated rule that `lorebook_id` is "carried beside
`entry_id` so the pool can read every amendment in a book" (`db/schema.ts:9217-9219`). Readers built on that rule:

- load overlays per book, or key by the entry row's own book, so a held row never reaches a parent row:
  `state/supply.ts:105-107`; `embedding/ragContext.ts:538-540`, `:630`; `sockets/entries.ts:1253`;
  `pipelines/entities/sideCharacter.ts:161`; `utils/graphEntryLinks.ts:214`; `loreMatch.ts:34,50` and
  `sessionPlaces.ts:111` (through `entriesAsRead`);
- skip the shared function: the names vocabulary (`annotations/index.ts:263-268`; ruling R1 of 2026-09-30 says names
  read amended); the book copy (`lorebooks/tableRegistry.ts:770-790`) drops any amendment whose entry is not in the
  copied book, so copying an own book would silently lose its held changes;
- query by `entry_id` alone and would pick up every session's held rows: `utils/lorebookEntries.ts:636-640`;
  `lorebooks/imprints.ts:193-197` (so take-back would refuse).

**Amendment to the design:** the holder travels on `EntryReading` (the session's own book). `entryOverlaysFor`
includes held rows whenever the reading is a session's and leaves them out for the main reading, so no caller opts
in. The by-entry readers and the registry copy exclude held rows explicitly. "Share as a lorebook" says what it does
with held rows. ST6a's brief lists every reader above with one test each: retrieval, keyword match, names
vocabulary, places, supply, side characters, graph links, workspace. Ranking by the parent's vector is acceptable
(R1's base-vector rule).

**C2 (HIGH) — take-back is promised, but settling and the default book runs defeat it.** `compactThrough` sets
`before: null, status: 'settled'` on every standing record at or before the line (`sessions/settle.ts:256-265`) and
collapses the session's value rows to one per owner and slot (`:184-215`). So an Apply batch's own records would
lose the `before` D8 needs; older items still held (conflicts routinely are) would be compacted without ever being
applied; and D6's value-conflict test would lose its rows. And with all three book settings on, an automatic Apply
is followed at once by a graph build and a history compile, after which D8's own rule refuses take-back.

**Amendment:** settle only up to the message before the oldest item still held. Records with `origin: apply` are
exempt from compaction until taken back. Taking back an Apply batch also takes back the book-run batches it caused,
while those are still the newest. Where that is not possible, the automatic apply says plainly, before and after,
that it cannot be undone once the book has run. P1 is not met otherwise.

**C3 (MEDIUM-HIGH) — the recommendations for Q1 and Q2 cannot both hold.** Folding an undated held change into the
parent row leaves no provenance to cut on, and an undated change is the normal case for a session with no clock.
Applied values reach the book with `validFromMessageId: null` (`state/durable.ts:252`; `settle.ts:207-213`), while
the existing cut keys on that column (`state/reading.ts:582-597`). The fold also contradicts "supersede, never
overwrite" (plan F9), which is why amendments were chosen.

**Amendment:** Q1 and Q2 become one question for the owner (below).

**C4 (MEDIUM) — D9's premise is wrong: today the owner *kind* decides the layer, not `session_id`.**
`isSessionScoped` picks by kind (`state/resolve.ts:1463-1468`); writes set `session_id` only for those kinds
(`state/write.ts:2592`, `:2677`); "an own-book member's rows carry no `session_id`; they are this session's alone"
(`write.ts:598-599`); sheets filter by kind (`resolve.ts:1336-1341`). Some book-side readers apply no session filter
(`state/storyTime.ts:742,761-771`) and would show every session's rows as the book's. The ST9 schema line misses
`owner_sheets_owner_kind_check` (`db/schema.ts:11039-11041`) and `attribute_carries_owner_kind_check`, which allows
only session kinds (`:11112-11114`).

**Amendment:** ST9 lists every query on those five tables and replaces each kind check with an explicit `session_id`
filter; the migration includes `owner_sheets` and `attribute_carries`; a test with two sessions on one book shows
the timeline, export, counts and workspace see no session rows. D9 remains a proposal until that inventory exists.

**C5 (MEDIUM) — the whole-book copy must remap every reference to a member, not only seats.** Today a branch's rows
can point at the parent's own-book members because the parent's own book is kept while any branch names it
(`lorebooks/ownBook.ts:588-608`). D11 retires that. Columns that name members: `session_messages.cast_member_id`
(set null on delete, `db/schema.ts:2950-2953`); `scene_characters.binding_id` (cascade, `:4931-4933`);
`lorebook_entries.anchor_binding_id`; `character_versions.cast_member_id`; `cast_member_files`; `sprite_sets`; link
ends; `cast_member` stat owners. Deleting the parent after a fork would leave the branch's lines with no speaker and
delete its scene cast.

**Amendment:** ST8 builds one member remap and applies it to every column with a foreign key to
`lorebook_bindings`. Test: branch, delete the parent; the branch keeps its speakers, scene cast and versions.

**C6 — lanes.** ST3b rewrites annex records in `host.ts` (2381-2456) while ST6a is its sole holder: ST3b runs before
ST6a starts or after it ends. NW and ST7 both touch `sockets/sessions.ts`: in sequence. ST14b and ST8 both edit
`sockets/scenes.ts`: in sequence. **B0 does not "run now"**: it would build for a design that is not ruled.

### Questions for the owner, as amended

1. **A session's change to a world entry, once applied: a row or a fold? And does a branch see what its original
   applies later?** These are one decision.
   - **(a) ★ It stays a row.** An undated held change survives Apply as an undated change on top of the entry,
     carrying the session and message that made it, ordered after dated ones. A branch's reading can then leave out
     what its original applied after the fork. Keeps "supersede, never overwrite". Cost: applied values and every
     other row kind must carry their source too, and every reader applies the cut (L).
   - **(b) Fold, and a branch sees what the original applies.** Simpler. Rule 3 is reworded: a branch is cut off
     from its original's *session*, not from the lorebook; what the original applies is the lorebook's and every
     reader of the lorebook sees it.
2. **Undo of an automatic apply.** ★ Taking it back also takes back the history compile and graph build it caused,
   while those are the newest; otherwise the apply says it cannot be undone. Alternative: the two book runs wait
   one scene behind the apply, so the newest apply is always still undoable.
3. **When exactly is "scene end"?** ★ When the summary is saved; at close for genres that do not summarise.
4. **A genre with no scenes.** ★ Apply at Close out only (which includes next chapter).
5. **Sessions that already wrote through.** ★ Their settle line moves to the newest message that wrote the book.
6. **One change record.** ★ Widen the existing table; rename it at the RC1 squash.
7. **`new-world`.** ★ The copy becomes the session's own book, with no parent.
8. **Stat owner kinds, nine to five.** ★ Yes, after the inventory in C4. It changes published SDK owner kinds.
