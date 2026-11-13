# BRIEF — s4-follow-a worker w3 (2026-11-09): bench a card-less seat; the session's lorebook name on `sessions:get`

You are a `lane-worker` under supervisor lane `s4-follow-a`. Repo `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TS, Vitest 4, Drizzle + PGlite). Use absolute paths.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

## Context — what the previous worker built (read it first)

`src/lib/server/sessions/seats.ts` is **the one seat writer**. It now has 🚧 `SeatChange`, 🚧 `unseat(tx, { sessionId, kind, seatId, removedName })`, and 🚧 `announceSeatChanges(db, io, { sessionId, userId }, changes)`; every seat door in `src/lib/server/sockets/sessions.ts` collects the writers' `changes` and announces them once after commit. Read `seats.ts` ~l.1–60 (header) and ~l.1400–1570.

## Goal A — bench / unbench a card-less character seat (lead's addition, 2026-11-09)

`sessions:setCastSeatEnabled` (`sockets/sessions.ts`, search `sessionsSetCastSeatEnabled` / `"sessions:setCastSeatEnabled"`, ~l.11480–11600) takes only `characterId` today, so a card-less seat (`character_id` null, `cast_member_id` set) can't be benched. Lane s4-follow-b's `EditSessionForm.svelte` will send `castMemberId` for card-less seats.
1. Params take **exactly one** of `characterId` or `castMemberId` (update `Sockets.Sessions.SetCastSeatEnabled.Params` / `.Response` in `src/lib/shared/sockets/types.ts` — `castMemberId?: number` with one JSDoc sentence each; `characterId` becomes optional; the Response echoes whichever key was asked). Neither or both → refusal *"Name one seat: a character or a cast member."* (★ copy, the supervisor reports it).
2. Find the live seat: by card as today; by member = the live, non-envoy character seat with that `cast_member_id` and `character_id` null.
3. Permission: a **carded** seat keeps today's rule (session owner or the card's owner). A **card-less** seat has no card owner: the session owner, or the person who seated it (`seated_by_user_id`) — the same rule `sessions:update` uses when a card-less seat leaves (search `A seat leaves when the caller is the session's owner or seated it`). Refusal for a card-less seat: *"Only the session owner or the person who seated this cast member can change this."* (★ copy).
4. The write goes through the seat writer: add 🚧 `setSeatEnabled(tx, { sessionId, seatId, enabled })` to `seats.ts` (one JSDoc sentence; returns whether it changed anything; writes only `is_active` on that one character seat) and use it for both carded and card-less seats (by seat id, not by card id).
5. Event: unchanged in kind — exactly **one** `cast-changed { change: 'enabled', value }` with the seat's ref (`hostSeatRefOf`, member form `seated-member:<id>`), none when nothing changed. Do **not** emit `member-added`/`member-removed` for a bench (that would change when turn order and the genres' welcome pipelines hear it; the supervisor raises it to the owner).
- Tests in `src/lib/server/sockets/sessions.seatEvents.int.test.ts` (extend the existing harness): bench and unbench a card-less seat by `castMemberId` (row `is_active` flips; one `cast-changed` each with `seated-member:<id>`; repeat press → no event); a guest who neither owns the session nor seated the member is refused and nothing changes; a carded seat still benches by `characterId`.

## Goal B — ★bk-lock-2 (owner approved 2026-11-09): the session's lorebook name on `sessions:get`

The edit form's read-only Lorebook line (`src/lib/client/components/sessionForms/EditSessionForm.svelte` ~l.566–571 `savedLorebookName`, used ~l.2763–2781 with `BOOK_LOCK_LINES` from `src/lib/shared/lorebooks/sessionNotes.ts`) names the book from `lorebookNames[savedLorebookId]` — the asker's `lorebooks:list` — and falls back to "its lorebook" when the book isn't in that list (someone else's book), so the line reads *"This session reads its lorebook and keeps it…"*.
1. Server: the session payload `sessions:get` sends (find where it is built — `getSessionFromDB` in `sockets/sessions.ts`, and wherever `castNames` / `castFaces` are added to that payload) carries 🚧 **`lorebookName: string`** — the attached book's name (`sessions.lorebook_id` → `lorebooks.name`) when the session reads one, else `SESSION_NOTES_LABEL` (the own notes' label, `$lib/shared/lorebooks/sessionNotes`). One read; every reader of the session (owner and guests) gets it. Add it to the session payload type in `types.ts` (`Sockets.Sessions.Get.Response`'s session type, or the shared session payload type it uses) with one JSDoc sentence: "🚧 The name of the lorebook this session reads: its attached book's, else its own notes' label (★bk-lock-2)."
2. Client: in `EditSessionForm.svelte` change **only** the `savedLorebookName` derivation so the payload's `lorebookName` wins, then the list's name, then the existing fallback. Touch nothing else in that file — lane s4-follow-b owns the rest of it and is editing it now.
- Tests: an int test that `sessions:get` carries `lorebookName` = the attached book's name for the owner **and** for a guest who can't list that book, and `SESSION_NOTES_LABEL` for a session on its own notes (find the nearest existing `sessions:get` int test, e.g. `grep -l "sessions:get\|sessionsGet" src/lib/server/sockets/*.int.test.ts`, or add `src/lib/server/sockets/sessions.lorebookName.int.test.ts`). If an `EditSessionForm` DOM test exists that renders the Lorebook line (`grep -l "data-session-lorebook-line" src --include=*.test.*`), add one case that the line names the book from `lorebookName`; if none exists, say so and don't build one.

## Goal C — the retire path through `unseat`

`src/lib/server/sessions/seatName.ts` `writeSeatName`, the `retireSeatId` branch (~l.120–165), retires the old player seat with a direct `update(...).set({ removedAt })` and pushes a hand-made change. Replace that write with `unseat(t, { sessionId, kind: "player", seatId: old.id, removedName: null })` and push its result (behaviour identical: `removed_name` stays null). Run `src/lib/server/sessions/seatName.mint.int.test.ts` after.

## Rules you must follow

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Sockets: one domain context per event family … is the only listener, and the only place that toasts; views … never call `toaster`." "An event in `SCOPED_EVENTS` must carry its scope key … in the payload." (`sessions:setCastSeatEnabled` replies already carry `sessionId`; keep it.)
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- Memory rule (owner): **there is always a lorebook** — never write copy or code that frames a session as having no lorebook; say own notes / its lorebook.
- New names allowed: `setSeatEnabled`, `lorebookName`, `castMemberId` on the bench params — each 🚧 with one JSDoc sentence. No other new name, setting, flag, event or table; stop and report if you need one.
- Do what is asked at the size asked; findings go under **Noticed, not done**.
- Prettier: `npx prettier --check` changed files; **only `--write` the lines you changed** — never reformat a whole file (`sockets/sessions.ts`, `types.ts`, `EditSessionForm.svelte` are huge and shared). If a file fails only on lines you didn't touch, leave it.
- **Shared files:** another worker (w4) is editing `src/lib/shared/sockets/types.ts` (the `Characters` namespace) at the same time, and lane s4-follow-b is editing `EditSessionForm.svelte`. If an `Edit` fails because the file changed since you read it, re-read that range and retry; never rewrite a whole file with `Write`.

## Files owned (edit only these)

`src/lib/server/sessions/seats.ts` (`setSeatEnabled` only), `src/lib/server/sessions/seatName.ts` (Goal C only), `src/lib/server/sockets/sessions.ts` (`sessions:setCastSeatEnabled` and the session payload's `lorebookName` only), `src/lib/shared/sockets/types.ts` (`SetCastSeatEnabled` params/response and the session payload field only), `EditSessionForm.svelte` (the `savedLorebookName` derivation only), and tests: `src/lib/server/sockets/sessions.seatEvents.int.test.ts`, a `lorebookName` int test, an existing EditSessionForm DOM test if one fits.

## Tests (Done means)

Run, capped and logged (scratchpad `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub; npx vitest run <files> --maxWorkers=2 > <scratchpad>/s4-follow-a-w3-tests.log 2>&1; echo test-exit=$? >> <scratchpad>/s4-follow-a-w3-tests.log'`
Files: your new/changed tests + `src/lib/server/sessions/seats.int.test.ts src/lib/server/sessions/seatName.mint.int.test.ts src/lib/server/sockets/sessions.characterOwnershipToggleVisibility.int.test.ts` + any existing `setCastSeatEnabled` test (`grep -rl setCastSeatEnabled src --include=*.test.*`). Never pipe vitest into `head`. DB-in-`it` tests need a 60 s timeout.
Then `npx tsc --noEmit -p .` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`). Baseline: 3 errors from another lane in `src/lib/client/components/sessionPage/requests/index.ts` / `overhearSeat.ts` — not yours; report any others.

## Report

Final message: changed files, one line each; per goal what changed; the exact refusal sentences used; tests with pass/fail counts; tsc; Noticed, not done.
