# BRIEF — lane `s4-seat-live`, worker w6 — the Add characters picker offers the book's card-less cast (★s4-seat-1) (2026-11-08)

Supervisor: lane `s4-seat-live` (seat-cast S4, wave 4 follow-up; **the flip is ON**). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file). Worker w5 runs beside you (seatName, permissions, `sessionPageProjections.ts`, one prop in the session page) — no shared files.

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05 ★27-10: "All sessions have a lorebook, [own book] or overlay. No exceptions so SDK data storage API is predictable. No swapping lorebooks." · Memory rule **"There is ALWAYS a lorebook"**: never write copy or code paths that frame a session as having no lorebook; say own book / overlay.
- Owner 2026-11-08 ★B-5: the book is **fixed at start** — chosen at create; the edit form shows a read-only line.
- Owner 2026-11-05: "Everything in session is cast → active card." Sessions seat **cast members**; a member may have **no character card** (card-less). The server already accepts card-less members: `sessions:create` and `sessions:update` take 🚧 `castMemberIds?: number[]` ("Card-less cast members of this session's lorebook to seat as characters; the server checks each lives in the session's books" — `src/lib/shared/sockets/types.ts` ~4996, ~6911). Read the two handlers in `src/lib/server/sockets/sessions.ts` (grep `castMemberIds`) for the exact semantics — create: seated after the cards, counted against the cast cap; update: **adds** via `seatCast`, and soft-removes (owner or seater) — find whether update's list is the desired full set or only additions, and build to it. `new-world` create mode **refuses** `castMemberIds` (don't offer the group there).
- **The ★ this worker builds (lane recommendation, flagged for the owner):** in the Add characters picker (`src/lib/client/components/modals/CharacterSelectModal.svelte`, multi mode, used by `StartSessionForm.svelte` and `EditSessionForm.svelte`) a **second group under the book's name** listing that book's **card-less members** (name + face), read from `lorebooks:bindingList` filtered to members with **no card** (and not overlay rows; read `CastMemberRow` in `types.ts` ~8534 for the fields — `characterId`, `overlayOf`, the shown name, the face), sent as `castMemberIds`.
- **Copy (★, supervisor's proposal — build exactly this):** the existing card rows get a `ListGroupLabel` **Character cards** — shown only when the book group is shown, so a book with no card-less members leaves the dialog exactly as it is; the second group's `ListGroupLabel` is **the book's name**, with one muted 12px line under it: _Cast members with no character card._ The footer's count counts both kinds (_Add 3 characters_). The search box filters both groups by what a row shows.
- STYLE-GUIDE (quoted): §6.6 "**A dialog that picks from a long list** … The chosen value sits **above** the list, never only inside it … Each card opens on one muted 12px sentence saying what its choice decides … Rows inside a fixed-height list are `shrink-0`." · §6.6 the prompt dialog lists choices "under their `ListGroupLabel`s" (find `ListGroupLabel.svelte` and use it). · §10: "Sentence case everywhere … Labels are nouns, hints are sentences … No filler … Help is one sentence." · Owner (memory, pickers): "say what the choice decides, state the reasons to choose … keep the chosen value visible above the list."
- Sockets (CLAUDE.md): one domain context per event family is the only listener and the only place that toasts; **views never call `toaster`/`notify` for socket results**; `socket.off(event)` always with the handler. The existing way a view reads `lorebooks:bindingList` is `declareInterest<"lorebooks:bindingList">(interestKey("lorebooks:bindingList", lorebookId), handler)` + `socket.emit("lorebooks:bindingList", { lorebookId })` (see `src/lib/client/lorebooks/DayOne.svelte` ~95–112, and `LorebooksWorkspace.svelte` ~2383) — use that, never a raw `socket.on`.
- Svelte 5: `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- ⚠ **Card ids and member ids share one id range** — keep picked cards and picked members in **separate** lists/ids (`characterIds` vs `castMemberIds`); never one mixed id list, never a `{#each}` key that could collide (key rows `card:<id>` / `member:<id>`).

## Goal

1. `CharacterSelectModal.svelte`: optional props for the book group — e.g. `castMembers?: { id: number; name: string; faceMediaId?: number | null }[]`, `castGroupLabel?: string` (the book's name), `excludeCastMemberIds?: number[]`, and `onMultiSelect` hands back both lists (widen to `(ids: number[], castMemberIds: number[]) => void`, keeping every existing caller compiling and behaving the same). With no `castMembers` (or an empty list) the dialog renders exactly as today. The picked order is kept per list. `selectedLimit` counts both. Rows reuse `CharacterPickRow` if it can show a member (name + face) without a card; else the smallest change that can (say what you did).
2. `StartSessionForm.svelte` (+ its flow module `StartSessionFlow`, find it): when the session will read an existing book (attach/overlay — not `new-world`; find how the form knows the chosen book), load its card-less members via `lorebooks:bindingList` and pass them; keep `castMemberIds` in the flow beside `characterIds`; show picked members in the chosen-cast list (name + face, the same remove control); count them for the cast cap / floor where the form counts characters; send `castMemberIds` on `sessions:create`. Changing the chosen book clears picked members that aren't in it.
3. `EditSessionForm.svelte`: the session's book is fixed — list its card-less members **not already seated** (read what the form's session object carries about seats with `castMemberId` and no card; `sessions:get` carries 🚧 `cardlessSeatShown` member id → `{ name, nickname, faceMediaId }` for seated ones — show those in the chosen-cast list too, with the remove control the server honours); send `castMemberIds` on `sessions:update` per the handler's semantics.
4. A face: render it the way `CharacterPickRow`/avatars already render a media id (find the helper); no new image route.

## Files owned (edit only these)

`src/lib/client/components/modals/CharacterSelectModal.svelte`, `src/lib/client/components/sessionForms/StartSessionForm.svelte`, `src/lib/client/components/sessionForms/EditSessionForm.svelte`, the Start flow module (find it; name it), `src/lib/client/components/sessionForms/CharacterPickRow.svelte` only if item 1 needs it, and DOM tests next to them: new `CharacterSelectModal.castMembers.dom.test.ts` (or additions to an existing one — grep), additions to the forms' existing tests if any cover the picker.

## Files readable

Everything. Key: `src/lib/shared/sockets/types.ts` (`Sockets.Lorebooks.BindingList`, `CastMemberRow`, `Sockets.Sessions.Create/Update/Get`); `src/lib/server/sockets/sessions.ts` create/update handlers (grep `castMemberIds`) and the `lorebooks:bindingList` handler (`sockets/lorebooks.ts`) for what a row carries; `src/lib/client/sockets/typedSocket.ts` (the interest helpers); `STYLE-GUIDE.md` §6.4 (list rows, ~886–1206) and §6.6 (~1254–1320) — read those sections only; `ListGroupLabel.svelte`; an existing DOM test of a modal for the harness.

## Out of scope (never built here)

Server code (the handlers already accept `castMemberIds` — if they need a change, stop and report it). `new-world` mode. Copy beyond the three strings above (any other sentence you find you need: propose it as ★ in the report, build nothing). Docs. NOMENCLATURE.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a string beyond the three above is needed; the server's semantics don't fit the form (e.g. update can't remove a card-less seat); a change outside your files; a new socket event or listener would be needed.

## Hard rules (CLAUDE.md)

- Toasts only through the domain context (`notify`, never the raw toaster) — and views don't toast socket results at all.
- `socket.off(event)` always with the handler. `SvelteSet`/`SvelteMap`, never `$state(new Set())`.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- It is a **session**, never a chat. Never frame a session as having no lorebook.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build; dev servers are running — don't build.)
- Prettier: `npx prettier --check` changed files; only `--write` lines you changed — never reformat a whole file (the forms are 3,000+ lines: hand-format your hunks; a whole-file `--write` re-sorts classes other work owns).
- DOM tests: run them in the capped scope; never let a failing `assert` on a happy-dom element loop (it has OOM-killed VS Code) — keep each DOM test small.
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

Capped, logged:

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-live-w6-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-live-w6-tests.log"
```

Must pass, each its own `it` (DOM):
- with no `castMembers` the dialog renders no group labels and behaves as before (existing tests green);
- with card-less members: two groups, **Character cards** and the book's name with _Cast members with no character card._; ticking a card and a member and pressing **Add 2 characters** hands back `[cardId]` and `[memberId]` separately; a card and a member with the same numeric id tick independently;
- search filters both groups; `selectedLimit` counts both;
- excluded (already seated) members are not offered.
Plus a test (DOM or unit on the flow module) that the start form sends `castMemberIds` on create and the edit form on update.
Re-run existing tests of the files you touched (grep `CharacterSelectModal`, `StartSessionForm`, `EditSessionForm`, `startSessionFlow`), ≤10 files per batch. `npx tsc --noEmit -p .` and `npm run check` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, one after the other, logs `$SP/s4-seat-live-w6-tsc.log` / `-check.log`) — no new errors or warnings.

## Report (final message)

Changed files with hunks named; decisions (named: data path, how the book is known in Start, update semantics found); tests + counts + log paths; tsc/check; stopped-and-asked; any ★ copy you needed but didn't build; Noticed, not done.
