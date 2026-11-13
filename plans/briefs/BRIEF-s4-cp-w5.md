# BRIEF s4-cp-w5 — the member's own sprite sets on its page: Sprites tab with an owner (client + docs) — 2026-11-08

Supervisor: lane `s4-cp`. Repo: `/home/jody/github/serene-pub`. Report back in your final message (the supervisor reads it); do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (One is up on :5199 — this task needs no `sdk:build`.)

## Goal

Owner ruling ★7 (2026-11-08): "Member sprite-set editor + portrait/sprite-fill actions taking an owner (card or member) in S4." Owner 2026-11-05: members carry sprites, "own over card". Lane brief: "the member sprite-set editor on the member page (reuse the card's Sprites tab component with an owner prop — don't fork it)."

The server is done (worker w3): the sprite family takes `{ castMemberId }` instead of `{ characterId }` on `characters:listSprites`, `:createSpriteSet`, `:updateSpriteSet`, `:deleteSpriteSet`, `:uploadSprite`, `:addStandardSprites`, `:updateSprite`, `:deleteSprite`, `:reorderSprites`, `:testSprite` (types in `src/lib/shared/sockets/types.ts` `Sockets.Characters.*`, both ids optional, exactly one at runtime; replies and errors carry `castMemberId` for the member form). Read: whoever can read the member's book, or is in a session seating it. Write: whoever can edit the member's book. **The generation events (`:previewSpriteFill`, `:fillSprites`, `:expressSprite`) stay card-only** — the supervisor is asking the lead; for a member owner, don't show their controls.

1. **`src/lib/client/components/sprites/SpritesTab.svelte` gets an owner prop**: replace `characterId: number` with `owner: { characterId: number } | { castMemberId: number }` (one prop; keep `characterName`, `isOwner`). Every emit sends the owner's key; every listener matches the owner's key. Update its one caller, `src/lib/client/components/characterForms/CharacterViewPanel.svelte` (only that mount line). For a member owner: hide **Fill empty sprites**, re-express and any other generation control (no words saying why — just absent); everything else (sets, upload, standard set, relabel, move, reorder, delete, test) works.
   - **Interest scope (read this):** these replies are in `SCOPED_EVENTS` scoped on `payload.characterId` (`src/lib/shared/sockets/interest.ts:194–231`). A member-form reply has no `characterId`, so its scope is null and **only a socket that declared the bare event key receives it**. `interest.ts` is not this lane's file. So: for a card owner keep `interestKey(event, characterId)` exactly as today; for a member owner declare the **bare** key (`interestKey(event)` / the event name) and ignore any reply whose `castMemberId` isn't this member's (a card reply has no `castMemberId`, so it is ignored too). Comment it in one line pointing at `★cp-scope-1` (the supervisor's open question to the lead).
   - `:error` events are never gated; keep the existing filtering, by the owner's key.
2. **A Sprites tab on the member page** — `src/lib/client/lorebooks/CastWorkspace.svelte` `memberTabs` (~:775: Member, Lore, Relationships, Timeline): add **Sprites** (the card form's tab name; icon as the card form's Sprites tab uses) with a panel mounting `SpritesTab` with `owner={{ castMemberId: selectedMember.id }}`, `characterName` = the member's shown name, `isOwner` = the viewer can edit the book (the page's `!readOnly` gate, as `canUpdateCard` is passed). Its own tab because the sprite editor writes at once, and the Member tab is a buffered form with Save (STYLE-GUIDE §6.14: "A Save form holds every edit, or says which ones it doesn't").
   - What the tab shows: the member's **own** sets. A member with none (it draws from its card's sets) gets the tab's existing empty state, from which the editor can add a set — find out what `SpritesTab` shows with no sets and say in the report whether it reads right for a member (don't invent new copy; propose words if needed).
3. **The member form's sprite set picker** — `src/lib/client/lorebooks/cast/CastMemberForm.svelte` ~:316–380 and ~:1233: today it lists the **card's** sets (`characters:listSprites { characterId: cardId }`) and shows only for a linked member. With own sets the member draws from its own ("A cast member's own sets are its art when any holds an image; a card's are read only otherwise", NOMENCLATURE §18 queued row): list the member's own sets when it has any holding an image, else the card's; show the picker for a card-less member that has own sets too. Use the same bare-key rule for the member form of the reply. Keep the long ⚠ comment's reasoning about empty lists intact.
4. **Docs** — `docs/lorebook-cast.md`: the member page's **Sprites** tab (a member's own sprite sets; its own over its card's; who can change them), and the sprite set picker reading the member's own sets. Don't document sprite drawing or portraits for members (not built). Never write that a session has no lorebook.

## Files owned (edit only these)

- `src/lib/client/components/sprites/SpritesTab.svelte`
- `src/lib/client/components/characterForms/CharacterViewPanel.svelte` (only the `SpritesTab` mount)
- `src/lib/client/lorebooks/CastWorkspace.svelte` (only `memberTabs` and the new tab panel)
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte` (only the sprite set picker's list and condition)
- DOM tests: a new `src/lib/client/components/sprites/spritesTab.memberOwner.dom.test.ts` (or extend an existing SpritesTab DOM test — find it), and extend a member page DOM test in `src/lib/client/lorebooks/cast/` for the tab and the picker
- `docs/lorebook-cast.md`

## Files readable

Everything. Especially `SpritesTab.svelte` in full, `ChangeSpriteDialog.svelte`, `CastMemberForm.svelte`, the member page DOM tests (`memberPage.dom.test.ts`, `memberCopy.dom.test.ts` — the newest, written today, shows the current mounting pattern), `src/lib/server/sockets/sprites.ts` (to see exact reply shapes for the member form), `client/sockets/interest.svelte.ts`.

## Out of scope

Server files, `typedSocket.ts`, `shared/sockets/types.ts`, `interest.ts` (report any type gap). Generation for members. A member gallery tab (not asked). Post-history, creator notes, likeness controls. NOMENCLATURE.md.

## Rules that apply (quoted)

- CLAUDE.md Sockets: "one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." Common brief: "views never call `toaster`/`notify` for socket results in new code." `SpritesTab` already has `notify` calls; don't add new ones; leave existing ones as they are.
- CLAUDE.md: "An event in `SCOPED_EVENTS` must carry its scope key … in the payload, or `emitToUser` silently sends nothing." — hence the bare key for the member owner (above).
- CLAUDE.md: "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." Prefer `declareInterest` (it returns its own release).
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- Memory: "Untrack reads in effect-called store methods."
- CLAUDE.md: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- STYLE-GUIDE §6.5 Tabs (read it before adding the tab); §10 "Sentence case everywhere"; "Labels are nouns".
- New user-visible words beyond **Sprites**: propose them with a recommendation in your report and build the recommendation.

## Done means

DOM tests (capped scope; heavy DOM tests have OOM-killed VS Code):
- `SpritesTab` with a **card** owner behaves as before (existing SpritesTab tests green; find them).
- `SpritesTab` with a **member** owner: asks `characters:listSprites { castMemberId }`, declares the bare key, draws a reply carrying this `castMemberId`, ignores a reply for another member and a card reply; a write (create set) emits `{ castMemberId, … }`; no Fill/re-express controls; `isOwner` false hides the write controls.
- member page: the **Sprites** tab exists and mounts `SpritesTab` with the member owner; the sprite set picker lists the member's own sets when it has any with an image (reply via the member form), else the card's.

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w5-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w5-tests.log'
```

Also run all `src/lib/client/lorebooks/cast/*.dom.test.ts`, every existing SpritesTab / CharacterViewPanel DOM test (grep), never piping vitest into `head`. Then `npm run check` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npm run check > …log 2>&1'` (baseline 0 errors, 8 warnings). **Prettier:** only `--write` the lines you changed — never reformat a whole Svelte file; if a file fails only on lines you didn't touch, leave it and say so.

## Stop and ask (in your report, don't decide)

`SpritesTab` can't take an owner without a redesign; a type gap in `types.ts`/`typedSocket.ts`; new words; a toast; a file not listed.

## Report (final message)

Changed files; decisions; proposed words; tests with pass/fail counts; check before/after; noticed-not-done.
