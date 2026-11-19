# BRIEF — lane `gs-3a`, worker 2 (client): the owner's two guest seat switches, a frozen guest's absent controls, the guest's cast to take

Repo `/home/jody/github/serene-pub` (app). No SDK change. Supervisor: lane `gs-3a`. Worker 1 builds the server
in parallel (other files). Owner rulings G3, G4 (2026-11-16), quoted: *"On by default; off freezes guests' seats
as they are"* · *"Guests can bring their own if enabled. Guests can grab the sessions/lorebooks cast members if
also enabled. So two settings, both on by default."* · *"Keep: any guest may take a card-less cast member's
seat"* · *"Guests can't choose directly from the owners card list"*.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane needs no `sdk:build` at all: don't run one.)

Also: never `git checkout / restore`; never `prettier --write`; no `npm run build`; no full test run.

## The contract (already written; read, do not rename)

- `src/lib/shared/sessions/guestSeats.ts`: `storedGuestSeatSwitches(session.metadata)` → `{ bringOwn, takeCast }`
  (a missing key is on), `GUEST_SEAT_SENTENCES.bringOwnOff` / `.takeCastOff` (the guest's line: the same words
  the server refuses with).
- `Sockets.Sessions.Update.Params.guestsBringOwn?: boolean` / `guestsTakeCast?: boolean` (owner only; absent
  leaves it alone). After a save that changed one, the server pushes the session to every member
  (`sessions:refresh`), so each member's form re-reads `session.metadata`.
- `sessions:castToTake` (`Params { sessionId }` → `Response { sessionId, members: { castMemberId, name,
  faceMediaId }[], error? }`): typed in `typedSocket.ts`, gated and SCOPED by `sessionId` in
  `shared/sockets/interest.ts`. Lists the free card-less members of the session's cast (its notes and the
  lorebook it reads) for any member of the session.

## Files owned (only these)

`src/lib/client/components/sessionForms/EditSessionForm.svelte`, `SessionCharacters.svelte`,
`SessionPersonas.svelte`, `SessionBenchedSeats.svelte`, `SeatBenchButton.svelte`, `editSessionForm.ts` (types
only, if needed), and NEW `src/lib/client/components/sessionForms/editSessionGuestSeats.dom.test.svelte.ts`.
Lane `gs-2a` recently edited three `isAdmin` conditions in `EditSessionForm.svelte` (Pipelines card, Session
data): leave them. `CharacterSelectModal.svelte` is NOT yours: feed it different lists, don't edit it. Anything
else you think needs changing goes in your report.

## Rules your work depends on

- CLAUDE.md, Sockets: "views register listeners for local state and never call `toaster`"; "`socket.off(event)`
  with no handler removes **every** listener app-wide; always pass the handler" — use the form's existing
  `declareInterest` / `interestKey` pattern (as the `lorebooks:bindingList` effect ~855 does), which releases
  its own listener.
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- STYLE-GUIDE §6.4 **Field help**: "The one sentence under a field or a settings section is **`FieldHelp`**
  (`components/FieldHelp.svelte`): 13px muted, a `<p>` carrying the `id` the control's `aria-describedby`
  names." **Setting cards**: "the setting's name as the title …, **one sentence** of help …, then the control.
  **The title is the control's label** …; a switch at its own width at every width". §6.11: "A read-only value
  is shown as words, never as a disabled tick." Lane rule from the brief: a control a person may not use is
  **absent, never disabled**, and one line of words says why and who can change it.
- P4/P3: each switch has one sentence of purpose; nothing else is added.
- It is a **session**, never a *chat*.

## What to build

### 1. The owner's two switches (Participants tab, the **Guests** card)

Shown only to the session's owner (`!isGuest`), only where the Guests card already shows (its condition ~2487:
an existing session, accounts on, genre not `members: "solo"`), below the guest list. Two rows, each a Skeleton
`Switch` like the envoy switches (~2402) but with its visible label and a `FieldHelp` sentence
(`aria-describedby`). **Only the switch whose seat kind the genre's shape has**:
- 🚧 **Guests can bring their own characters** — help: *Guests add, remove and bench characters and personas
  they own, and can name a seat. Off keeps their seats as they are.* Shown when `showCharactersSection ||
  showPersonasSection`.
- 🚧 **Guests can take cast members** — help: *Guests take or leave the seat of a cast member without a card
  whom nobody plays. Off keeps their seats as they are.* Shown when `showCharactersSection`.

(Labels and sentences are ★ proposals: use them verbatim.) They are held until **Save** like the rest of the
tab: add `guestsBringOwn` / `guestsTakeCast` booleans to `data` and `originalData` (types ~190–235), loaded
from `storedGuestSeatSwitches(session.metadata)` where the form loads `playerLabelOverride` (~1666), so the
dirty check counts them; `save()` sends each only when it differs from `originalData` (as `scenesMoved` does,
~1355).

### 2. A guest with a switch off: controls absent, one line of words

Derive `canBringOwn = !isGuest || storedGuestSeatSwitches(session?.metadata).bringOwn` and `canTakeCast` the same
(the SAVED values, not the owner's draft). The owner is never frozen. For a guest:
- One line per switch that is off, at the top of the Participants panel under the tab's rule paragraph (~2319),
  the sentence `GUEST_SEAT_SENTENCES.bringOwnOff` / `.takeCastOff`; the bring-own line only when the
  Characters or Personas section shows, the take-cast line only when Characters shows.
- `!canBringOwn`: absent — **Add a persona**; Bench, Remove and the benched rows' Bring back / ⋯ (Reassign,
  Remove) on seats holding a card (characters and personas) and on card-less player seats; dragging those rows
  between seated and benched (and reordering them; use the zone's drag-disable). Renaming a card-less player
  seat stays. The character picker offers no cards (pass it an empty card list).
- `!canTakeCast`: absent — Bench, Remove, Bring back and ⋯ on card-less cast member seats; the picker offers no
  members.
- **Add a character** is absent only when the guest can do neither (`!canBringOwn && !canTakeCast`).
- With both switches on, every guest control is exactly as today (pin it in the test).

Pass booleans into the seat components as props (name them plainly, e.g. `canChangeCarded`,
`canChangeCastSeats`; report the names); don't move logic out of the form beyond that.

### 3. The guest's cast to take

For a guest, the members the picker offers come from `sessions:castToTake` instead of `lorebooks:bindingList`
(which refuses a guest on an attached lorebook): in the effect at ~855, when `isGuest`, declare
`interestKey("sessions:castToTake", sessionId)`, emit `{ sessionId }`, and map each member to a `PickMember`
`{ id: castMemberId, name, faceMediaId, cardId: null }` into `bookMembers`. Ask again when the session's seats
change (another guest may take someone). The owner keeps `lorebooks:bindingList` unchanged. Check that a
guest's already-seated card-less members still render (they come from `session.cardlessSeatShown`, ~1601).

## Tests (Done means)

NEW `editSessionGuestSeats.dom.test.svelte.ts` (copy the setup of `editSessionCastMembers.dom.test.svelte.ts`
/ `editSessionPlayerSeats.dom.test.svelte.ts` / `editSessionBench.dom.test.svelte.ts`):
- owner: both switches shown with their sentences in a group genre with accounts on; absent with accounts off
  and in a `members: "solo"` genre; only the bring-own switch when the shape has personas but no characters;
  toggling one and saving sends it in `sessions:update` (and an untouched one is not sent).
- guest, bring own off: the line shows; no **Add a persona**, no Bench/Remove on their own persona or card
  seat; the rename box stays.
- guest, take cast off: the line shows; no Bench/Remove on their card-less member seat; the picker offers no
  members.
- guest, both on: the controls as today, no line.
- a guest's form emits `sessions:castToTake`, not `lorebooks:bindingList`; the owner's still emits
  `lorebooks:bindingList`.

Regression (run, don't change unless a pin truly moved; say so): `editSessionCastMembers`,
`editSessionPlayerSeats`, `editSessionBench`, `editSessionSaveParity`, `editSessionAdvanced` DOM tests in the
same folder. Heavy DOM tests run capped: a failing assert on a happy-dom element has OOM-killed VS Code.

Run tests ONLY like this, one run at a time, each after the wait:

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a-w2-<n>.log 2>&1"
```

Never pipe vitest into `head`. `NODE_OPTIONS=--max-old-space-size=10240 npm run check` for svelte-check
(report errors in your files only); `npx prettier --check` your files.

## Stop and ask (in your report, don't decide) when

A control can't be told apart as carded vs card-less seat; a new label or sentence beyond the ones above seems
needed; a file outside the list must change; making a control absent would hide something the owner needs.

## Report

Your final message: changed files; the props added; what a guest sees per switch; tests run with pass counts
and log paths; **Noticed, not done**. Under 450 words.
