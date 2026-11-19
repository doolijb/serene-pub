# BRIEF — lane `gs-1`, worker 2 (client + DOM tests + docs + NOMENCLATURE) — who reads prompts and pipeline settings

Repo `/home/jody/github/serene-pub` (app). The SDK does not change. Supervisor: lane `gs-1`.
Report path: your final message (the supervisor reads it). Under about 400 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` in this task: don't run one.)

Also: never `git checkout / restore`; never `prettier --write`; no full test run; no `npm run build`. Re-read every file right before editing it: other lanes work nearby (`client/lorebooks/knowledge/`, `docs/lorebooks.md`, `LorebookActions.svelte`): do NOT edit those.

## The owner's ruling (D58, 2026-11-16) — what you build

"The session's owner picks and may read the wording; a guest sees nothing; outside a session only an administrator." "There should be a preview button for prompts, etc."

**Not ruled, do not build or pre-empt (G1–G7):** what else a guest sees (Edit session's tabs, participants), session notes, a guests-may-add switch, card-less seats, **Prompt details** (the compiled prompt; still open to guests until G5), an administrator inside someone else's session (G6: unchanged), SDK template exposure. Swap cards (`PipelineCards`) stay as they are.

A parallel worker changes the server: `pipelines:get` and `pipelines:promptWording` refuse a guest and a non-admin outside a session; `sessions:pipelines` sends a guest who is not an administrator `pipelines: []`; `pipelines:promptWording` gains a second address. Its new param type (in `src/lib/shared/sockets/types.ts`, which you do NOT edit): `Params { slug: string; optionId?: string; fieldId?: string; promptId: number; sessionId?: number }` (exactly one of `optionId` / `fieldId`), `Response` gains `fieldId?: string` (echoed). `fieldId` = a session settings form field's `id`; the server answers only for the session's owner and a prompt that row lists.

## Files owned (edit only these)

- `src/lib/client/components/sessionForms/EditSessionForm.svelte` — only the Pipelines card's mount (~2949–2985), the `sessions:pipelines` request (~1902–1904) and `settingsHides` (~617–621).
- `src/lib/client/lorebooks/GraphsWorkspace.svelte` — only the "Graph build pipeline settings" button (~1261–1273), the panel's mount (~1723–1750) and `onRaiseCeiling` (~1700).
- `src/lib/client/components/pipelines/PromptWordingDialog.svelte`.
- `src/lib/client/components/sessionForms/SessionSettingsForm.svelte`, `src/lib/client/components/sessionForms/sessionSettingsForm.ts`.
- Their DOM tests: `editSessionAdvanced.dom.test.svelte.ts`, `sessionSettingsForm.dom.test.ts`, `promptWordingDialog.dom.test.svelte.ts`, and a GraphsWorkspace DOM test if one exists (else add a small one only if a harness nearby makes it cheap; otherwise say so).
- Docs: `docs/sessions.md`, `docs/pipelines.md`, `docs/group-sessions.md`; `NOMENCLATURE.md` (§9 rows and one §25 bullet, below).

`STYLE-GUIDE.md` is read-only: do not edit it.

## Build

1. **Edit session's Pipelines card** (`EditSessionForm.svelte`). `isGuest` (571–573) is "not the owner", so it also covers an administrator who is not the owner. The card is absent for `isGuest && !userCtx.user?.isAdmin`: nothing rendered, no disabled controls, and the form does not emit `sessions:pipelines` for that viewer (the client stops asking for what it will not get). Re-derive `settingsHides` (617–621) so a non-admin guest's count no longer includes the Pipelines section (an admin guest's is unchanged), and keep its comment true. Update the comment above the card (~2940) to say who gets it (the session's owner, and an administrator; a guest gets none: owner ruling D58, 2026-11-16).
2. **Graphs workspace** (`GraphsWorkspace.svelte`): outside a session only an administrator reads a pipeline's settings, so the "Graph build pipeline settings" button renders only for `userCtx?.user?.isAdmin` (and `!readOnly`, as now); a non-admin sees nothing there, never a disabled button. The panel (`{#if showPipelinePanel}`) also requires an administrator, so `onRaiseCeiling` can never open it for a non-admin. Do not edit `graphs/NodePanel.svelte` (its "Raise it" link is not yours: report it under Noticed).
3. **The owner's preview on the settings form's prompt row** (`SessionSettingsForm.svelte`): after the `SessionSettingField` of a prompt row, a text button **Read the wording** (same words and classes as the panel's read-only row: `PipelineConfigOptions.svelte` ~1170–1186, `text-primary-ink w-fit text-xs underline`) that opens the existing `PromptWordingDialog`. Shown whether the row is editable or locked; the dialog offers **Use** only when `field.editable` and the field is not busy (Use = the same `write(field, String(id))` the select does).
   - A prompt row is told apart by a pure helper in `sessionSettingsForm.ts` (e.g. `isPromptRow(field)`): `field.address.kind === "pipeline"`, `field.control === "enum"`, and `field.address.slot` is not `params` / `settings` (the server builds pipeline fields only from those two slots plus the prompts slot). Comment why. Unit-test it.
   - `slug` = the group's `pipeline`; `rowLabel` = the group's heading (as drawn); `sessionId` = the form's; `fieldLabel` = a pure helper in `sessionSettingsForm.ts` that turns a declared field name into words the way the panel's local `humanize` does (`PipelineConfigOptions.svelte` ~779–789; copy, do not import from that component).
4. **`PromptWordingDialog.svelte`, one small prop change**: a new optional `fieldId?: string`. When set, both requests send `{ slug, fieldId, promptId, sessionId }` (no `optionId`) and replies are matched on `res.fieldId === fieldId`; when absent, behaviour is exactly today's. Loosen the `option` prop's type to the fields the dialog reads (`id`, `value`, `choices`, the optional `prompt`), declared locally, so the settings form passes `{ id: field.id, value: <number|null>, choices: members → { id: Number(key), label } }` without a cast. And: when no choice carries a `group`, the list is drawn as one list with no group label (today every group-less choice would fall under "Also fits", which would be untrue here). Update the header comment for the two callers.
5. **Docs** — say what is true, never more:
   - `docs/sessions.md` "Pipeline settings in a session" (~590–608): the section is the session owner's (and an administrator's); "someone who isn't an administrator sees prompts and nothing else" → the session's owner sees prompts and nothing else; a guest has no Pipelines section. Story's reply's **Prompt** on the derived Settings card now has **Read the wording** (same list; **Use** where you may change it). "Guests" (~610–623): a guest doesn't see the session's pipeline settings and can't read its prompts there; **Prompt details** on a reply still shows anyone in the session the prompt that reply was written from (do not claim guests never see prompt text).
   - `docs/pipelines.md` (~12–19): "**Everyone** can choose, in their own session's settings…" → the session's owner chooses, in that session's settings, which prompt each step uses and can read each one's wording; a guest in someone else's session sees none of this; outside a session only an administrator sees a pipeline's settings or reads its prompts (that includes the lorebook Graphs' pipeline settings button).
   - `docs/group-sessions.md`: one sentence where guests are introduced (~12–16, or "The basics"): guests play; the session's settings and its prompts are the owner's. Link to `./sessions.md#guests`.
   Plain sentences, sentence case, no "chat", no internal names.
6. **`NOMENCLATURE.md`**: §9 Session table, three rows near **session** (match the table's format, each with a charter: what it is, what it may see of prompts and pipeline settings, what it does not own and who does, and the near neighbour it is not):
   - **session owner** — `sessions.user_id`; picks the session's settings and, in the Pipelines card and the settings form, its prompts, and may read their wording (D58); never model plumbing (connections, models, sampling, loadouts: an administrator's). Not a card's owner (`characters.user_id`).
   - **guest** 🚧 — a `session_guests` row, invited by the owner; plays as their own persona and manages the cast they own; gets no Pipelines card and no prompt name, id or wording (`pipelines:get`, `pipelines:promptWording`, `sessions:pipelines` refuse or send nothing). 🚧 open (G1–G7, D61): Edit session's tabs, session notes, the guests-may-add switch, card-less seats, Prompt details (still shows a guest the compiled prompt), an administrator who is a guest (keeps the administrator's view and writes at configuration scope).
   - **member** — a signed-in account that is not an administrator. In a session they own they are its owner; outside a session they read no pipeline settings or prompts. Not "cast member" (§ cast) — say so.
   Grep first (`member` is busy: "cast member", "member gallery"); R3 says qualify. If a row conflicts with an existing use, stop and report rather than renaming anything.
   §25: append one bullet at the end of the list, in the style of the last bullets: `2026-11-16 (lane gs-1 — prompts are read by the session's owner in a session and by administrators outside one; a guest gets none; owner ruling D58, 2026-11-16 …; 🚧 provisional copy, not ruled; no migration)`. Quote both rulings: D58 above, and 2026-09-30 (the `visibleTo` comment: "Prompts stay visible because wording is the one thing that is genuinely theirs to change for a session; outside a session their panel is a reading surface") marked **superseded for prompts** (the role test of 2026-09-30 still holds for administrators). List: *new* rows session owner, guest 🚧, member; *new (wire)* `fieldId` on `pipelines:promptWording` (params and echo); *new internal names (app)* 🚧 `PipelineReader`, `pipelineReaderOf` (`config/panel/scopes.ts`); *changed* `visibleTo`, `pipelines:get` / `pipelines:promptWording` refusals (sentences: "Access denied. Only admin users can manage pipelines." outside a session, "Only the session's owner sees its settings." in one), `sessions:pipelines` empty for a guest who is not an administrator, the Edit session Pipelines card absent for such a guest, the Graphs pipeline settings button administrators-only, **Read the wording** on the settings form's prompt row; *not changed* `pipelines:list`, swap cards, Prompt details (G5).

## Tests

- `editSessionAdvanced.dom.test.svelte.ts` ~325–339: re-pin "guest, off, with session pipelines: one line" (old: a non-admin guest sees the Pipelines line) → a non-admin guest: no Pipelines section, no line, and `sessions:pipelines` never emitted; add: an administrator who is a guest, advanced on, with session pipelines → the card renders (unchanged until G6).
- `sessionSettingsForm.dom.test.ts`: the owner's prompt row has **Read the wording**; pressing it opens the dialog and emits `pipelines:promptWording` with `fieldId` (no `optionId`); a plain row has no such button; a locked prompt row still has it and the dialog offers no **Use**. Unit tests for `isPromptRow` and the field-label helper.
- `promptWordingDialog.dom.test.svelte.ts`: with `fieldId`, requests carry `fieldId` and a reply with the matching `fieldId` is shown; group-less choices draw no group label; existing tests unchanged.
- GraphsWorkspace: a non-admin sees no "Graph build pipeline settings" button; an administrator does (if a harness exists).

Run (exactly this; one run at a time):
```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-1-w2-<n>.log 2>&1"
```
Never pipe vitest into `head`. A failing `assert` on a happy-dom element has OOM-killed VS Code: keep DOM assertions on strings / booleans. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (the server worker adds `fieldId` to the shared type; if it is not there yet, report the errors and re-run once at the end) and `NODE_OPTIONS=--max-old-space-size=10240 npm run check` (report errors in your files only). `npx prettier --check` on changed code files.

## Stop and ask (in your report, don't decide) when

A new user-facing sentence or label is needed beyond those named here; hiding the card or button would also hide something a guest keeps (the session page, their own cast); a NOMENCLATURE row collides with an existing meaning; anything outside the files owned.

## Report

Changed files; tests run with pass counts and log paths; re-pins (old → new); every new or moved sentence (★); Noticed, not done.
