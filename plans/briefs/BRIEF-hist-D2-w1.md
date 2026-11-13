# BRIEF — hist-D2-w1: boot passes `dc-cairns` and `dc-crawl-clock` (core)

Supervisor: hist-D2. Repo `/home/jody/github/serene-pub`. The SDK sibling (`../serene-pub-sdk`) is built; **never edit it, never run `npm run sdk:build`**. Owner GO 2026-11-10.

## Background (read, don't rebuild)

Dungeon Crawler (genre id `core:genre/dungeon-crawler`) used to write a history entry ("cairn") on each death, into the session's **own book** (session notes: the `lorebooks` row with `session_id` set). The SDK writer is gone (lane hist-D1). A death now writes a `deceased` cast version through `update-cast-member@1` (`pipelines/runtime/castMember.ts` → `writeCastVersion`, `characters/versions.ts:1657`) and appends `{ name, where, seat, castMemberId }` to `progress.fallen` in the session annex (`sessions.annex.core["dungeon-crawler-progress"].fallen`). `where` is the place name string, `""` when none (`death.ts`: `where = text(ds.location)`); `seat` is the seat's participant ref (`player-seat:<sessionPersonas.id>`, or `seated-member:<castMemberId>` for a character seat); `castMemberId` is the seat's `cast_member_id` (a `lorebook_bindings` id) or null. The DC Planner's people filter (`peopleOf`) drops a character-lore row whose `anchor_binding_id` equals a `progress.fallen` `castMemberId`, so no other marker is needed.

The DC clock moved from the session-scoped `core:slot/crawl-time@1` value (owner `{ kind: "session", id: sessionId }`, value `"Y-MM-DD HH:MM"`, e.g. `"1-01-01 08:30"`) to the session story clock columns `sessions.story_clock_{year,month,day,hour,minute}` (helpers `clockOf` / `clockColumns` in `src/lib/server/state/storyTime.ts:99-120`). The old writer rolled days into months with Gregorian lengths, so stored values land in the own book's calendar.

Owner rulings this implements (plan `plans/PLAN-history-one-per-date-2026-11-10.md` § Build scope item 6, ★H4 Q3 third round, ★C1):
- `dc-cairns`: "each existing cairn becomes a `deceased` cast version plus a `progress.fallen` entry, and the epitaph is retyped in place to character lore bound to the matched member (world lore when none matches), as ruled."
- `dc-crawl-clock`: "the latest `crawl-time` goes into the session clock." Each has a second-boot test.

## Goal

### 1. `src/lib/server/sessions/dcCairns.ts` — export `dcCairns(db): Promise<DcCairnsReport>`

- **Select** (one query; zero rows = return zeros, nothing else read): rows of `lorebook_entries` with `type_id = 'core:entry/history'` (`HISTORY_TYPE_ID`, `$lib/shared/entries/types`) in a book whose `session_id` is a session with `genre_id = 'core:genre/dungeon-crawler'`, whose trimmed `content` matches the epitaph shape *"Here lies ‹name›[, ‹class›], level ‹n›, who fell[ in ‹place›]."* (SQL `~ '^Here lies .+, level [0-9]+, who fell( in .+)?\.$'`, parse in JS). Rows that don't match are never touched.
- **Parse:** name = the row's `title` when the content starts with `"Here lies " + title + ","` (verify in the SDK git history that the cairn's title was the fallen's name: `git -C ../serene-pub-sdk show HEAD:core-catalog/src/genres/dungeon-crawler/lore.ts`, `fileLore`; read-only git only); otherwise `^Here lies (.+?)(?:, ([^,]+))?, level (\d+), who fell(?: in (.+))?\.$` group 1. `where` = the place group, else `""`.
- **Match the member**, per row:
  1. **By the turn.** `source_message_id` → that turn's fate change to `dead`: an `attribute_values` row with `session_id` = the session, `slot_id = 'core:slot/fate@1'`, `value->>'v' = 'dead'`, `valid_from_message_id = source_message_id`. **Check first** (read `pipelines/runtime/host.ts` for the lore write's `sourceMessageId` and the state delta's anchor, `state/write.ts` `anchorFor`) that one run stamps both with the same message id, and say what you found in your report; if they can differ, report it before relying on step 1. The fate row's owner → the seat: `player_seat` → `session_personas.id` → its `cast_member_id`; `seated_member` → that cast member id. If the turn names more than one dead seat, keep the one whose seat name matches the parsed name case-insensitively and uniquely; otherwise go to step 2.
  2. **By name.** A unique, case-insensitive name among that session's `session_personas` rows, **removed ones included** (seat name = `seat_name`, else its card's name). DC deaths fall only on player seats.
  3. Else **no member**. Two seats with the name = no member (this is the "ambiguous" case).
  A matched seat with no `cast_member_id` = seat known, no member.
- **Write**, in **one transaction per book**, using **only `tx`** inside it:
  - **Cast version** (matched member only): skip when the member already reads deceased (`membersAsRead(tx, [id], { sessionId })`, `$lib/server/cast/memberAsRead`, `.nodeState === "deceased"`). Otherwise `writeCastVersion(tx, { member, changes: { nodeState: "deceased" }, writtenBy: "dc-cairns", session: { id: sessionId, messageId: source_message_id, ownAnchor: true } })`. `ownAnchor: true` is what keeps an older turn from being refused as sealed (`anchorFor`, `state/write.ts:719`). When `source_message_id` is null or is not a live message of the session, skip the version and count it (`unanchored`); still do the rest. Never use `messageId: undefined` (it would tie the version to the newest turn).
  - **`progress.fallen`**: under `lockSessionAnnex(tx, sessionId)` (`sessions/coreAnnex.ts`), append `{ name, where, seat, castMemberId }` (seat ref as above, or null; castMemberId or null) to `annex.core["dungeon-crawler-progress"].fallen` (create the objects when missing, keep every other key byte-identical), in row-id order, **unless already present**: an item with the same non-null `castMemberId`, or, when castMemberId is null, the same name (case-insensitive) and `where`. Bump the core owner's annex version (`bumpedAnnexVersionsSql`, `sessions/annexVersions.ts`) when the document changed. Look at how `set-session-annex` / `sessions/seatKeys.ts:1233-1257` write the document and follow the existing writer; don't invent a second one.
  - **Retype in place** (same row id, keeps `content`, `source_message_id`, `keys`, `branch_id`, `provenance`):
    - matched member → `type_id` `CHARACTER_LORE_TYPE_ID`, `anchor_binding_id` = the member **when the member's binding is in this book**; when it is in another book, the own book's overlay row of that member (`lorebook_bindings.overlay_of = member`, which `writeCastVersion` makes for a non-direct target); with neither, fall back to world lore. Title: keep it (set it to the name when null).
    - no member → `WORLD_LORE_TYPE_ID`, title `Cairn of ‹name›` (provisional 🚧 copy, ruled by the brief; no other new copy).
    - `type_version` = the target type's current version, resolved the way entry creation resolves it (find it, e.g. `sockets/entries.ts` / `utils/lorebookEntries.ts`).
    - `position` = `nextPosition(tx, lorebookId, newTypeId)` (`utils/lorebookEntries.ts:726`) while holding the book's advisory lock (`pg_advisory_xact_lock(lorebookId)`; use the existing lock helper the entry writers use). `lorebook_entries_position_uq` is `(lorebook_id, type_id, position)`.
    - `fields`: inspect what a cairn row carries; drop only keys the target type does not declare (the row must pass `assertDeclaredFields` / the type's CHECK projection). Say what you dropped.
- **Report shape** (name it in the module): sessions, cairns, versions written, already deceased, unanchored, fallen added, character lore, world lore, failed. Not critical: a book whose transaction throws is counted in `failed`, logged by session id, and the pass goes on; after the loop a non-zero `failed` throws one error naming the count (the `seat-members` pattern, `sessions/seatMembers.ts:1-45`).
- **Second boot is a no-op:** nothing history-typed matches any more.
- Header comment in the module's style (`⏳` transitional, delete at the RC1 squash), stating what it owns and what it does not.

### 2. `src/lib/server/sessions/dcCrawlClock.ts` — export `dcCrawlClock(db)`

- For each DC session with `story_clock_year IS NULL`: read its world `crawl-time` value as the session reads it (`valueOf`, `$lib/server/state/resolve`, owner `{ kind: "session", id }`, slot `core:slot/crawl-time@1`). Parse `^(-?\d+)-(\d+)-(\d+)(?:[ T](\d+):(\d+))?$` and write the parts **verbatim** with `clockColumns` (`state/storyTime.ts`) in one `UPDATE … WHERE id = ? AND story_clock_year IS NULL`. No value or unparseable → skip and count. Sessions that already have a clock are skipped, so a second boot is a no-op. Old `crawl-time` rows stay.
- Same report/failure pattern (counts: sessions, clocks set, no value, unreadable, failed).

### 3. Registration — `src/lib/server/startup/index.ts`

Two tasks, `dc-cairns` then `dc-crawl-clock`, after `seat-keys` (seats in member form, every member has a base version) and before `plugins`. Both `failsHealth: true` with a JSDoc in the neighbours' style (`⏳` hist-D2, plan item 6; one transaction per book / per session; delete at the RC1 squash) and a console line only when something changed. **Check `git diff` of the file first**: it carries other lanes' uncommitted work; insert, never reorder or reformat.

### 4. Int tests

`src/lib/server/sessions/dcCairns.int.test.ts` and `src/lib/server/sessions/dcCrawlClock.int.test.ts`. Build real fixtures through the real writers (a DC session with its own book, player seats with cast members that have a base version, live messages). Look at existing fixtures before writing your own: `sessions/seatMembers.int.test.ts`, `pipelines/prompt/characterLore.deceased.test.ts`, the `update-cast-member` tests (`grep -rln "update-cast-member\|updateCastMember" src --include=*.int.test.ts`), and `sockets/sessions.dungeonCrawlerW3.int.test.ts` (a real DC create; heavy). Hand-insert only the old-shaped rows: the history cairn and the `fate = dead` attribute row. Cover:
- `dc-cairns`: matched by the turn (deceased version tied to the message, `progress.fallen` item, row now character lore anchored to the member, same id/content/source_message_id); matched by name (removed seat); unmatched → world lore "Cairn of ‹name›", fallen item with null seat/member; ambiguous (two seats, same name, no turn match) → world lore; member already deceased → no second version; fallen item already present → not doubled; a non-epitaph history row untouched; **second run changes nothing** (compare rows, versions and annex).
- `dc-crawl-clock`: a clock written verbatim from the latest value; an existing clock skipped; a session with no value skipped; **second run changes nothing**.

## Files owned (edit only these)

- `src/lib/server/sessions/dcCairns.ts` (new), `src/lib/server/sessions/dcCairns.int.test.ts` (new)
- `src/lib/server/sessions/dcCrawlClock.ts` (new), `src/lib/server/sessions/dcCrawlClock.int.test.ts` (new)
- `src/lib/server/startup/index.ts` — the two task entries only

## Files readable

Anything. Other sessions are editing `pipelines/entities`, config, `prompt/assemble`, `boot/seedVariableTemplates` and `src/lib/server/managed/*`: don't touch them.

## Out of scope (write down, never build)

SDK edits; docs, `NOMENCLATURE.md`, `STYLE-GUIDE.md`; the schema comment on `character_versions.written_by`; benched seats; companion death; lore visibility; cairns in an attached (non-own) book. If a helper you need is missing or wrong, report it; don't change shared modules.

## Stop and ask (in your report, then stop) when

CLAUDE.md §Decisions applies; a match case the rules above don't settle; the pass would delete data; a name or user-visible sentence beyond "Cairn of ‹name›" and the log lines is needed; a migration seems needed (it isn't meant to be).

## Rules (quoted)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."
- "A change to stored data ships with a pass and a test that a second boot changes nothing. … Never seed a row at a hardcoded id. Never add a top-level `await` to `db/index.ts`."
- "`defaults.ts` imports stay leaf": import heavy modules inside the function (`await import(...)`), as the neighbouring passes do.
- Pass `db` explicitly; `defaultDb()` bypasses `vi.mock`.
- "Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`. Delete only `/tmp/serene-pub-vitest-*` dirs your own runs made, by name — never a glob."
- Redirect vitest output to a scratch file under `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/` named `hist-D2-w1-*`, then grep it.
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You run no sdk:build at all.)
- It is a **session**, never a *chat*. Never `kill -9` anything.

## Done means

- `systemd-run … npx vitest run --maxWorkers=2 src/lib/server/sessions/dcCairns.int.test.ts src/lib/server/sessions/dcCrawlClock.int.test.ts src/lib/server/sessions/seatMembers.int.test.ts` green.
- `npx tsc --noEmit -p .` (capped: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p . > <scratch>/hist-D2-w1-tsc.log 2>&1; echo exit=$?'`) shows no error in your files.
- `npx prettier --check` on your new files (report, don't `--write`).

## Report

Final message (no report file): changed files; what step 1's anchor check found; the fields dropped on retype; the type-version source; tests run with counts; open questions; Noticed, not done.
