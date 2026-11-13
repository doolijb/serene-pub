# BRIEF cv-core-w2 — the reader: cast members read from character versions, session cuts and the overlay chain

Worker (Sonnet) for lane **cv-core**; the supervisor is the cv-core lane-supervisor. App `/home/jody/github/serene-pub`. Report as your final message (no report file), starting `# REPORT cv-core-w2 (2026-11-05)`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
Plan §32 §6 / §33: `membersAsRead` reads each cast member from the ONE character version in force (`versionInForce`), its followed fields from the exact parent card version, across the overlay chain, with the session cut. `state/reading.ts` fills the session cuts and names the overlay chain. `castMemberCards` reads versions' parents. The legacy read stays ONLY for a member with no version at all, and is logged.

Another worker is building the writer (`src/lib/server/characters/versions.ts`) at the same time. Don't touch it or import from it. Your tests insert `character_versions` rows directly.

## Files owned (edit only these)
- `src/lib/server/cast/memberAsRead.ts`
- `src/lib/server/cast/memberAsRead.test.ts`, `src/lib/server/cast/memberAsRead.int.test.ts` (add; keep existing tests passing)
- `src/lib/server/cast/memberAsRead.versions.int.test.ts` (new)
- `src/lib/server/state/reading.ts`
- `src/lib/server/state/reading.sessionCuts.int.test.ts` (new)
- `src/lib/server/utils/castMemberCards.ts`
- `src/lib/server/utils/castMemberCards.versions.int.test.ts` (new)

Not `NOMENCLATURE.md`, not `src/lib/shared/characters/profile.ts` (import from it; if it lacks something, stop and say so), not `lineReading.ts` / `lineSql.ts` (import only). Nothing else.

## Files readable
- `src/lib/shared/characters/profile.ts` — `CharacterProfileV1`, `CharacterProfileField`, `profileOf`, `followedProfile`, `legacyGreetingsOf`, `mergeGreetings`.
- `src/lib/shared/lorebooks/lineReading.ts` — `Line`, `SessionCut`, `Line.sessionCuts`, `LineCastVersion` (+ `overlayDepth`), `versionInForce(rows, line, moment, appearance)`, `rowPassesSessionCut`, `MAIN_LINE`. `src/lib/server/state/lineSql.ts` — `onLineAtSql(branchCol, dateCols, line, moment)`, `sessionCutSql(cols, line)`, `SessionCutColumns`. `src/lib/server/state/lineSql.int.test.ts` (the `CASE_VERSIONS` describe) shows the exact composition: attached-book rows with `onLineAtSql(…, line, moment)`, own-book rows with `onLineAtSql(…, MAIN_LINE, moment)`, both with `sessionCutSql`.
- `src/lib/server/db/schema.ts` ~9345–9570 (`characterVersions`), ~2770–2800 (`sessions.branchAncestry`, `lineOnFirstWrite`), ~3060–3080 (`session_messages.originSessionId` / `originMessageId`), ~1552–1720 (`lorebookBindings`, incl. `overlayOf`).
- `src/lib/server/messages/liveHistory.ts` `liveMessageWhere` (db-free; import it from there).
- `src/lib/server/lorebooks/ownBook.ts` `ownBookOf` (own book = `lorebooks.session_id = sessionId`). Read only; don't import ownBook.ts into reading.ts (keep reading.ts's imports as they are plus schema/drizzle/liveHistory).
- `plans/PLAN-sdk-creation-seams-2026-10-30.md` lines ~1214–1291 (§32 §3, §5, §6) and ~1396–1409 (§33).

## Rules you work under (quoted)
- `memberAsRead.ts` header: "⚠ Must not statically import `$lib/server/db`; every function takes its handle first (the `castMemberCards` rule)." Same for `castMemberCards.ts` ("it is reached from `characterBindingSync.ts`, which sits on the boot path") and `reading.ts`.
- `lineReading.ts`: one rule — never re-implement the line or life-point filters; call `versionInForce` (it calls `amendmentsForAppearance`), and narrow in SQL with `onLineAtSql` + `sessionCutSql`.
- **Do not filter versions by `node_state`.** A version's `node_state` / `node_visibility` is the person's story state at that point (`deceased`, `missing`, `departed` are amendable today: `CAST_AMENDABLE` names `nodeState`), so a later "deceased" version must win, not be skipped. The reader returns it as data.
- Owner (2026-11-05): "Everything in session is cast -> active card." Plan §32 §11: "**Key flip:** `activeCardId` becomes the in-force version's parent's card."
- CLAUDE.md: an int test that opens a DB inside a test needs a **60 s timeout**; never pipe vitest into `head`; targeted tests only; `tsc` clean on your files; prettier — run `npx prettier --check` on your files; on existing files, if prettier would reformat lines you didn't touch, leave them and say so.
- Names: use exactly the names in this brief. Do not invent any other **exported** name, prop or type. Private helpers are fine. If you need one, stop and say so.

## What to build

### 1. `state/reading.ts`
- 🚧 **`sessionCutsOf(db, sessionId): Promise<SessionCut[]>`** — the session's **session cuts**, nearest ancestor first: read `sessions.branch_ancestry` (`[{sessionId, mark}]`, nearest first; null/empty → `[]`); for each ancestor A, `through` = the highest `origin_message_id` among the session's **live** lines (`session_messages`, `session_id` = this session, `liveMessageWhere()`, `origin_session_id` = A) — one GROUP BY query for all ancestors; null when none. `mark` from the ancestry. Doc: plan §32 §5b: "`through` is the highest `origin_message_id` among the reader's live lines from A, so the branch's own Back lowers it with no write".
- **`sessionReadingOf`**: select `branchAncestry` in its existing query; when the ancestry is non-empty, set `reading.line = { ...reading.line, sessionCuts }` (also on the `BranchRefusal` fallback's `MAIN_LINE`). Nothing else changes; a session with no ancestry reads exactly as today (no extra query).
- 🚧 **`overlayChainOf(db, sessionId): Promise<number[]>`** — the **overlay chain**: the session's own book id, then each ancestor's own book id in ancestry order (nearest first); a session with no own book is skipped. One query (`lorebooks.session_id IN (…)`). Doc: plan §32 §5d: "The read takes the **overlay chain**: the session's own book, then each ancestor's own book through its cut."

### 2. `cast/memberAsRead.ts`
`MemberAsRead` gains (keep every existing field; keep `tags`):
- `castVersionId: number | null` — the version in force; null on the legacy read.
- `cardVersion: { id: number; number: number; label: string | null } | null` — the parent card version; null when card-less.
- `follows: CharacterProfileField[]` — the in-force version's `follows` ([] when card-less). `followsCard` stays as ⏳ (doc: "⏳ alias of `follows` in retold-field words until 0.7"), derived from `follows`: a `RETOLD_FIELDS` field is followed when its profile field is in `follows` (`firstMessage` and `alternateGreetings` ← `greetings`; `face` ← `faceMediaId`; the rest same name); [] when card-less.
- `behindCard: boolean` — the parent card version's `number` is below that card's highest.
- The profile fields not already there: `greetings: CharacterGreeting[]`, `postHistoryInstructions: string | null`, `creatorNotes: CharacterCreatorNotes | null`, `strokes: Stroke[]`, `likeness: CharacterLikenessInput | null`, `extensions: Record<string, unknown>`; plus `nodeState: NodeState` and `nodeVisibility: NodeVisibility`.
- `firstMessage`, `alternateGreetings`, `groupOnlyGreetings` stay, marked ⏳ in their docs, derived with `legacyGreetingsOf(greetings)`.

`MemberAsReadOptions` gains `appearance?: number | null` (default null = every life point, as sessions read; the roster passes each appearance later). Doc it.

New exports:
- 🚧 **`layerVersionAsRead(member, version, parent, maxCardNumber, sets, tags)`** — PURE: one member as read from its version in force. `member`: the asked binding's `{ id, lorebookId, characterId }`; `version`: the in-force `character_versions` row; `parent`: its parent card version row or null; `maxCardNumber`: the parent's card's highest version number (null when no parent). Profile = `followedProfile(profileOf(version), version.follows, parent ? profileOf(parent) : null)`. Then: `castMemberId` = the asked member; `linkedCardId` = `member.characterId`; `activeCardId` = `parent?.cardId ?? null`; `cardless` = no parent; `name` = `profile.name ?? ""`; `nickname` = `profile.nickname || null`; `shownName` = `resolveCharacterName({ name, nickname }, "")`; the text fields from the profile; `exampleDialogues` the profile's list; `faceMediaId` the profile's; **timbre and `voiceFrom`** as today: when `timbre` is NOT followed and the profile's timbre is non-null → `timbreOfExtensions({ serenepub: { timbre } })`, `voiceFrom: "member"`; when followed and the parent's timbre normalises to an object with keys → that, `voiceFrom: "card"`; else null/null. Sprite sets as today (member's own sets, else the active card's). `spriteSet` = the profile's. `tags` = the active card's. A version whose `follows` is non-empty with no parent: those fields read empty (that is what `followedProfile` does) — the caller logs it.
- 🚧 **`castVersionsInForce(db, memberIds, opts: MemberAsReadOptions)`** → `Map<number, { version: typeof schema.characterVersions.$inferSelect; overlayDepth: number | null }>` keyed by the asked member id; a member with no candidate is absent. The session writer (a later brief) calls this to find the row it copies, so it must be exactly the pick `membersAsRead` uses. Steps:
  1. The reading: `opts.reading`, else the session's (`sessionReadingOf`, which now carries the cuts), else when the session has no attached book `{ ...MAIN_HEAD, line: { ...MAIN_LINE, sessionCuts: await sessionCutsOf(db, sessionId) } }`, else `MAIN_HEAD`. The chain: `overlayChainOf(db, opts.sessionId)` when a session is given, else `[]`.
  2. Overlay rows: `lorebook_bindings` with `overlay_of` in the asked ids and `lorebook_id` in the chain.
  3. ONE query for the versions of the asked members and their overlay rows: `cast_member_id IN (…)`, and `or(and(lorebook_id IN chain, onLineAtSql(branch, date, MAIN_LINE, moment)), and(lorebook_id NOT IN chain, onLineAtSql(branch, date, line, moment)))`, and `sessionCutSql(cols, line)`. (Empty chain → just the second arm.)
  4. Tag each row `overlayDepth` = `chain.indexOf(row.lorebookId)` when ≥ 0, else null. (An own-book person's own rows, when its book is in the chain, are read at main like an overlay; a member whose book is not in the chain reads along the line, as today.)
  5. Per asked member: `versionInForce([its rows, its overlay rows' rows], line, moment, opts.appearance ?? null)`.
- **`membersAsRead`** is rebuilt on `castVersionsInForce` in one round: (1) the members (add `overlayOf` to `MEMBER_COLUMNS` if needed); (2) the versions (via `castVersionsInForce`, which must not re-read the members — share an internal so the round stays at about four queries); (3) the parent card versions, joined to `characters` for the tag/sprite card id, plus each parent card's highest `number`; (4) tags and sprite sets as today. Layer with `layerVersionAsRead`.
  - **The legacy read** — only for an asked member that has **no `character_versions` row at all** (check with one `SELECT DISTINCT cast_member_id … WHERE cast_member_id IN (…)` in the same round): today's path (`castOverlaysFor` + `castMemberAt` + `layerMemberAsRead`), unchanged, and log once per member id per process: `console.warn("[cast] cast member <id> has no character version yet; read the old way until the next boot lifts it")`. Its new fields: `castVersionId: null`, `cardVersion: null`, `follows: []`, `behindCard: false`, `greetings` = `mergeGreetings(firstMessage, alternateGreetings, groupOnlyGreetings)` of its result, `nodeState` / `nodeVisibility` from the folded row (add both to `MEMBER_COLUMNS`), the rest empty/null. Doc: "deleted in S4's guards step (§33.5); a member with no base is then a logged error".
  - A member that HAS versions but no candidate on this reading (e.g. its only rows are cut away): read it from its base row regardless of the cut? No — that can't happen for a lifted member (the undated base on main always reads). If it does, read it the legacy way and log. Say so in a comment.
  - A version with non-empty `follows` and no parent: log once per version id: `console.warn("[cast] character version <id> follows its card but the card version is gone; those fields read empty")`.
- `layerMemberAsRead`, `MemberRowForReading`, `CardRowForReading`, `followsCardFields` stay exported (the boot lift's verify step compares today's read with the new one using them).

### 3. `utils/castMemberCards.ts`
"`castMemberCards` reads versions' parents instead" (plan §31 §8). A member's cards are: its linked card first, then the card of each of its cast versions' parent versions (version id order), then ⏳ each card a cast amendment names (today's rule — amendments are still written until wave 2 moves their writer; mark it ⏳ "until the amendments writer moves onto versions"). Apply the same order in `memberOfCard` (linked → a version parent's card, lowest member id → ⏳ amendment) and `cardTakenBy`. Keep "One card, one member" and the header (add one paragraph on versions).

## Tests
- `reading.sessionCuts.int.test.ts`: `sessionCutsOf` (no ancestry → []; two ancestors, `through` = max live origin per ancestor, a rewound line ignored, an ancestor with no copied lines → null); `sessionReadingOf` carries the cuts (and a session with no ancestry has no `sessionCuts`); `overlayChainOf` order and skips.
- `memberAsRead.versions.int.test.ts` (rows inserted directly; set `write_order` explicitly; let ids generate): a member whose base follows its card's v1 reads the card's values and `activeCardId` = the parent's card; own fields win; `cardVersion` / `behindCard` (a v2 exists); a dated version on main read at a moment before / after; a branch version on its line; `appearance` narrows by life point; a parentless follower reads empty and warns once; an own-book overlay row (`overlay_of`) in the session's own book outranks the attached row of the same date; an ancestor's own-book row read through its cut (insert `branch_ancestry`, copied `session_messages` with origins); a later `deceased` version wins (no node-state filter); a member with no versions reads the legacy way and warns once; greetings ⏳ fields derived; `voiceFrom` member / card / null.
- `castMemberCards.versions.int.test.ts`: a member's version parented on card C2 makes C2 theirs (`cardsOf`, `memberOf`, `memberOfCard`, `cardTakenBy`).
- Existing: `src/lib/server/cast/memberAsRead.test.ts`, `memberAsRead.int.test.ts`, `sessionsDrawingCard.int.test.ts`, `src/lib/server/state/reading.historyEntryDate.test.ts`, and every test file matching `grep -rln "castMemberCards\|memberOfCard\|cardTakenBy" src --include=*.test.ts` must stay green.

## Out of scope
The writer (`versions.ts`), the boot pass, `entriesOnReading.ts`, any reader of `MemberAsRead` (wave 3), NOMENCLATURE, docs, the schema.

## Stop and ask (in your report) when
An export beyond this brief seems needed; a rule conflicts with the code; an existing test's expectation must change (say which and why — don't change it silently); anything needs a file you don't own.

## Done means
```
cd /home/jody/github/serene-pub && npx vitest run src/lib/server/cast src/lib/server/state/reading.sessionCuts.int.test.ts src/lib/server/state/reading.historyEntryDate.test.ts src/lib/server/utils/castMemberCards.versions.int.test.ts <the castMemberCards test files you found>
```
green (never pipe into `head`); `npx tsc --noEmit -p . 2>&1 | grep -E "memberAsRead|state/reading|castMemberCards"` empty; prettier clean on your new files. Before and after the run, `ls -d /tmp/serene-pub-vitest-* 2>/dev/null` — delete by name only dirs that appeared from your runs.

Report: names and signatures, changed files, test results (counts per file), the query count of one `membersAsRead` round, anything you disagreed with, Noticed-not-done.
