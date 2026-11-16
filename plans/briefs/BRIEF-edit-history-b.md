# BRIEF — build lane `edit-history-b` — edit history for card versions and cast versions

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-edit-history-2026-11-13.md`, `plans/REPORT-edit-history-a-2026-11-14.md` (the record, its one
writer, its screens: this lane extends them, it does not redesign them), `src/lib/server/lorebooks/redlines.ts`,
`src/lib/client/lorebooks/editHistory/EditHistory.svelte`, `NOMENCLATURE.md` §1, §24, §23 and the rows for
**Edit history** / `redline`, `STYLE-GUIDE.md` (forms, copy), `docs/characters.md`, `docs/lorebooks.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

The edit history built for entries (lane `edit-history-a`) also covers:

1. **a character card's versions**: every save that changes a card version in place keeps what it replaced,
   with when and who, listed under that version with **Restore**;
2. **a lorebook cast member's versions**: the same, per cast version.

It looks and reads the same in all three places, so it is familiar across the lorebook and the character editor.

## Owner rulings this lane builds (quote them in worker briefs)

- 2026-11-13: "Perhaps we should keep a change history. Change history that's not a dated change on the
  timeline (i.e. it's purely an edit and not a timeline evolution) does not persist on copy, export, share,
  copied from starter, etc. We can add admin and user controls for cleaning up non persistent change history."
- 2026-11-13: "Also make a pass on cast history and make sure it behaves similar so it's familiar across the
  entire lorebook. Lets also add card edit history." · "card edit history should be per version".
- 2026-11-14, "Lets go with all your recommendations", which rules the plan's recommendations: one table for all
  three, keyed by subject (an entry, or a `character_versions` row), never copied; the name **Edit history**;
  cast: an Edit history on each cast version, the dated list left as it is; **Share as a lorebook** clears it;
  a session-written cast version taken back by Back / swipe takes its edit history with it; an overwrite import
  clears it; machine writes are recorded as the entries lane records them (a routine with its run; Apply, Revert,
  Take back, Restore as the person who pressed); start-up upgrades and imports record nothing.
- 2026-11-14 (today): "continue with the feature completion buildouts" — the go for this lane.
- Standing: last 50 per subject, and the limit never evicts the newest row a person wrote (plan §5.2 of
  `PLAN-entry-time-and-lines-2026-11-14.md`); members never see model plumbing; it is a session, never a chat.

## What exists (re-verify every line)

- `lore_redlines` (migration 0161): `entry_id` NOT NULL FK cascade, nullable `amendment_id`; `changes`
  `{ wireKey: { before, after } }`; `cause`; `user_id`, `session_id`, `message_id`, `run_id`, `shown_as`. One
  writer, `lorebooks/redlines.ts` (`recordRedline`, `recordEntryRedline`, `takeBackRedline`, `putBackRedline`,
  `clearRedlines`, `countRedlines`, `redlineSummary`, `clearAllRedlines`). Sockets `entries:redlines`,
  `entries:restoreRedline`, `entries:clearRedlines`, `entries:redlineCount`, `admin:redlineSummary`,
  `admin:clearRedlines` (`sockets/redlines.ts`). Client `lorebooks/editHistory/EditHistory.svelte`,
  `EditHistoryAdminRow.svelte`.
- `character_versions` holds card versions (`card_id`, `number`, `label`) and cast versions
  (`cast_member_id`); `src/lib/server/characters/versions.ts` is its only writer.
  - Cards: `updateCardVersion` (~542) is the in-place funnel; callers `sockets/characters.ts` ~716, ~1080,
    ~2844, `sockets/portrait.ts` ~231, `sockets/appletLibrary.ts` ~232, `utils/index.ts` ~132,
    `sockets/import.ts` ~1033, ~1173, `characters/cardFromMember.ts` ~284, `library/writes.ts` ~274.
    `newCardVersion` (~503) makes a new numbered version.
  - Cast: `updateCastVersion` (~2069) over `editCastVersion`; the member page's Save overwrites the shown
    version in place (`sockets/lorebooks.ts`, the cast update handler).
- Lane `time-t2` lands migration `0162` before this lane starts; this lane's is `0163`.

## Build

### A. First, an inventory (supervisor, read-only, before any worker starts) — report it with file:line

1. Every writer of a card version's profile fields and every writer of a cast version's profile fields: which
   are a person's save, a routine's write (with a run), Apply / Take back / Revert, an import, a start-up pass,
   a portrait or face change. Which already run inside a transaction.
2. What Back / swipe / regenerate do to a session-written cast version today (the per-turn record), so the edit
   history can follow the same row.
3. Where a card version or cast version row is deleted or replaced wholesale (delete card, delete version,
   absorb / merge a member, overwrite import, Share as a lorebook, the timeless copy).
4. Which profile keys exist (`CharacterProfileV1`) and which are large or not text (media ids, sprites): the
   history records text and typed profile fields; a face or media id change is recorded as a change of that key
   with no preview. Propose the list of recorded keys and of ignored keys.

### B. The record

- One **generated** migration (`0163`): `lore_redlines` gains a nullable `character_version_id` (FK to
  `character_versions.id`, on delete cascade) with an index; `entry_id` becomes nullable; a CHECK that exactly
  one of `entry_id` / `character_version_id` is set (`amendment_id` only with `entry_id`). No data pass; a
  second boot changes nothing (test). Generate with
  `SERENE_PUB_DATA_DIR=<scratch> npx drizzle-kit generate --config ./src/lib/server/db/drizzle.config.ts --name redline_versions`;
  the index must be 0163 and its journal `when` later than 0162's. If drizzle-kit wants to drop and re-create
  the table, stop and report.
- `redlines.ts` stays the one writer: a `recordVersionRedline` beside `recordEntryRedline`, the same compare
  (only keys the write named; a change of nothing records nothing), the same limit rule per subject, the same
  causes. No new cause unless the inventory shows one is needed (then stop and ask).
- Record at the funnels (`updateCardVersion`, `updateCastVersion` / `editCastVersion`), with the author passed in
  by the caller; a caller that passes none records nothing, and the report lists every caller and what it
  passes. Start-up passes and imports pass none. A write must be inside the caller's transaction where there is
  one (inside `db.transaction` only `tx`).
- A routine's write to a cast version in a session: recorded as `routine` with the run; Back / swipe /
  regenerate take the row back and Forward puts it back, as entries do (`takeBackRedline` / `putBackRedline`).
  A cast version that a retraction deletes takes its rows with it (the cascade).
- **Restore** goes through the person's own save path for that subject (so its checks run), recorded as
  `restore`. A key that no longer exists on the profile is refused with the entries lane's sentence.
- Never travels: card export, card duplicate, **Save as new version** (the new version starts with an empty
  history), member → card and card → member copies, lorebook duplicate, starter copies, the timeless copy, Share
  as a lorebook (cleared), overwrite import (cleared). Test each that exists.
- Sockets: extend the existing family rather than add a parallel one where the shapes fit
  (`entries:redlines` is entry-scoped; a version-scoped list, restore, clear and count are needed for cards,
  which are not in a lorebook). New event names follow NOMENCLATURE §24 and the sockets ruling: one domain
  context listens and toasts; scoped events carry their scope key; every new `:error` event joins
  `Layout.svelte`'s handled list with a test. List every new event in the report.
- Who may see and restore: a card's owner for its versions; for cast versions, whoever may edit that member
  today (as `findOwnedBook` decides for entries). Clear: the owner; Admin › Data's existing **Edit history** row
  counts and clears all three kinds together.

### C. Screens

- Reuse `EditHistory.svelte` (make it take a subject rather than fork it): the same fold, rows, who / cause /
  *Before* / *After* / **Restore**, the same clear confirmation.
- **Character editor:** a closed **Edit history** fold for the shown card version, near the version picker;
  *Edit history · 3 edits*. Switching version switches the list.
- **Cast member page (Member tab):** the same fold for the shown cast version, under the existing dated list,
  which is left exactly as it is.
- With **Show advanced controls** off the fold still shows (it is the undo for a person's own edits).
- Copy is 🚧 and reuses the entries lane's sentences; new sentences only where a card or member needs its own
  noun. Phone width: the fold and its rows wrap; no `crypto.randomUUID`, no `navigator.clipboard`.

### D. Docs and names

`docs/characters.md` (edit history per card version, what clears it, that it never travels), `docs/lorebooks.md`
(cast versions), `NOMENCLATURE.md` (the **Edit history** / `redline` rows widened to three subjects, with the
charter: what it owns, what it does not — dated versions are the timeline's; the per-turn undo is the
session's — and a §25 line per new name). No retired word. No other product's name in any file.

## Files owned

- `src/lib/server/db/schema.ts` (the `loreRedlines` table only), `drizzle/0163_*.sql`, `drizzle/meta/*`
- `src/lib/server/lorebooks/redlines.ts`, `src/lib/server/sockets/redlines.ts`, `src/lib/shared/sockets/types.ts`
- `src/lib/server/characters/versions.ts` (the two funnels and what they need), and each caller listed above
  only to pass an author
- `src/lib/server/lorebooks/tableRegistry.ts` only if the registry test requires a spec change
- `src/lib/client/lorebooks/editHistory/*`, the character editor's version area, the cast member page's Member
  tab, `src/lib/client/components/Layout.svelte` (the handled-errors list only), Admin › Data's edit-history row
- tests beside each; `docs/characters.md`, `docs/lorebooks.md`, `NOMENCLATURE.md`

## Out of scope (write down, never build)

Reshaping the dated list (*Amendments*) or the member Timeline tab (lane T4); the versions timeline; card
version numbering; an edit history for sessions, messages, stats or relationships; SDK names of any kind;
`src/lib/server/pipelines/**` beyond passing an author at an existing call (another session is editing
`pipelines/{boot,config,registrations,entities}`: do not touch those at all). No `sdk:build`.

## Stop and ask when

CLAUDE.md §Decisions applies; the migration is not a plain additive change; a new cause, a setting or a flag
seems needed; recording at a funnel would need a caller outside Files owned to change behaviour, not just pass
an author; an unruled ★ decides the shape.

## Done means

- Migration generated, index 0163; a second-boot test.
- Tests (targeted files only, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/edit-history-b-<name>.log 2>&1"`
  from the repo root, one run at a time; check for a running vitest first; never pipe vitest into `head`; 60 s
  timeout for an int test that opens a DB inside an `it`): record on a person's save for a card version and a
  cast version; nothing recorded for a no-change save, an import, a start-up pass; the limit rule; Restore;
  routine write + Back + Forward for a cast version; never travels (each path); clear (subject, admin); the
  existing entries tests still pass (`redlines*.test.ts`, `sockets/redlines*.int.test.ts`,
  `tableRegistry.test.ts`, the lorebook duplicate test); the fold in both screens (DOM).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` has 0 errors. Do not run the full suite.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-edit-history-b-2026-11-14.md`): the
inventory with file:line; changed files; tests with results; every name, event, sentence and label added; open
★; **Noticed, not done**. Under about 1,000 words.

## Corrections after the cold review (2026-11-14) — these rule over the text above

1. **The cast funnel is `updateInPlace`.** The member page's Save on a base version goes `writeCastVersion` →
   `authorWrite` → `updateInPlace` (`sockets/lorebooks.ts` ~1933–1942; `characters/versions.ts` ~1771–1780,
   `updateInPlace` ~1459), not through `updateCastVersion`. Record in `updateInPlace`, the one write that
   `authorWrite`, a coalesced story write (~1972–1982) and `editCastVersion` share, with the author passed in
   through `writeCastVersion` and `updateCastVersion`. Other in-place writers to place in the inventory and
   decide (record or pass no author): `writeCastVersionTagText` (~610–637), `followCardGreetingsAfterLift`
   (~2268), and editing a dated cast change from the *Amendments* list (`sockets/amendments.ts`
   `rewriteCastChange`, ~1453, ~1487): that last one is a person's save and is recorded;
   `src/lib/server/sockets/amendments.ts` is added to Files owned, to pass an author only.
2. **Retire-and-copy.** When a descendant session still reads the row, `editCastVersion` retires it and inserts a
   copy with a new id (~2172–2205). **Lead's decision (★EH-B1 for the owner): the history rows move to the
   copy** (the person is editing the same version as they see it), in the same transaction; the edit is then
   recorded on the copy. Test it.
3. **Back and Forward for a cast version.** Back deletes the turn's whole version (`state/write.ts` ~1056–1060
   → `retireOrTakeVersions`, `versions.ts` ~1559–1563) and the cascade removes its history, as ruled ("a
   session-written cast version taken back by Back / swipe takes its edit history with it"). Forward re-inserts
   the version under the same id (`restoreVersions` ~1580–1593) **with no history**: that is accepted for this
   lane (★EH-B2 for the owner: should Forward bring it back?). Do not use `takeBackRedline` / `putBackRedline`
   for versions and do not edit `state/write.ts`. Tests: Back removes the history; Forward brings the version
   back with none.
4. **The lorebook scope covers cast versions.** `RedlineScope { lorebookId }` (`redlines.ts` ~382–392) also
   matches `character_version_id IN (select id from character_versions where lorebook_id = X)`. That one change
   makes **Share as a lorebook** (`ownBook.ts` ~1263–1265, not edited), Book settings' **Clear edit history…**
   and `entries:redlineCount` cover cast versions. Test that Share clears a cast version's history and that the
   book-wide clear and count include it.
5. **The name.** Keep the table `lore_redlines` in 0163 (a rename makes `drizzle-kit generate` ask
   interactively). Rewrite the NOMENCLATURE `redline` row (~1763) and the schema comment (`schema.ts`
   ~10976–10977) for three subjects, each with its owner and who may clear it; mark the `lore_` prefix ⚠
   provisional (a card's rows are not lore) and fold the table's name into lane A's open ★1.
6. **Paths.** The inventory names, before any worker starts: the two component files (the character editor's
   version area; the cast member page's Member tab) and adds them to the report's changed-files list; and the
   scope key the card events carry (the card id), since a card has no `lorebookId`. `EditHistory.svelte` is
   wired to entries throughout (`entryId` / `lorebookId` props, `entries:*` events, interest keys by
   `lorebookId`, ~36–56, ~90–146): give it a subject and move its socket wiring behind that subject, keeping
   the entry behaviour and its tests unchanged.
7. Checked and fine, no change: the migration is plain `ALTER`s; the existing queries filter by `entry_id` and
   skip card rows; a purged lorebook's cast-version rows go by cascade; the only card-version delete is the
   card's cascade.
