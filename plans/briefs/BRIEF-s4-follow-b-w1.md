# BRIEF — s4-follow-b-w1 (2026-11-09): Show secrets on an AI character seat

Supervisor: lane s4-follow-b. You are a lane-worker. Report back in your final message (the harness refuses report files): changed files, tests run and results, open questions, Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*

**`sdk:build` is blocked for this whole task** (the owner's `vite dev` runs on :5173). Do NOT run it. Edit the SDK sources; the app's tsc will show errors for the new request type until the lead builds — list them exactly.

## Goal (owner-approved ★s4-fixes-1b)

The person who seated an AI character seat (`session_characters.seated_by_user_id`, owner ruling ★S2b-1 2026-11-05 "Still theo": the person who seated a cast member keeps acting for that seat) gets a **Show secrets** switch on that seat's sheet in the Stats widget. Off by default, **not remembered across visits**. While on, the server sends that seat's **holder-only** values (earshot `'holder'`) to that person only. The AI still writes the turns; nobody else's view changes. P1 (CLAUDE.md): "every automatic action shows its cause" — the switch says what it shows.

## Design (decided by the supervisor — build exactly this)

New provisional names (all 🚧; NOMENCLATURE rows are queued by the supervisor, do not edit NOMENCLATURE.md). The internal word is **overhear** (plugin settings already own `secret`, so no internal name uses "secret"; the UI label is "Show secrets").

1. **`src/lib/server/state/earshot.ts`** — add a pure exported helper `overheard(hearing: Hearing, links: Pick<SessionLinks,"cast"|"seatedMembers">, memberIds: ReadonlySet<number>): Hearing`. Returns `hearing` unchanged when `hearing.all` or `memberIds` empty; else a new hearing adding, for each member id `m`: every `links.cast` entry with `seatMemberId === m` and no `playerSeatId` → keys `castLinkKey(c)` and `String(c.characterId)` (the same keys `hearingInMemberForm` uses), and every `links.seatedMembers` entry with `seatMemberId === m` → `seated_member:${m}`. JSDoc one sentence: a seater overhearing their own AI seat on request; read-only. Do NOT change `hearingOf` or `resolvePortrayals` (`runtime/portrayals.ts`): portrayal stays the AI.
2. **`src/lib/server/sockets/state.ts`**:
   - A helper `seatsSeatedBy(sessionId, userId): Promise<Set<number>>` — cast member ids of live character seats (`session_characters`: `sessionId`, `removedAt IS NULL`, `envoySlug IS NULL`, `castMemberId IS NOT NULL`, `seatedByUserId = userId`).
   - Per-socket state: `socket.data.overhear: Map<number /*sessionId*/, Set<number /*memberId*/>>` (create lazily). It lives as long as the connection — a reload is a new visit.
   - `state:get` params gain 🚧 `overhear?: string[]` — seat refs `seated-member:<memberId>`. When the param is **present** (even `[]`), replace this socket's set for the session with the refs that parse to a member id the caller seated (`seatsSeatedBy`), dropping the rest silently (the owner row's flag tells the truth). Absent = leave the set as it is. Parse refs with the existing seat-ref parser (`parseSeatRef` / whatever `sockets/state.ts` already imports) — never hand-split strings if a parser exists.
   - A read-side hearing: `callerView(socket, sessionId, links)` = `overheard(await callerHearing(...), links, <this socket's set ∩ seatsSeatedBy>)`. Re-validate against `seatsSeatedBy` at read time (a seat may have been unseated). Use it **only for reads that hand state to a person**: `state:get` (the `state` and `describeState`'s state view), `settled()`'s reply state, `state:ledger`. **Keep `callerHearing` (unchanged) for every write gate and for proposals** (`state:proposals` listing, `state:decide`'s `proposalHeard`, `handEditJudge`'s hearing, `carriesOnWire`). Overhearing never grants a write.
   - Owner rows (`describeState`): on a `seated_member` owner row (both the carded-seat rows from `links.cast` in member form and the card-less `links.seatedMembers` rows) whose member id is in `seatsSeatedBy(viewer)` **and** the viewer is not the session owner (the owner already hears everything), add 🚧 `overhearing: boolean` — `true` while this socket overhears it, `false` when it may. Absent on every other row. Add the field to `BuiltOwnerRow` and to the wire type in `src/lib/shared/sockets/types.ts` (only your fields: the `state:get` param and the owner row field — lane s4-follow-a also edits that file, so touch nothing else).
   - Do NOT add `mine` for a character seat; `mine` stays as today.
3. **SDK** `../serene-pub-sdk/sdk/src/widgets.ts`:
   - `SessionStateOwnerV1` gains `overhearing?: boolean` with a JSDoc in the style of `mine?`: "🚧 Present only on an AI character seat the viewer seated: `true` while the viewer reads that seat's holder-only values (`overhear-seat`), `false` while they may. Absent everywhere else, and from a host that predates it. @experimental".
   - `WidgetRequests` gains `'overhear-seat': { params: { owner: OwnerRefV1; on: boolean }; result: void }` with a JSDoc like `set-owner-face`'s ("🚧 Core's Stats: … The host re-reads the session's state; the values arrive on the next `session_state` push. Refused for an owner the viewer did not seat."). Add it to the grant map as `'core'` (core's only, like `'set-owner-face'`) and to the reach map as `'session'`. Find every other table keyed by request name in that file (grep `'set-owner-face'`) and add a row to each. Check `../serene-pub-sdk/INTEGRATING.md` and the SDK guides for a list of widget requests; if one exists, add `overhear-seat` there in the same style (modder rule: INTEGRATING and the guide examples move in the same change).
4. **core-catalog** `../serene-pub-sdk/core-catalog/components/shared/stats/StatsWidget.svelte`: a snippet `overhearBlock(owner)` rendered in `sheetBlocks` (after `carriesBlock`), drawn only when `typeof owner.overhearing === "boolean"`. Mirror the `carriesBlock` markup exactly (a `<label>` wrapping `<input type="checkbox" role="switch">`, parts only, no classes — STYLE-GUIDE §6.16: "A session widget's markup carries **no look**: no spacing, type, colour, radius or `preset-*` classes. Its elements carry **widget parts**", `data-widget-part="<owner>.<part>"`, kebab-case, singular). Parts: `stats.overhear`, `stats.overhear-switch`, `stats.overhear-help`, `stats.overhear-error`. Copy (★ proposal, build it, all through `t()`):
   - label: `Show secrets`
   - help line under it: `Shows what only {name} knows, on your screen only. The AI still plays {name}.`
   - On change: `await widget?.current.request("overhear-seat", { owner: { kind: owner.kind, id: owner.id }, on })`; a refusal goes in the block's error line via `plainRefusal`, exactly like `setCarry`.
   Add a one-paragraph 🚧 note in the widget's header comment.
   If the default widget stylesheet `src/lib/client/styles/widgets.css` styles `stats.carry-switch`, give `stats.overhear-switch` the same rule (selector list), nothing new.
5. **Client** (app):
   - `src/lib/client/state/sessionState.svelte.ts`: a module `SvelteSet<string>` of overheard seat refs (CLAUDE.md: "`$state(new Set())` is not reactive on mutation — use `SvelteSet`"); cleared whenever `openSessionState` points the store at a different session; `refresh()` sends `{ sessionId, overhear: [...set] }` on `state:get`. Export `setOverhearing(ref: string, on: boolean)` that updates the set and calls `refresh()`.
   - New `src/lib/client/components/sessionPage/requests/overhearSeat.ts`, modelled on `setOwnerFace.ts` (validate params; reject in words; owner kind must be `seated_member`; ref = `seated-member:<id>`), and register `"overhear-seat"` in `requests/index.ts` beside `"set-owner-face"`. Check the owner row projection (`components/sessionPage/projections/sessionState.ts`) carries `overhearing` through to `session_state.v1` the way it carries `mine`; add it if it filters fields.

## Files owned (only these)

`src/lib/server/state/earshot.ts`, `src/lib/server/sockets/state.ts`, `src/lib/shared/sockets/types.ts` (your two fields only), `src/lib/client/state/sessionState.svelte.ts`, `src/lib/client/components/sessionPage/requests/{index.ts,overhearSeat.ts}`, `src/lib/client/components/sessionPage/projections/sessionState.ts` (only if needed), `src/lib/client/styles/widgets.css` (one selector only, if needed), `../serene-pub-sdk/sdk/src/widgets.ts`, `../serene-pub-sdk/core-catalog/components/shared/stats/StatsWidget.svelte`, `../serene-pub-sdk/INTEGRATING.md` / SDK guide (one row, only if a request list exists), and new tests beside them.

## Files readable

Anything. Start with `earshot.ts` lines 260–460, `sockets/state.ts` (`callerHearing` ~324, `settled` ~343, `ownSeatsOf` ~514, `describeState` ~606, `stateGet` ~1261, ledger ~1395, proposals/decide ~1620–1690, `carriesOnWire` ~1910), `state/resolve.ts` `CastMemberLink`/`SeatedMemberLink`, `state/keys.ts` `castLinkKey`, existing test `src/lib/server/sockets/state.earshot.int.test.ts` (model your int test on it).

## Hard rules (CLAUDE.md, quoted)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."
- "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, …) in the payload, or `emitToUser` silently sends nothing." (`state:get` replies already carry `sessionId`; keep it.)
- "It is a **session**, never a *chat*."
- Never edit `runtime/portrayals.ts`, `registrations/unserved.ts`, `runProgress.svelte.ts`, `sprites/fillAction.ts`, `imageGen/**`.
- Prettier: run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file. If a file fails only on lines you didn't touch, leave it and say so.

## Stop and ask (in your report, don't decide) when

A new name beyond `overheard`, `overhear`, `overhearing`, `overhear-seat`, `seatsSeatedBy`, `callerView` is needed; a write path would start honouring the overhear set; you find `seated_by_user_id` null on live rows in a way that matters; the design above doesn't fit the code.

## Tests (done means)

Run only these, in a capped scope, logged (never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-b-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-b-w1-tests.log'`
An int test that opens a DB inside an `it` needs a 60 s timeout.

1. New `src/lib/server/state/earshot.overheard.test.ts` (unit): unchanged when all / empty; adds the carded seat's two keys and the card-less seat's key; never adds a player seat.
2. New `src/lib/server/sockets/state.overhear.int.test.ts`: a session with owner O, guest G (seated an AI character seat — test both a carded and a card-less one — whose member carries a holder-only slot value) and guest H.
   - off (no param / `overhear: []`) → G's `state:get` lacks the holder-only value; G's owner row has `overhearing: false`; H's row has no `overhearing`.
   - on (`overhear: ["seated-member:<m>"]`) → G sees it, `overhearing: true`; a following write's reply (`settled`) to G still carries it; `state:get` with `overhear: []` turns it off again.
   - H asking `overhear` for G's seat → H never sees it, no flag.
   - O's view unchanged (hears all; no flag).
   - G's `state:set` on that holder-only value is still refused exactly as before.
3. New `src/lib/client/components/sessionPage/requests/overhearSeat.test.ts`: rejects a non-`seated_member` owner and a non-boolean `on`; calls the store with `seated-member:<id>`.
4. Re-run existing: `src/lib/server/state/earshot.test.ts`, `src/lib/server/sockets/state.earshot.int.test.ts`, `src/lib/server/sockets/state.int.test.ts`, `src/lib/server/state/cardlessSeat.readers.int.test.ts`, `src/lib/client/state/sessionState.test.ts`.
Do not run SDK tests (they need the build). Report `npx tsc --noEmit -p .` errors that mention your files, under a 12G scope: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npx tsc --noEmit -p . > <scratchpad>/s4-follow-b-w1-tsc.log 2>&1'` — and say which ones are only waiting on `sdk:build`.

## Report

Final message: changed files; tests + results; tsc errors (and which wait on the build); copy used; open questions; Noticed, not done.
