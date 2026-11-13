# BRIEF — lane `s4-rul-a` (2026-11-10) — hidden stats, card stats from sessions, card sprites through the cast member

Supervisor: read `.claude/guides/multi-agent.md`, then `plans/briefs/BRIEF-s4-common.md` (its note about a dev server on :5199 is stale: today the **owner's** `vite dev` runs on :5173, so **no `sdk:build`**; date your report 2026-11-10), then this file, then the last two bullets of `plans/PLAN-sdk-creation-seams-2026-10-30.md` ("Owner marks on the follow-up ledger", "Lanes s4-rul"). Then `plans/REPORT-s4-follow-b-2026-11-09.md` — it describes what you are changing (Show secrets / overhear, the cascade audit, ★s4-fb-1..4).

## Owner's words (quote them; never reinterpret)

- ★s4-fb-1, approved: refuse card stats at the session sheet with "Card stats are edited in the card editor." and update the test.
- ★s4-fb-3, vetoed, then answered **"Seater may also edit"**: *"While Show secrets is on, the person who seated the AI character can also change and configure its hidden stats and answer its hidden proposals."*
- overhear, vetoed: *"Think of a more appropriate name, or better organize the secrets terms within a context"*; answered **Hidden stats wording**: UI **"Show hidden stats"**, help *"Stats only ‹name› knows, on your screen only. The AI still plays ‹name›."*; SDK request **`show-hidden-stats`**, flag **`SessionStateOwnerV1.showingHiddenStats`**; an **Earshot** group in NOMENCLATURE that separates holder-only stats from cast lore. fb-c1 note: *"Only problem is secrets or what only the character knows would also refer to cast lore."*
- ★s4-fb-4, approved with note: *"Permissions cascade through the cast member if the lorebook is shared, or user is a guest."* The recommendation it approved: let the media check admit a card's sprite files to anyone who can read a cast member linked to that card; only the sprite images open up.

## Goals

1. **Card stats from a session (fb-1).** `sockets/state.ts` refuses `owner_kind='card'` on `state:set` / `state:configure` with "Card stats are edited in the card editor." Update `state.ownerScope.int.test.ts` (~249) to pin the refusal. If any session UI still offers a card-owned stat control, remove that offer (name it in the report).
2. **The seater edits hidden stats while showing them (fb-3).** With the view on for a seat they seated (`seated_by_user_id`), the caller may `state:set`, `state:configure` and `state:decide` that seat's holder-only values, and sees its holder-only pending proposals. With it off, today's rules hold. Nobody else gains anything. The hearing rule (NOMENCLATURE `earshot` row: "A person changes such a value only where they hear it", plan A28 2026-09-30) still holds: **showing becomes hearing**. Challenger's fix, accepted: hand edits are judged by `sheetLatitudeAllows`, the one pure judge (NOMENCLATURE ~3280), which gets `heard` from a hearing computed without the socket (`state/handEdits.ts` ~182–190, ~609–622). Pass the connection's shown seats into `handEditRefusal` through `known.hearing`, and into `state:decide`'s hearing. Keep the latitude, lock and `changedBy` checks; no second decider. Update the comments that say it is never a write: `callerView` (`sockets/state.ts` ~381) and the NOMENCLATURE seat row (~418, queue it). Tests: seater with view on can set / configure / decide; with it off is refused; a third user is refused either way; the session owner is unchanged.
3. **Rename overhear → hidden stats.** Every code name, socket param, per-connection field, SDK request, SDK flag, widget part, CSS class, test file name, doc and guide line that says `overhear` moves to the hidden-stats wording above. Pick server/client names rooted in "hidden stats" per NOMENCLATURE §1 and §24 (e.g. `state:get` param `showHiddenStats?: string[]`, widget parts `stats.hidden-stats*`); name each in the report. The SDK names were never published (no build since), so no migration note is needed, but INTEGRATING and the guides move in the same change; regenerate `../serene-pub-sdk/guides/widgets.md` with `cd ../serene-pub-sdk && npx tsx scripts/gen-widget-parts.ts`. UI label and help: the owner's words above. Check that "hidden" is qualified everywhere (R3: **hidden stats**, never bare *hidden*). The owner ruled this wording; don't change it. But "hidden" already means other things (challenger): the Stats copy setting "The game's own state → _Hidden_" (NOMENCLATURE ~1712, toolState off in the layout), the retired per-seat _Hidden_ (§23 ~1530), message **Hide** / _Hidden from the story_, and hidden plugin carrier cards (★S4-1). The queued Earshot row carries ⚠ lines against each. Queue the NOMENCLATURE rows: rename the `overhear` entries, and a short **Earshot** group (earshot · holder-only · hearing · hidden stats view) with a line saying cast lore (S5) is not in it. The lead merges them.
4. **Card files the member draws, through the cast member (fb-4).** The owner wrote "Permissions cascade through the cast member", so the media check (`media/access.ts` ~33–38, ~79–83 / `canViewMedia`) admits a card file **the member actually draws** — its sprite files, a followed face (avatar), a followed likeness image — to a user who can read a cast member linked to that card **through a lorebook shared with them, or as a guest of a session that seats that member**. One branch. The guest half may already be covered through seated members and `sessionsDrawingCard` (`utils/sessionAccess.ts` ~89–111); reuse it, don't duplicate it. `canViewCharacter` itself does not change, and **card gallery pictures stay out**. Tests: a shared-book reader and a session guest load the sprite, followed face and followed likeness files; a stranger is refused; a card gallery picture is still refused for both; a member that owns its own face doesn't open the card's.

## Files owned

- `src/lib/server/sockets/state.ts`, `src/lib/server/state/earshot.ts`, `src/lib/server/state/handEdits.ts`, `src/lib/server/state/write.ts` (only if goal 2 needs it)
- `src/lib/server/media/access.ts` (and `media/index.ts` only if the check lives there); `utils/sessionAccess.ts` is readable, not owned
- every file that says `overhear` today: `src/lib/client/state/sessionState.svelte.ts`, `src/lib/client/styles/widgets.css`, `src/lib/client/components/sessionPage/projections/sessionState.ts`, `src/lib/client/components/sessionPage/requests/{index.ts,overhearSeat.ts,overhearSeat.test.ts}` (rename), `src/lib/server/sockets/state.overhear.int.test.ts`, `src/lib/server/state/earshot.overheard.test.ts` (rename)
- the stats widget in `../serene-pub-sdk/core-catalog/src/…` that draws the switch, `../serene-pub-sdk/sdk/src/widgets.ts` (the request and flag only), `../serene-pub-sdk/INTEGRATING.md`, `../serene-pub-sdk/guides/widgets.md` (regenerated)
- `src/lib/shared/sockets/types.ts`: **the `State.*` namespaces only** (~17238, ~17374; lane s4-rul-c owns the `Lorebooks.List` row; exact-string edits only, no prettier `--write` on it)
- the session sheet UI file for goal 1, if one offers card stats
- `docs/stats-and-states.md`, `docs/sessions.md` (the Show secrets lines)
- tests next to these, and `state.ownerScope.int.test.ts`

Not yours: `sockets/sessions.ts`, `sessions/seats.ts`, `StartSessionForm.svelte`, `CastMemberForm.svelte` (other lanes). serene-pub-43 owns image generation: stay clear of `dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`, `sprites/fillAction.ts`, `characters/portrait.ts`, `registrations/unserved.ts`, `runProgress.svelte.ts`. `src/lib/generated/**` is generated; don't hand-edit it.

## Out of scope

- ★s4-fb-2: the owner wants card editing as its own SDK API and permission later. Build nothing for it.
- Secrets as a keyed aspect, and the "cast lore" rename: S5.

## Stop and ask when

The common brief's Decisions apply; a new name beyond the hidden-stats family; a migration or stored-data change; anything that widens access beyond goal 4.

## Done means

- Tests for each goal, plus the existing `state.*`, `earshot.*`, media access and request tests green (capped scope, per the common brief).
- `npx tsc --noEmit -p .` and `npm run check`: no new errors beyond those waiting on the SDK build; list exactly which wait.
- SDK tests can't be trusted before the build; run only the widget-parts test (`cd ../serene-pub-sdk && npx vitest run <its file>` from inside its package, not the SDK root) and say what waits.
- Run a `scope-reviewer` on your diff before reporting; answer each finding once.
- Report: return it in your final message; the lead saves it as `plans/REPORT-s4-rul-a-2026-11-10.md`.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
