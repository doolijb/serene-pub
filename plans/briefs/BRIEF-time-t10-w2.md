# BRIEF — lane `time-t10`, worker w2 — the client: the two person doors ask before a clock moved back past the session's writes

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t10`. You run in parallel with worker w1 (server files only; you never touch them).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no GPU.

## Goal

When a session's story clock is moved **back** past dated things that session already wrote into its lorebook, the server refuses the move with a **notice** until the person confirms. The confirmation names the session's **On revision** mode (Overwrite or Branch). You build the asking on the client, at the two doors a person moves the clock through:
1. the Chronicle widget's `set-story-clock` request, answered by the session page (`src/lib/client/components/sessionPage/requests/storyClock.ts` `answerSetStoryClock`, wired in `requests/index.ts` ~547). The Chronicle (an SDK component, not editable) shows any rejection as "Not done: ‹reason›", so the PAGE's handler asks before it answers;
2. Session settings' Save (`src/lib/client/components/sessionForms/EditSessionForm.svelte`, `save` ~1330–1414; reply handler `handleSessionsUpdate` ~1910).

Owner rulings (quote, do not reinterpret):
- 2026-11-14 (★12): "The clock moved back uses **On revision** (no separate answer for deleting a turn and for moving the clock)"; "No new setting; 'flashback' is the same line, writing at the earlier date."
- 2026-11-13: "When a session's story clock moves back past things that session already wrote, a choice is required, never made silently."

## The wire (already in `src/lib/shared/sockets/types.ts`; do not edit it)

- `Sockets.Sessions.StoryClock.ClockMoveBackNotice` `{ mode: "overwrite" | "branch"; count: number; latestLabel: string; toLabel: string; sentence: string }`.
- `sessions:setStoryClock` params gain `confirmClockMoveBack?: true`. Its refusal (`sessions:setStoryClock:error`, the same `StoryClock.Response` shape, token echoed in `request`) carries `error` (= the sentence) AND `clockMoveBack: notice` when the move needs confirming. A confirmed reply under Branch carries `branchedTo: <new session id>`.
- `sessions:storyClock` params gain `moveTo?: StoryClock | null` (null = follow the line's present); its reply then carries `clockMoveBack: notice | null`.
- `sessions:update` params gain top-level `confirmClockMoveBack?: true`; its reply may carry `branchedTo`.
Worker w3 builds the server side after you; test against these shapes with mocks.

## Files owned (edit only these)

1. **New** `src/lib/client/components/sessionPage/clockMoveBackConfirm.ts` + **new** `clockMoveBackConfirm.test.ts` (pure) + **new** `clockMoveBackConfirm.dom.test.ts` (the mounted dialog).
2. `src/lib/client/components/sessionPage/requests/storyClock.ts` + its existing `storyClock.test.ts`.
3. `src/lib/client/components/sessionPage/requests/index.ts` — only the `"set-story-clock"` entry (~547–553) and one import.
4. `src/lib/client/components/sessionForms/EditSessionForm.svelte` — only the save path, the `handleSessionsUpdate` branch navigation, one `useInterest` for the pre-check reply, and one `<ActionConfirm>` for the question. Nothing else.
5. **New** `src/lib/client/components/sessionForms/editSessionClockMoveBack.dom.test.svelte.ts`.

Not yours: `src/routes/**`, `Layout.svelte`, `pressRouting.svelte.ts`, `ActionConfirm.svelte` (reuse it unchanged), any server file, `types.ts`.

## Build

### A. `clockMoveBackConfirm.ts`

```ts
/** 🚧 The question for a clock moved back past the session's dated writes, as `ActionConfirm` asks it. Pure. */
export function clockMoveBackAsking(notice: Notice): { question: string; description: string; confirmLabel: string }
```
Exactly (🚧): question `Move the story back?`; description `${notice.sentence} On revision: ${notice.mode === "branch" ? "Branch" : "Overwrite"}.`; confirmLabel `Move back` (overwrite) / `Branch and move back` (branch). Never use "overwrite" as a verb.

```ts
/** Ask on the session page: mounts `ActionConfirm` (`./ActionConfirm.svelte`, unchanged) into `document.body`, resolves true on its confirm and false on Cancel/Escape, then unmounts it. A second ask while one is open answers the first false. */
export function confirmClockMoveBack(notice: Notice): Promise<boolean>
/** Take the person to the branch a confirmed move made. */
export function openBranchedSession(sessionId: number): void   // goto(sessionAddress(sessionId)), as turnFlow.svelte.ts ~315–323 does
```
Use Svelte 5 `mount` / `unmount` (precedent: `src/lib/client/components/hostElements/spElement.svelte.ts` ~39). The session page's route file is not this lane's, which is why the dialog mounts itself; keep this module the only place that does so. `ActionConfirm` is the STYLE-GUIDE §6.6 `alertdialog` ("answered, never dismissed by a click outside"; its confirm is the primary when the person gets something back).

### B. `answerSetStoryClock` (requests/storyClock.ts)

Add a fifth, optional parameter `moveBack?: { confirm(notice: Notice): Promise<boolean>; open(sessionId: number): void }`. Flow:
1. `res = await write({ sessionId, ...ask })`.
2. If `res.error && res.clockMoveBack && moveBack`: `if (await moveBack.confirm(res.clockMoveBack)) res = await write({ sessionId, ...ask, confirmClockMoveBack: true }); else throw new Error("The story clock was not moved.")` (🚧 sentence).
3. As today: `res.error` → throw; missing `lorebookId` → throw; `noteClock`.
4. `if (typeof res.branchedTo === "number") moveBack?.open(res.branchedTo)`; return `storyClockV1(res)`.
`requests/index.ts`: pass `{ confirm: confirmClockMoveBack, open: openBranchedSession }`.

### C. Session settings' Save (EditSessionForm.svelte)

In `save`, after `stripUnmovedReading(sent, was)` and the `updateSession` object is built: when `sent` still carries the story clock keys (the person moved the clock here) and does NOT carry `lorebookBranchId` (the line is unchanged), ask the server before saving:
- emit `sessions:storyClock` `{ sessionId: session.id, request: <token>, moveTo: <the clock from sent's five keys, or null when storyClockYear is null> }`. The token: a module counter plus `Date.now()` — never `crypto.randomUUID`.
- Listen with ONE `useInterest<"sessions:storyClock">("sessions:storyClock", handler)` (and one for `"sessions:storyClock:error"`), matching only `res.request === <token>`.
- Reply `clockMoveBack` null, or an error reply → emit the `sessions:update` exactly as today (the server is the authority; its own refusal is toasted by Layout's catch-all as today).
- A notice → hold the built `updateSession` and show `<ActionConfirm asking={clockMoveBackAsking(notice)} … />` (the form already imports `ActionConfirm`). Confirm → `commitParticipantChanges(session.id)` and emit `sessions:update` with `{ ...updateSession, confirmClockMoveBack: true }`; Cancel → nothing is sent, the form stays open with its edits.
- When the participant writes are committed must not change for a save that does not move the clock back.
- `handleSessionsUpdate`: when `res.branchedTo` is a number AND this form sent the confirmed save, call `openBranchedSession(res.branchedTo)` (after the existing close).
- Do not toast anything new.

## Rules your work depends on

- Sockets: one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and never call `toaster`. Use the form's existing `useInterest` registry (released with the form). If you ever use `socket.off`, always pass the handler — `socket.off(event)` with no handler removes every listener app-wide. A scoped event carries its scope key (`sessionId`) in the payload.
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`.
- Comments state the rule, not the story. Mark new words 🚧.
- Never `prettier --write` beyond the lines you changed (never the whole of `EditSessionForm.svelte`).
- It is a **session**, never a *chat*.
- If anything needs a route file, Layout, a new event or a server change, STOP and report.

## Tests (write them; run each as below, one at a time)

Before each run: `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` — if a vitest is running (another session shares the checkout), wait and check again. Then:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t10-w2-<name>.log 2>&1"` and read the log (never pipe vitest into `head`). Model the form test on `editSessionLorebookLine.dom.test.svelte.ts` / `editSessionSaveParity.dom.test.svelte.ts`.

- `clockMoveBackConfirm.test.ts`: the asking words for each mode.
- `clockMoveBackConfirm.dom.test.ts`: the dialog opens with the question and description; Confirm resolves true and the dialog is gone; Cancel resolves false; a second ask answers the first false.
- `storyClock.test.ts` (extend): a refusal with a notice → confirm true → the second write carries `confirmClockMoveBack: true` and the result is the reading; confirm false → rejects with "The story clock was not moved." and no second write; a refusal without a notice rejects as today; `branchedTo` → `open` called with it.
- `editSessionClockMoveBack.dom.test.svelte.ts`: a moved-back clock → Save emits `sessions:storyClock` with `moveTo` and no `sessions:update`; a notice reply shows the dialog with the sentence; Confirm emits `sessions:update` with `confirmClockMoveBack: true`; Cancel emits nothing; a null reply emits `sessions:update` without the flag; an unmoved clock emits `sessions:update` directly (no pre-check); an update reply with `branchedTo` opens the branch.
- Re-run the existing `src/lib/client/components/sessionForms/editSession*.dom.test.svelte.ts` and `src/lib/client/components/sessionPage/requests/` tests.

Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — report errors in your files (w1 may be mid-edit on server files; name those, do not fix them).

## Report (your final message)

Changed files; each test command with pass/fail counts; any deviation and why; Noticed, not done. Under 400 words.
