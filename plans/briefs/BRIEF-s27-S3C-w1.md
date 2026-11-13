# BRIEF s27-S3C-w1 — gates accept `seated-member:` and store the card form (seat-cast S3, server)

Worker for lane **s27-S3C** (supervisor: lane-supervisor, Opus). App `/home/jody/github/serene-pub`. You are worker **w1**. Worker **w2** runs beside you in the same lane; it owns other hunks of `host.ts` and `sockets/sessions.ts` (listed under *Not yours*). Other lanes run in other files: never edit `src/lib/client/**`, `src/routes/**`, `../serene-pub-sdk/**`, `../mundi-sp/**`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You don't need an `sdk:build`: the SDK already ships the grammar. Don't run one.)

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
The SDK grammar now accepts 🚧 `seated-member:<castMemberId>` (`isParticipantRef`, `parseParticipantRef` → `{ kind: 'seated-member', id: string }`, `canonicalParticipantRef`). Every server gate that takes a participant ref must accept it **and translate it at the door** through `storedSeatRef` (`src/lib/server/state/seatRefs.ts`) **before it stores or compares anything**, so nothing stored changes form in S3: audiences, `metadata.speaker`, form-block addressees and turn order all stay card-form (`character:<cardId>`, `player-seat:<seatId>`, `envoy:<slug>`).

The door (already built, read it first):
- `storedSeatRef(db, sessionId, ref)` → a `seated-member:<id>` ref becomes `character:<cardId>` (a seat holding a card, incl. a carded player seat) or `player-seat:<seatId>` (a card-less player seat); any other ref comes back **unchanged**; **null** when that member sits in no seat of this session.
- `storedSeatOwner(db, sessionId, owner)` does the same for `{ kind: "seated_member", id }` owners.
- Pure code with a `session_cast` read in hand (no db): `cardFormRefInCast` in `src/lib/server/pipelines/prompt/seatCards.ts` mirrors `seatOf`'s order over the cast rows.

Where a gate gets null back (a member who is not seated here), treat it exactly as the gate treats an unknown card today (refuse, halt, skip — whatever that gate does), never store the raw `seated-member:` string.

## Items (line numbers are approximate; grep, then re-read the hunk right before each edit)
1. **`src/lib/server/pipelines/runtime/host.ts`, your hunks only:**
   - ~879 the `isParticipantRef`/`parseParticipantRef` → `NO_SUCH_CHARACTER` helper.
   - ~2037–2145 `writeAnnexDocument`: the `canonical(audienceOf[key])` audiences it stores → each ref through `storedSeatRef` first (a ref the door nulls is dropped from the stored audience; say so in a comment). Check whether `sessionId` there is a session id (it is the first param).
   - ~2577–2590 `parseParticipantRef(speaker)` → translate first.
   - ~3439–3456 the AI-view `speaker` before `aiHolds` (the SDK's `aiHolds` compares canonical strings, so a member ref would never match a stored `character:` audience).
   - ~3999–4010 (S2 already translates here — check, leave as is if right).
   - ~7195–7215 `namedRef` (stored as `metadata.speaker`) → translate; check what the code below does with a `character:` namedRef and make sure the translated ref takes the same path.
   - ~7570–7640 the two `parseParticipantRef(speakerRef)` sites.
   - ~8150 (S2 translates — check).
   - ~8525–8545 `retire` and ~8605–8625 configure-stat: S2 already translates; **★S3-1 (built as recommended, flagged)**: the halt sentence at ~8622 must name the new form: `name a seat (player-seat:<id>, seated-member:<id>, character:<id>) or world` — and the retire refusal sentence, if it lists forms, likewise. Mark the copy change in your report as ★S3-1.
   - ~8700–8740 and ~8800–8870: the declared `see` audiences passed to the annex/lorebook-annex writes (`dataAudienceFindings` now accepts member refs) → through the door before storing.
   - ~9890–9905 the form `addressee` → translate before it is used or compared.
2. **`src/lib/server/sockets/sessions.ts`, fireTurn hunk only (~9785–10270):** `storedSeatRef` at ~9792 (S2) — check; `sameEntry` (~10045) and `isParticipantRef(seated.ref)` (~10232): an entry given as `seated-member:` is translated before `sameEntry` compares and before it is stored in the turn order. Never reformat this file, never run prettier `--write` on it.
3. **`src/lib/server/sockets/pipelines.ts` `portrayalLinesOf` (~2811–2950):** the `parsed.kind === "character"` branch (~2840) and the `switch` (~2925): a `seated-member` branch (translate through the door, or name the member through its seat). Old receipts keep `character:` keys — they must still read.
4. **Every `parsed.kind === "character"` / `case "character"` site on a participant ref** in these files must translate first or handle `seated-member`:
   `pipelines/runtime/portrayals.ts` (~155, ~282; the lead already added a `case "seated-member"` → NONE after the loop translates — check it is right), `pipelines/runtime/fireAction.ts` (~676, ~1295), `pipelines/runtime/runTurn.ts` (~1646), `pipelines/runtime/tools/coreTools.ts` (~330), `pipelines/prompt/adventureContext.ts` (~229), `pipelines/ranking/keyProposal.ts` (~592), `speech/resolveVoice.ts` (~154), `sockets/jump.ts` (~689), `auth/actingPerson.ts` (~118). Grep these files for `parseParticipantRef`, `isParticipantRef`, `"character:"` and `/^character:` too. Where the function is pure (no db), translate at its caller or use `cardFormRefInCast` over a cast in hand — never parse a card id out of a member ref, never `Number(...)` a member id as a card id.
5. **Stored-audience writes through the door** (so S3 stores no mixed audiences): `src/lib/server/sessions/creationModes.ts` ~260–313, `src/lib/server/sessions/annexChanges.ts` ~217, `src/lib/server/lorebooks/annex.ts` ~241–246. Read each; where an audience (a list of participant refs) is stored, each ref goes through `storedSeatRef` (needs a session id — in a lorebook-annex write with no session, say so in the report and leave it; don't invent one).
6. **Scene Portraits, server side:** confirm by grep that no server code reads `chosenImages` or answers `set-chosen-image` (the request door is the client's, lane W). Report what you found; build nothing if there is nothing.

## Not yours (w2's hunks — never edit)
`host.ts` `session_cast` case (~4200–4240 and ~4707–5200) and anything building `sessionCharacters[]`/`sessionPersonas[]`; `sockets/sessions.ts` `sessions:channelLanes` (~4100–4170) and message payloads; `state/resolve.ts`, `state/write.ts`, `sockets/state.ts`, `sprites/choices.ts`, `sessions/settings.ts`, `pipelines/runtime/speakerRotation.ts`, `pipelines/runtime/bindings.ts`, `pipelines/runtime/dispatch.ts`, `pipelines/prompt/contentProcessors.ts`, `NOMENCLATURE.md`. If a fix needs one of these, write it under "Queued" in your report.

## Files owned
The hunks above in `host.ts` and `sockets/sessions.ts`; whole files: `sockets/pipelines.ts` (portrayalLinesOf hunk and the `case "character"` at ~2925 only — other lanes have uncommitted work there), `pipelines/runtime/portrayals.ts`, `fireAction.ts`, `runTurn.ts`, `tools/coreTools.ts`, `pipelines/prompt/adventureContext.ts`, `pipelines/ranking/keyProposal.ts`, `speech/resolveVoice.ts`, `sockets/jump.ts`, `auth/actingPerson.ts`, `sessions/creationModes.ts`, `sessions/annexChanges.ts`, `lorebooks/annex.ts` (the hunks named), and their test files (new test files beside them are fine). Every file is dirty with other lanes' uncommitted work: edit by hunk, never reformat, never `prettier --write`.

## Rules (quoted from CLAUDE.md and the S3 common brief)
- **Look up, never parse.** "A consumer that needs the `state.cast.byId` entry for a ref finds the entry whose `ref` (or `castMemberId`) matches; it never parses a card id out of a ref or a key, and never does `Number(key)`."
- **No stored key changes, no migration, no removal.** Core keeps emitting card-form refs and keys until S4. Nothing stored changes form in S3.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." Call `storedSeatRef` **before** a transaction opens, or pass it `tx` inside one.
- No static `$lib/server/db` import in modules tests mock (pass `db`); `host.ts` already dynamic-imports in places — follow the file's pattern.
- **Every session has a lorebook** — never write "no book", "no lorebook", "bookless" in code, comments, tests or copy.
- New exported names: none expected. If you need one, stop and ask in your report (a new name is a ★).
- Copy a user or plugin author sees is a ★ unless ruled: only ★S3-1 (the halt sentences name `seated-member:<id>`) is pre-approved here.
- Mark every new comment about the new form 🚧 and say "seat-cast S3".
- Targeted tests only; **never pipe vitest into `head`** (the SIGPIPE leaks PGlite temp dirs); int tests that open a DB inside an `it` need a 60 s timeout. Before your first run, `ls -d /tmp/serene-pub-vitest-* 2>/dev/null > <scratchpad>/s27-S3C-w1-tmp-before.txt`; after your runs, delete only new dirs your runs made, by name. Scratch files start with `s27-S3C-w1-`.

## Tests (both shapes)
For each gate: a test that a `seated-member:<memberId>` ref stores/compares as the card form (`character:<cardId>`, or `player-seat:<seatId>` for a card-less player seat), and that today's card-form ref behaves exactly as before (existing tests stay green unchanged — a test you must edit is a finding; say why). At minimum: the AI-view speaker, `namedRef`/`metadata.speaker`, the form addressee, the configure-stat halt sentence, an annex audience write, fireTurn with a `seated-member:` entry, `portrayalLinesOf`, and one test per `parsed.kind` file you change (use the file's existing test style; find existing tests with `ls src/lib/server/<dir>/*<name>*test*`). Look at how existing S2 tests build a seat with a `cast_member_id` (`grep -rln "seated-member" src/lib/server --include=*.test.ts`) and reuse their fixtures.

Run with `npx vitest run <files>` (the app root), never the whole suite. Then `npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` must show nothing (the old `arrangeCanvas.dom` error is known).

## Done means
Every item built or reported as nothing-to-do with evidence; your targeted tests green; tsc clean on your files.

## Report
Write your report as your final message (no report file): changed files with the hunk line ranges, each gate → how it translates, tests run with pass counts, existing tests you had to change (with why), anything left card-parsing and why, ★ (S3-1 and any new), Queued for w2/others, Noticed-not-done.
