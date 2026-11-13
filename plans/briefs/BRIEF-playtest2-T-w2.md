# BRIEF playtest2-T-w2 — the narrator's cadence control in the turn picker, docs

Lane `playtest2-T` (supervisor writes the lane report; you report back to the supervisor in your final message). Worker id `w2`.

## Goal
Owner ruling (2026-11-04, plan `plans/PLAN-story-playtest-fixes-2026-11-03.md` § Rulings item 7): *"Narrator turn: **after the cast, every N rounds**; not a second reply under Next turn."* The Story genre field `narratorInterjections` (UI label **Narrator asides**) is being re-shaped by worker w1 in the SDK from a boolean into an enum:
- keys, in order: `off` · `every-round` · `every-2nd-round` · `every-3rd-round` (labels *Off* · *Every round* · *Every 2nd round* · *Every 3rd round*), default `off`, `reach: "owner"`, description *"How often the narrator takes a turn of its own, after everyone else's. Each is another model call."*
- a session stored before today may hold `true` (reads as `every-round`) or `false` (reads as `off`); old task modes `"full"`/`"review"` also read as `every-round`.

Today the setting is only in **Edit session › Settings**. You surface the SAME setting (one source of truth, the server's derived settings form) in the turn picker, `src/lib/client/components/sessionPage/TurnPicker.svelte` (the "Who speaks next?" dialog that **Someone else** in the composer line and **Pick who speaks** in the Turn order widget both open, via the existing `pick-turn` request), under the narrator's row. Nothing new is declared: the control is the existing `SessionSettingField.svelte` drawing the server's field.

## Build
1. New pure helper `src/lib/client/components/sessionPage/narratorCadence.ts`:
   - `export const NARRATOR_CADENCE_FIELD_KEY = "narratorInterjections"`
   - `export function narratorCadenceKey(value: unknown): unknown` — `true`, `"full"`, `"review"` → `"every-round"`; `false` → `"off"`; anything else returned unchanged (so `undefined` inherited stays `undefined`, and a current key passes through).
   - `export function narratorCadenceField(form: Sockets.Sessions.SettingsForm.Response | null | undefined): Sockets.Sessions.SettingsForm.Field | null` — the field in `form.groups[*].fields` whose `address` is `{ kind: "genre", key: NARRATOR_CADENCE_FIELD_KEY }`, returned as a copy with `value` and `inherited` passed through `narratorCadenceKey`; null when absent (a guest's form has no groups; a genre without the field has none).
   - Unit test beside it, `narratorCadence.test.ts`.
2. `TurnPicker.svelte` (re-read immediately before editing; Edit, never Write):
   - Session id from `getContext<OpenSessionCtx>("openSessionCtx")?.sessionId` (the page already provides it; `src/app.d.ts:436`). **Do not add props that `src/routes/sessions/[id]/+page.svelte` must pass** — that file is not yours.
   - While `open && offerNarrator && sessionId != null`: in an `$effect`, `requestWithInterest("sessions:settingsForm", { sessionId }, (res) => { if (res?.sessionId !== sessionId) return; form = res })` (import from `$lib/client/sockets/interest.svelte`; return its release from the effect, exactly as `src/lib/client/components/sessionForms/SessionSettingsForm.svelte:63-68` does).
   - When `narratorCadenceField(form)` is non-null, draw it right under the narrator's `<li>` (inside the list, its own `<li>`, below the narrator button) with `<SessionSettingField field={…} viewer={form.viewer ?? "owner"} busy={…} refusal={…} onwrite={write} />` (import from `$lib/client/components/sessionForms/SessionSettingField.svelte`). It brings the label, the description sentence, the read-only state with its reason when a preset locked it, and Reset — draw nothing else around it (no new heading, no new copy).
   - `write(value)`: the same request/settle pattern as `SessionSettingsForm.svelte:85-125` (`declareInterest("sessions:updateSetting", …)` filtered by a `requestId`, `socket.emit("sessions:updateSetting", { sessionId, address: field.address, value, requestId })`, 15 s timeout, `release()` on settle). On `reply.error` keep it as the refusal shown under the field; on success take `reply.form` as the new `form`. `requestId` built from a counter + `Math.random().toString(36)` — **never `crypto.randomUUID`**. Never call `toaster`.
   - Picking a speaker must behave exactly as today.
3. New DOM test `src/lib/client/components/sessionPage/turnPickerCadence.dom.test.svelte.ts` (find the mounting/mocking pattern of an existing host-component DOM test that mocks `$lib/client/sockets/interest.svelte` / `useTypedSocket`, e.g. `src/lib/client/admin/sections/plugins/providedBooks.dom.test.svelte.ts`; provide `openSessionCtx` through the mount's context). Cases: an owner's form with the field stored `true` shows the choice as **Every round**; choosing **Every 2nd round** emits `sessions:updateSetting` with `{ sessionId, address: { kind: "genre", key: "narratorInterjections" }, value: "every-2nd-round" }`; a refusal reply shows its sentence under the control; a guest's form (no groups) draws no control while the narrator row still picks; `offerNarrator: false` asks for no form. Keep assertions on plain properties; a failing `assert` on a happy-dom element has OOM-killed VS Code, so assert `textContent`/attributes, not whole elements.
4. Docs (re-read each immediately before editing; Edit):
   - `docs/genre-story.md` line ~65 (**Extra voices**) and ~79: Narrator asides now has **Off**, **Every round**, **Every 2nd round**, **Every 3rd round**; it comes after everyone else's turn, counted from the narrator's last line; only with **Auto-advance** on **Whole round** (fix the old word *Round* — the UI says *Whole round*) do these voices speak by themselves; on **Next turn** their turn waits at the head of the order for a **Continue**, so a line you send never brings two replies; the session's owner also finds **Narrator asides** in **Someone else**, under the narrator's row. Plain sentences, the doc's existing voice; no new section.
   - `docs/sessions.md` line ~136 (the bullet about **Someone else** and **Continue**): one clause that **Someone else** also holds the session's **Narrator asides** for its owner, linking `./genre-story.md#what-runs-between-turns`. Touch nothing else in that file (other lanes own its § Back and § Scenes).

## Files owned (only these)
`src/lib/client/components/sessionPage/TurnPicker.svelte`, `…/sessionPage/narratorCadence.ts` (new), `…/sessionPage/narratorCadence.test.ts` (new), `…/sessionPage/turnPickerCadence.dom.test.svelte.ts` (new), `docs/genre-story.md`, `docs/sessions.md` (that one bullet). All paths under `/home/jody/github/serene-pub/`.
Never touch: `src/lib/server/sessions/settingsForm.ts`, `SessionSettingsForm.svelte`, `SessionSettingField.svelte`, `+page.svelte`, `turnFlow.svelte.ts`, `src/lib/shared/sockets/types.ts`, `src/lib/client/sockets/typedSocket.ts`, `NOMENCLATURE.md`, `STYLE-GUIDE.md`, anything in `../serene-pub-sdk`. If one needs a change, write it under "Needs elsewhere" with file:line and exact text.

## Rules you work under (quoted)
- CLAUDE.md Standing rulings: *"Sockets: one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."* `requestWithInterest`/`declareInterest` are the view-local listeners; always release them.
- Hard rule: *"`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."* (prefer the interest helpers, which do this.)
- Hard rule: *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."*
- CLAUDE.md: *"Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."*
- *"Members never see or touch model plumbing"* — n/a, this is a genre field with `reach: owner`; the server's form already decides who sees it (a guest gets no groups). Never decide visibility client-side.
- P5: *"Core builds a sensible UI from declarations"* — draw the server's field, never a hand-written list of the four choices in the component.
- STYLE-GUIDE §6.17 (as quoted in SessionSettingField's header): a read-only setting is *"the value's name and the server's reason, never a disabled control"* — SessionSettingField already does this; don't wrap it.
- Introduce no identifier, label or sentence beyond those in this brief.

## Tests (run only these)
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/sessionPage/narratorCadence.test.ts src/lib/client/components/sessionPage/turnPickerCadence.dom.test.svelte.ts src/lib/client/components/sessionPage/remoteTurnOrder.dom.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-T-w2.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. Also `npx prettier --check` on each file you changed.

## Stop and ask when
`SessionSettingField` cannot be reused as-is inside the dialog; the page does not provide `openSessionCtx` with the session id; a new name or copy seems needed; a test outside this list fails because of your change (report it).

## Done means
The three test files green, prettier clean. Report: changed files (one line each), exact commands + pass/fail counts, "Needs elsewhere", Noticed-not-done.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — you do not run `sdk:build` at all.
