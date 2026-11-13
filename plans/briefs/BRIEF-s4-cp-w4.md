# BRIEF s4-cp-w4 — Copy to my characters doors, and the member's voice on its page (client + docs) — 2026-11-08

Supervisor: lane `s4-cp`. Repo: `/home/jody/github/serene-pub`. Report back in your final message (the supervisor reads it); do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (One is up on :5199 — this task needs no `sdk:build`.)

## Goal

### 1. Copy to my characters — two doors

The server is done: `characters:duplicate` takes `{ castMemberId }` (typed in `src/lib/client/sockets/typedSocket.ts` "characters:duplicate"; reply `Sockets.Characters.Create.Response` = `{ character }`; refusal `characters:duplicate:error` with `castMemberId`, sentence "Cast member not found."). Who may: anyone who can read the member's book, or anyone in a session that seats the member. Owner 2026-11-05: "If a user wants a cast member as a card, they can export the cast member as a card to their account." No link back.

- **Member page** (Lorebooks view, cast member page): a **Copy to my characters** button (label ruled, exactly that; tonal surface — it is not the page's primary action, STYLE-GUIDE §6.1). ⚠ The member form sits inside `<fieldset disabled={readOnly}>` in `src/lib/client/lorebooks/CastWorkspace.svelte` (~:1774) — a reader of a shared book must still be able to copy, so the button must live **outside** that fieldset (e.g. the member page's header row in `CastWorkspace.svelte`, beside where the member's name/actions are drawn — find the natural spot, keep it one button). Shown for every viewer of the page.
- **Session member sheet** — `src/lib/client/components/sessionForms/SeatMemberSheet.svelte` (a seated member's read-only sheet for a viewer who can't open its book): the same button, using `res.member.castMemberId` from the `lorebooks:memberOfSeat` reply. Not shown while loading, on "nobody", or on a problem.
- **On success (★ supervisor's proposal, build it):** the copy opens in the Characters view, as the card door does — `panelsCtx.digest.characterId = id; panelsCtx.openPanel({ key: "characters", toggle: false })` (pattern: `openOwnCard` in `CastWorkspace.svelte:375`; get `panelsCtx` the way that file does). Only the copy THIS door asked for opens: follow `CharacterViewPanel.svelte:137–160` exactly (a `copyPending` flag, `declareInterest` on `characters:duplicate` and `characters:duplicate:error`, the error only re-arms the button). **Never toast from the view** — a refusal is said by Layout's catch-all (verify that `characters:duplicate:error` reaches it; if it doesn't, report it, don't add a toast).
- While pending the button is disabled and says the same words (no spinner text invented).

### 2. The member's voice on its page (★10, part)

Owner ruling ★10 (2026-11-08): "Member page gets the card editor's controls for post-history, creator notes, likeness, voice" — **reuse the card editor's field components** (P5: derive, don't hand-build a second editor). In this task: **voice only** (post-history, creator notes and likeness need server write paths this lane doesn't own — the supervisor is asking).

The wire already carries it: the member's `timbre` is a member column (`MemberColumnsOfVersion.timbre`, `server/lorebooks/retold.ts:174`), the member write accepts it (`FROZEN_MEMBER_KEYS` in `server/sockets/lorebooks.ts` ~:1282 includes `"timbre"`), and `memberProfileOf` (`server/characters/versions.ts:192`) makes it **own when set, else follows the card** ("the timbre is own when the member has one"). So:
- `src/lib/client/lorebooks/cast/memberDraft.ts`: the draft holds `timbre` (from `row.timbre`), `memberPatch`/`sameMemberDraft` include it (null = the card's voice / no voice). Keep the draft rules in that file's header (diff against `pristine`, clean draft follows the row).
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`: a **Voice** section reusing `src/lib/client/components/characterForms/VoiceTab.svelte` (props `characterName`, bindable `timbre: TimbreDraft`, optional `openVoices`; see `voiceTab.ts` for `TimbreDraft` and how the card form converts timbre ↔ draft — reuse those converters, don't write new ones). For a **carded** member: a **Use from card** switch (the same words and Switch the form already uses for the names, ~"Use from card") — on = `timbre` null (the card's voice reads through), off = the member's own voice edited with `VoiceTab`. For a **card-less** member: `VoiceTab` directly, no switch. Saved with the form's Save like every other field (it is a buffered form: STYLE-GUIDE §6.14 "Unsaved means different from what is saved, not touched").
- Look at how `CharacterForm.svelte` mounts `VoiceTab` and copy that wiring. If `VoiceTab` can't take a member without changing its props in a way that touches the card form's behaviour, stop and report (don't fork it).

### 3. Docs

- `docs/characters.md`: **Copy to my characters** from a cast member — where (a cast member's page; a seated member's sheet in a session), who (anyone who can read its lorebook, or anyone in a session seating it), what the copy holds (its words as the lorebook reads them now, face and likeness picture as your own files, its own sprite sets or else its card's, its gallery or else its card's when you can read that card, its stats with their current values as the card's starting values, the card's tags when you can read it), and that the copy is not linked back. Sentence case, one idea per sentence.
- `docs/lorebook-cast.md`: the member page's **Copy to my characters** button and the **Voice** section (Use from card / own voice).
- Read each doc's existing structure first; add to the right section, keep their voice. Never write that a session has no lorebook (a session always has one: its own notes, or an overlay of a lorebook).

## Files owned (edit only these)

- `src/lib/client/lorebooks/CastWorkspace.svelte` (only the member page region: the Copy button and its wiring)
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`, `src/lib/client/lorebooks/cast/memberDraft.ts` (+ `memberDraft.test.ts`)
- `src/lib/client/components/sessionForms/SeatMemberSheet.svelte`
- `src/lib/client/components/characterForms/VoiceTab.svelte` only if a prop is genuinely needed (say why)
- DOM tests next to these: extend `src/lib/client/lorebooks/cast/memberPage.dom.test.ts` / `castMemberForm.dom.test.ts` or add `memberCopy.dom.test.ts`; add `src/lib/client/components/sessionForms/seatMemberSheet.dom.test.ts` (or extend an existing one — find it)
- `docs/characters.md`, `docs/lorebook-cast.md`

## Files readable

Everything. Especially `CharacterViewPanel.svelte` (the card door), `CharacterForm.svelte` + `VoiceTab.svelte` + `voiceTab.ts`, `memberDraft.ts`, `retoldRows.ts`, the existing member page DOM tests (how they mount with a fake socket), `client/utils/notify.ts`, `client/sockets/interest.svelte.ts`.

## Out of scope

Server code (done or another worker's). Sprites on the member page (next worker). Post-history, creator notes, likeness controls. The Characters view row door (lane chr-view, wave 6). `typedSocket.ts` and `shared/sockets/types.ts` (worker w3 is editing them right now — if you need a type change, report it). NOMENCLATURE.md.

## Rules that apply (quoted)

- CLAUDE.md Sockets: "one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." Common brief: "views never call `toaster`/`notify` for socket results in new code."
- CLAUDE.md: "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." (Prefer `declareInterest`, which returns its own release.)
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- CLAUDE.md: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- Memory: "Untrack reads in effect-called store methods" — an `$effect` that calls a method which reads and writes the same state loops; untrack the read.
- STYLE-GUIDE §6.1: "One primary button per surface … Secondary actions are tonal." §10: "Sentence case everywhere … A button says what happens." "Help is one sentence."
- STYLE-GUIDE §6.14: dirty is derived from a saved snapshot; changing a value and changing it back is clean.
- It is a **session**, never a chat. "There is ALWAYS a lorebook" — never frame a session as having none.
- New user-visible words beyond **Copy to my characters**, **Voice**, **Use from card**: propose them in your report (with your recommendation), build the recommendation.

## Done means

DOM tests (vitest happy-dom `.dom.test.ts`, mounted like the existing member page tests):
- member page: the Copy button shows for an editor and for a read-only (shared) viewer, and is enabled in both; clicking emits `characters:duplicate { castMemberId }`; a `characters:duplicate` reply opens the copy in Characters (`panelsCtx.digest.characterId` set, `openPanel` called with `characters`); an error re-enables the button and opens nothing; a reply this door didn't ask for opens nothing.
- seat member sheet: the button shows once a sheet arrives, emits with the reply's `castMemberId`, not shown on "nobody"/problem.
- voice: a carded member shows **Use from card** on by default when `timbre` is null; switching it off shows `VoiceTab` and makes the form dirty only after a change; a card-less member shows `VoiceTab` with no switch; Save sends `timbre` in the patch; `memberDraft.test.ts` covers timbre in `memberPatch`/`sameMemberDraft`.

Run DOM tests in a capped scope (heavy DOM tests have OOM-killed VS Code — keep `--maxWorkers=2` and the 6G cap), logged (never pipe vitest into `head`):

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w4-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w4-tests.log'
```

Also run the existing member page / cast form DOM tests you didn't write (all `src/lib/client/lorebooks/cast/*.dom.test.ts`) and `VoiceTab.dom.test.svelte.ts`. Then `npm run check` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npm run check > …log 2>&1'` (baseline: 0 errors, 8 warnings — report errors/warnings in your files). **Prettier:** only `--write` the lines you changed — never reformat a whole Svelte file (it re-sorts classes other work owns); if a file fails only on lines you didn't touch, leave it and say so.

## Stop and ask (in your report, don't decide)

A reused component that can't take a member without a redesign; any new user-visible words beyond those named; a toast; a change to a file not listed.

## Report (final message)

Changed files; decisions (where the Copy button sits and why, how voice converts); proposed words; tests with pass/fail counts; check before/after; noticed-not-done.
