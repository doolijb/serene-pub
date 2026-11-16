# BRIEF — `time-t4b` worker 1 — server: name the version a member save writes; say who wrote each cast version

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4b`. The rules section at the end of this file is part of this brief.

## Goal

The cast member page is getting the version rail the entry form has (lane `time-t4a`). For it the wire needs three small additive things. No new event, no migration, no change to `src/lib/server/characters/versions.ts`.

## Files owned (edit only these)

- `src/lib/shared/sockets/types.ts` — only `Sockets.Lorebooks.CastRowVersion`, `Sockets.Lorebooks.UpdateBinding.Params`, `Sockets.Amendments.CastRow`
- `src/lib/server/sockets/lorebooks.ts` — only `castMemberRowsOf` (~1542) and the `lorebooks:updateBinding` handler (~2577–2993)
- `src/lib/server/sockets/amendments.ts` — only `buildAmendmentsList` (~310–433) and imports
- `src/lib/client/lorebooks/castPool.ts` — only to add `baseVersionId?: number | null` to `CastRow` beside `castVersionId`
- tests: extend `src/lib/server/sockets/lorebooks.castVersions.int.test.ts` and `src/lib/server/sockets/amendments.castVersions.int.test.ts` (or a new `src/lib/server/sockets/castVersionRail.int.test.ts` if those are awkward)

## Build

1. **The base version's id on every cast row.** `CastRowVersion` gains `baseVersionId: number | null` (🚧 doc comment: "The member's base version (undated, main, no life point): what *From the beginning* saves. Null when the member has none."). `castMemberRowsOf` sets it from `base?.id ?? null` in both return branches. Any other place that builds a `CastMemberRow` literal and fails `tsc` gets `baseVersionId: null` or the real id, whichever it can know; list them.

2. **A member save can name the version it writes.** `UpdateBinding.Params` gains `castVersionId?: number` (🚧 doc: "The cast version this save writes. Only the member's base version is accepted (a dated version is saved with `amendments:update`). Absent: the version in force at the book's present on main, as before."). In the handler, before the transaction writes anything:
   - when `params.castVersionId !== undefined`: read the member's base (`baseVersionsOf(db, [existingBinding.id])`); if the id is not that base's id, refuse with `throw new Error("That version can't be saved here: only this cast member's first version is saved from the member page.")` 🚧;
   - inside the transaction, pass `onto: params.castVersionId !== undefined ? "base" : "shown"` to `writeMemberEdit` (the base path already exists and is used by other callers at ~2498, ~2537, ~4676). Everything else in the handler (the later-versions loop, the relist, the reply) stays as is; with the base written, `isBaseVersion(written)` makes every dated main version "later", which is right.
   - Session-written versions are never a base, so no separate session refusal is needed; say so in a one-line comment.

3. **Who wrote each cast version, and in what order.** `Sockets.Amendments.CastRow` gains (🚧 doc comments):
   - `writeOrder: number` — the version's write order (`character_versions.write_order`): what orders two versions at one date and life point.
   - `sourceSessionId: number | null` — the session that wrote it; null = a person's.
   - `sourceSessionName: string | null` — that session's name, only when the asker may open it (`checkSessionAccess(id, userId).hasAccess`, `$lib/server/utils/sessionAccess`, the rule `sockets/redlines.ts` ~121–137 uses: a blank name reads as null; a deleted session or one the asker may not open is null).
   `buildAmendmentsList` fills them: one `checkSessionAccess` per distinct session id in the book's cast versions, one query for the names (`schema.sessions`, columns id and name). Keep the function's query count bounded (it says "a bounded number of queries for the whole book").

4. **Tests** (int tests, 60 s timeouts where a DB opens inside an `it`):
   - a member with a base and a dated main version at or before the book's present: `updateBinding` with `castVersionId = row.baseVersionId` changes the base version's columns and leaves the dated version as it was; without `castVersionId` it still writes the version in force at the present (today's behaviour, one assertion);
   - `castVersionId` naming the dated version, or another member's base, is refused with the sentence above and writes nothing;
   - `bindingList` / the update reply carries `baseVersionId` equal to the base's id;
   - `amendments:list`'s cast rows carry `writeOrder`, `sourceSessionId` (null for a person's version) and, for a version with a source session the asker owns, `sourceSessionName` equal to the session's name; for a session the asker may not open, null. Use the existing helpers in those test files to seed sessions and versions; if seeding a session-written version is heavy, write the row directly with `insertCharacterVersions` or the helper the file already uses, and say so.
   Run your test files plus `src/lib/server/sockets/lorebooks.castVersions.int.test.ts`, `amendments.castVersions.int.test.ts` and `amendments.oneVersion.int.test.ts` whole; then `tsc`.

## Out of scope

`characters/versions.ts`; the client pages (another worker); the entry path of `amendments.ts`; any other handler.

## Stop and report when

the base path (`onto: "base"`) would behave differently from what item 2 says (for example, it re-parents or drops a key the shown path keeps); a test needs a server change beyond these three items; `tsc` errors appear in files you do not own because of the new required field (list them; do not edit them unless they are `CastMemberRow` literals the type change broke, which you may fix with the one field).

---

# Rules every `time-t4b` worker works under (quoted by the supervisor; read with your own brief)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Owner rulings (verbatim)

- 2026-11-13: "Also make a pass on cast history and make sure it behaves similar so it's familiar across the entire lorebook."
- 2026-11-13 (the vertical time view): "Also provide a vertical time view like i suggested for other entries."
- 2026-11-13 (versions): "show the option to change the effective date of that version. Save edits that version, but also need a button to save as a new dated version … navigate the dated versions like a vertical timeline, adding new versions before or after."
- 2026-11-14: the chosen screen (the rail beside the fields, a strip when narrow) and "Yes, move the moment bar".
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled": with the Timeline off, no rail, no dates; one plain form with its edit-history fold.
- 2026-11-14: **Save writes the selected version** ("The selected version"). The page still OPENS on the version in force at the lorebook's present; after a version is picked on the rail, Save writes that one.
- 2026-11-14: **several versions at one date: "Each as its own node."**
- Standing: cast members get no Beginning and no Decay; members never see or touch model plumbing; it is a **session**, never a chat.

## Hard rules (each has cost data or hours)

- `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`.
- `socket.off(event)` with no handler removes every listener app-wide: always `socket.off(event, handler)`.
- Views never call `toaster`/`notify` for socket replies they did not ask for; the page's own awaited write may say how it went through `notify` as it does today. Refusals are toasted by the shell.
- An event in `SCOPED_EVENTS` must carry its scope key (`lorebookId`, …) in the payload.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- No migration, no new socket event, no new setting. Stop and report instead.
- Comments state the rule, not the story (no "lane X added", no "was …").
- Never `prettier --write` a whole file; format only the lines you changed (check with `npx prettier --check <file>` and leave unrelated hunks alone).
- Edit only the files your brief owns. Anything else you need goes in your report.
- Every new name, label, sentence or prop goes in your report's list (the supervisor records them in NOMENCLATURE §25); mark new copy 🚧 in a comment where the sentence is defined.

## STYLE-GUIDE rules (quoted)

- §5.3 / §6.19: the rail is one component, two layouts from its own box (`@container/versions`, two columns at `@min-[36rem]/versions:`, never the viewport). Wide: a vertical list of buttons beside the fields, the selected one `aria-current`, quiet **+ Add a version here** buttons between them named for where they add (*Add a version between Year 7 and Year 9*), each version's edit rows under it behind an **Edits** toggle (`preset-pressed`, `aria-pressed`). Narrow: a row of chips above the fields (`preset-pressed` when selected). The fields render once in both.
- §6.1: one primary button per surface (`preset-filled-primary-500`); a destructive action is never the primary; removing something saved is `preset-tonal-error`.
- §6.14: unsaved means different from what is saved; "Ask first, then discard — never the other way round": a selection change that would close an edit awaits `loreRoute.confirmLeave()` and only on Leave drops the draft. On a railed form a move of the moment bar that would show another version asks once and, on Stay, puts the moment back.
- §9: every interactive element is a real `button` with an accessible name; never an interactive inside an interactive; `aria-current` on the selected row; nothing hover-only; 44px targets on touch (`min-h-11`, `pointer-coarse:min-h-11`).
- §10: sentence case; a button says what happens; help is one sentence; one name per thing.

## Tests

Run only your targeted files, from the repo root, one at a time, each as:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t4b-<name>.log 2>&1"`

Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait while one runs (another session runs tests in this checkout). Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors in your files).

Another Claude session is editing `src/lib/client/components/Layout.svelte`, `components/pipelines/**`, `components/modals/{CharacterCreatorModal,CharacterSelectModal}.svelte`, `src/routes/+page.svelte`, `src/lib/shared/utils/docsPages.ts`: never touch them; errors there are not yours.

## Report

Your final message: changed files; what you built against each numbered item of your brief; tests run with pass/fail counts and log paths; every name, label and sentence added; anything you could not do or decided (with the reason); Noticed, not done.
