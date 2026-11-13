# BRIEF — s4-fold worker 2 — generalise the `seat-keys` rekey steps (★bk-fold-2) — 2026-11-08

Supervisor: lane `s4-fold` (brief `plans/briefs/BRIEF-s4-fold.md`). You are a lane-worker; you cannot spawn agents.

## Goal

Owner ruling ★bk-fold-2 (2026-11-08): **"generalise the `seat-keys` pass (translator-driven rekey steps + one exported 🚧 `rekeySessionRefs`; gate tests identical)."**

Today `src/lib/server/sessions/seatKeys.ts` (1,413 lines) walks 15 stores (`SEAT_KEY_STORES`) of one session and moves **card form** to **member form** only: owner columns with `owner_kind = 'session_cast'`, ref strings matching exactly `character:<digits>` (`CARD_REF` / `isCardRef`, ~461), SQL pre-filters on `CARD_AT` / `REWIND_CARD_FORM` / `coreCardSql`, the translation through `pickTargets` / `designate` / `rekeyRefs` / `rekeyKeys` / `rekeyOwnerRow` / `rekeyProposalPayload` / `planUnique` (all reading a `SeatMap`).

The fold (next worker) must move **member-form** refs of one session from one cast member to another (M → M′, and a notes member N → M′): owner rows `{ kind: "seated_member", id: M }` → `{ kind: "seated_member", id: M′ }`, ref strings `seated-member:M` → `seated-member:M′`, in exactly the same 15 stores. One traversal, two translators (P2 — "Two writers of one thing is a bug"; a second traversal is the rejected alternative).

Build:

1. **A translator shape** (exported type, 🚧, one JSDoc sentence per field). Suggested — adjust if the code needs it, and say why in your report:
   ```ts
   /** 🚧 What a rekey moves and where: the boot pass's card-form translator, or a fold's member move. */
   export interface SeatRefTranslator {
   	/** Owner kinds whose rows it may move (`session_cast` for card form). */
   	ownerKinds: readonly string[]
   	/** POSIX regex text (no anchors) matching a ref it may move inside JSON text, for the SQL pre-filters (card form: `"character:[0-9]`). */
   	refSql: string
   	/** The owner(s) an owner row becomes: null = not moved by this translator; [] = should move but no target (counted in `left`). */
   	owner(o: { kind: string; id: number }, pick: SeatPick): { kind: string; id: number }[] | null
   	/** The ref(s) a ref string becomes: null = not moved; [] = left. */
   	ref(ref: string, pick: SeatPick): string[] | null
   }
   ```
   `SeatPick` (`"every" | "one" | "player" | "character"`) is already defined; export it if the type needs it. Keep the **survivor rule** of `planUnique` (merged pair: the survivor seat's card's row wins, else the newest) for the card-form translator exactly as today — if it needs the `SeatMap`, give the translator an optional hook (e.g. `survivor?(target) → source id | null`); a member-move translator may leave it out (newest wins).
2. **The card-form translator** built from a `SeatMap` (private, e.g. `cardFormTranslator(map)`): exactly today's behaviour — `ownerKinds: ["session_cast"]`, only exact `character:\d+` moved, `pickTargets` semantics, `memberFormOf` / `memberFormTargetsOf` from `state/seatRefs.ts`.
3. **Every step and pure rewrite takes the translator instead of the map** (internally). The "already in member form wins" rule in `rekeyKeys` (`plain`) becomes "a key the translator does not move wins". The SQL pre-filters (`owner_kind = 'session_cast'`, `CARD_AT`, `REWIND_CARD_FORM`, `coreCardSql`, the `message_speakers` / `message_blocks` / `zone_towards` filters) take the translator's `ownerKinds` / `refSql`. The bulk owner-column step groups by `(owner_kind, owner_id)` over `ownerKinds`. Raw-SQL JSON writes stay raw (no `updated_at` move).
4. **Export 🚧 `rekeySessionRefs(tx: Db, sessionId: number, translate: SeatRefTranslator): Promise<…tally…>`** — runs every step of `STEPS` for one session with that translator, inside the caller's transaction (it never opens one; use only `tx`). Return the per-store tally (the existing `Tally` shape exported, or a `SeatKeysReport`-like object without `sessions`/`failed` — your choice, say which). One JSDoc paragraph: what it moves, that it runs inside the caller's transaction, that the boot pass is one caller and the fold another.
5. **The boot pass** (`seatKeys(db)`) keeps its fast path (`CANDIDATE_BRANCHES` stay card form — the boot pass only ever moves card form), and `rekeySession` becomes `rekeySessionRefs(tx, id, cardFormTranslator(await loadSeatMap(tx, id)))`. **`loadSeatMap` must still be imported from `$lib/server/state/seatRefs`** — `seatKeys.gate.int.test.ts` mocks that module to make one session fail.
6. **Keep these exports byte-compatible** (tests and `sessions/annexChanges.ts:27` import them with a `SeatMap`): `seatKeys`, `SEAT_KEY_STORES`, `SeatKeyStore`, `SeatKeysReport`, `rekeyCoreDocument(doc, map)`, `rekeyAnnexAudiences(audiences, map)`, `rekeyDeltaSide(side, owner, map)` — keep them as thin wrappers over the translator forms with their current signatures and results.
7. **A member-move translator for the fold** — build it as a **pure exported helper in `seatKeys.ts`** so the fold doesn't parse ref strings itself (modder rule: "plugins never parse ref strings (typed, host-filled fields and helpers do it)" — the same discipline in core): 🚧 `memberMoveTranslator(moves: ReadonlyMap<number, number>): SeatRefTranslator` — `ownerKinds: ["seated_member"]`, refs `seated-member:<id>` exactly (`refSql` `"seated-member:[0-9]`), moves a member id in `moves` to its target (one target for any pick), returns null for every other owner/ref (player seats, card form, other members untouched). Check whether member form also appears as an **underscore key** in JSON (`seated_member:<id>` — e.g. the presence key literal `seated_member:<id>` noted by s4-fixes, or `cast.byId` keys) inside these 15 stores; if it does, the member-move translator moves that spelling too — list what you found.

## Tests (Done means)

- **Every existing `seatKeys.*` test file unchanged and green:** `src/lib/server/sessions/seatKeys.int.test.ts`, `seatKeys.json.int.test.ts`, `seatKeys.gate.int.test.ts`, `seatKeys.attic.int.test.ts`, plus `src/lib/server/sessions/annexChanges*.test.ts` if any exist. **Do not edit those files.** The gate's second-run dump of every touched table must stay identical.
- **New** `src/lib/server/sessions/seatKeys.memberMove.int.test.ts`: one session with member-form rows in each of the 15 stores naming members M and N (and an unrelated member K, a player seat, and a stray card-form row); `rekeySessionRefs(tx, s, memberMoveTranslator(new Map([[M, M2], [N, M2]])))` inside a transaction moves every M/N item to M2 and leaves K, the player seat and the card-form row byte-identical; a unique-key collision (owner_sheets / attribute_carries rows for both M and N on one key) keeps the newest; a second call changes nothing (tally all zeros); another session's rows untouched. Also a pure test of `memberMoveTranslator` (null for unrelated refs, `seated-member:12` → `seated-member:99`, `seated-member:123` not matched by an id `12` move).
- tsc: no new errors (run only after your edits; see commands).

## Files owned

`src/lib/server/sessions/seatKeys.ts`, new `src/lib/server/sessions/seatKeys.memberMove.int.test.ts`. Nothing else.

## Files readable

`src/lib/server/state/seatRefs.ts` (`SeatMap`, `loadSeatMap`, `memberFormOf`, `memberFormTargetsOf`), the four `seatKeys.*` tests (fixtures to copy), `src/lib/server/sessions/annexChanges.ts`, `src/lib/server/db/schema.ts`, `plans/REPORT-s4-f-pass-2026-11-08.md` (what the pass does and why).

## Out of scope

Anything the fold does (reseating, speaker stamps, `session_characters`, the book copy); changing what the boot pass moves; the fast path's coverage; the startup entry; NOMENCLATURE (queue rows in your report instead).

## Rules you must follow (quoted)

- CLAUDE.md Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." `rekeySessionRefs` takes `tx` and never touches `$lib/server/db`. seatKeys.ts header: "⚠ Must not statically import `$lib/server/db`; the handle is the first argument."
- NOMENCLATURE R1 "One word, one meaning", R3 "Qualify, never abbreviate to the bare noun", R6 mark provisional vocabulary 🚧. New exported names get 🚧 in their JSDoc. Use only the names in this brief (`SeatRefTranslator`, `rekeySessionRefs`, `memberMoveTranslator`); a different exported name → say so in the report, don't invent more.
- A refusal or error says what to do instead (modder rule).
- Comment style: plain sentences; no "previously/used to/was changed" history comments (the repo has a comment-history ratchet test).

## Commands

- Tests, capped and logged (never pipe vitest into `head`):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w2-tests.log'`
- tsc: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; cd /home/jody/github/serene-pub && npx tsc --noEmit -p . > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w2-tsc.log 2>&1; echo exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w2-tsc.log'` — another worker edits other files at the same time; report errors in your files only.
- Int tests that open a DB inside an `it` need a 60 s timeout.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Prettier: `npx prettier --check` on changed files, but only `--write` lines you changed — never reformat a whole file you didn't otherwise edit. seatKeys.ts is yours to rewrite, so formatting it whole is fine.

## Report

Return in your final message (don't write a report file): changed files; the exported signatures as built (verbatim); tests run with counts; tsc result for your files; any deviation from this brief and why; underscore-spelling findings (item 7); **Noticed, not done**; NOMENCLATURE rows to queue (🚧 `SeatRefTranslator`, `rekeySessionRefs`, `memberMoveTranslator`, one line each).
