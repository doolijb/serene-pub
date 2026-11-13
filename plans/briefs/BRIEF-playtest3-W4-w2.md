# BRIEF playtest3-W4-w2 — app: SchemaForm draws a string field's named blank; the panel's special case goes

Lane `playtest3-W4` (supervisor: lane-supervisor) · worker `w2` · report: put your full report in your final hand-back message (no report file).

## Goal
The owner ruled (★W3, 2026-11-04): *"add an SDK field option for a named "unset" choice, so the Album's Channel and Show another channel inline derive it too."* Worker w1 is adding, in the SDK, an optional key on `FieldDecl` (string fields only):

```ts
unset?: { label: I18nText; other: I18nText }   // I18nText = string | { en: string, …locales }
```

Today the Messages widget's **Channel** and **Channel lane** are drawn as a named default by a host-side special case (`CHANNEL_FIELDS` + `ChannelDefaultField.svelte` in `WidgetSettingsPanel.svelte`, keyed on the `messages` widget) — a P5 exception (*"Core builds a sensible UI from declarations"*). Your half: draw that shape **from the declaration**, in the one generic renderer, for every form that uses it, and delete the special case.

### 1. `src/lib/client/components/pipelines/SchemaForm.svelte`
- Local `interface FieldDecl` (~:23): add `unset?: { label: string | ({ en: string } & Record<string, string>); other: string | ({ en: string } & Record<string, string>) }` with a one-line 🚧 doc.
- A helper: `const namesUnset = (decl: FieldDecl) => decl.type === "string" && !!decl.unset` (a non-string field with `unset` is drawn as before — the SDK refuses that declaration).
- Per-control local state "the second choice was picked but nothing is stored yet": `const pickedOther = new SvelteSet<string>()` (from `svelte/reactivity`; **never** `$state(new Set())` — not reactive on mutation), keyed by the control's id.
- One snippet, e.g. `{#snippet unsetChoice(id, key, decl, value, set)}` — the shape `ChannelDefaultField.svelte` has today (read it first; it is being deleted):
  - `mode` = `String(value ?? "") !== "" || pickedOther.has(id) ? "other" : "unset"`.
  - `<Select label={text(decl.label, key)} labelHidden class="w-full" value={mode} options={[{ value: "unset", label: text(decl.unset.label, "") }, { value: "other", label: text(decl.unset.other, "") }]} onValueChange={…} />` — picking `unset`: `pickedOther.delete(id)` then `set("")` (stores blank); picking `other`: `pickedOther.add(id)` and **write nothing**.
  - Only while `mode === "other"`: `<input {id} type="text" class="input w-full" aria-label={text(decl.unset.other, "")} placeholder={text(decl.description, "")} value={String(value ?? "")} onchange={(e) => set(e.currentTarget.value.trim())} />`. The placeholder is the field's `description` — **no third string**.
- Use the snippet in BOTH render paths: the top-level field path (~:391–533) and the `control` snippet (~:243–336, used for `object` members and the Advanced fold). In each, the `{:else}` plain text-box branch is the string branch — add `{:else if namesUnset(decl)} {@render unsetChoice(…)}` before it. In the top-level path, an unset field's visible label must be the `<span aria-hidden="true">` variant the enum uses (the Select carries its own hidden label), not a `<label for>`; same in `control`.
- The description help line under the field stays as every other field draws it (unchanged code).
- Update the file's top doc comment only if it lists control kinds; otherwise a short comment on the snippet is enough.

### 2. `src/lib/client/sessionLayout/WidgetSettingsPanel.svelte`
Remove `CHANNEL_FIELDS`, `isMessages`, `channelKeys`, `channelFieldsOf`, `restOf`, the `ChannelDefaultField` import and render block; each group renders `<SchemaForm schema={schemaOf(g.fields)} bind:values oncommit={commit} />`. Drop imports that become unused (`i18nText`, `widgetOfInstance` — check). A blank still commits through the existing `commit()` diff → `patchWidgetSettings`, which prunes it (unchanged).

### 3. Delete `src/lib/client/sessionLayout/ChannelDefaultField.svelte`
(`rm` that one file by name.) First `grep -rn "ChannelDefaultField" src` — if anything other than the panel imports it, stop and report.

### 4. Tests
- `src/lib/client/sessionLayout/widgetSettingsPanel.dom.test.ts`, describe *"the Messages widget's Channel and Channel lane name their default"* (~:232): the fixture's `channel` gains `unset: { label: "Default (main)", other: "Another channel" }`, `channelLane` gains `unset: { label: "Default (whole channel)", other: "Another lane" }` (now derived, so the fixture must declare it); `interleave` becomes `{ type: "string", default: "", label: "Show another channel inline", group: "Channel", unset: { label: "Default (none)", other: "A channel" } }`. Keep the four existing tests' intent; adjust the assertions that pinned the old ids (`#sf-interleave` was a checkbox; `#sf-channel` null while the default is chosen still holds). Add: (a) the box's placeholder is the field's description (`"Help."` on `channel`); (b) Messages' **Show another channel inline** reads *Default (none)* with no box when nothing is stored, and a stored `table` shows *A channel* with `table` in the box; (c) an `album` widget fixture (`{ id: "album", title: "Album", settings: { channel: { type: "string", label: "Channel", description: "…", unset: { label: "Default (every channel)", other: "One channel" } } } }`) draws *Default (every channel)* and picking it stores blank (writes `{}` after starting from a stored slug); (d) a string field with no `unset` (the `log` widget's `channel` in the sections describe) is still one plain box (the existing sections test already pins `sf-channel` — keep it green).
- New `src/lib/client/components/pipelines/schemaFormUnset.dom.test.ts` (follow `schemaFormChoiceLabels.dom.test.ts`'s mount/settle style): SchemaForm alone — a string with `unset` draws the two choices and no box; a stored value shows the second choice with the value in the box and the description as placeholder; picking the first commits `""` (and `oncommit` fired); picking the second writes nothing until the box commits a trimmed value; a string without `unset` is a plain box; the same field declared `advanced: true` (the `control` snippet path) draws the same choice; an `unset` on a `number` field is drawn as the number box (no Select).

### 5. `docs/session-layout.md` (re-read first; edit exactly these sentences)
- ~:56 (Album row): `and **Channel** (one channel's pictures only)` → `and **Channel** (*Default (every channel)*, or **One channel** and its slug for that channel's pictures only)`.
- ~:111: `and 🚧 **Show another channel inline** ([below](#dice-inline-or-as-a-log)).` → `and 🚧 **Show another channel inline** (*Default (none)*, or **A channel** and its slug; [below](#dice-inline-or-as-a-log)).`
- ~:178: `set a Messages copy's **Show another channel inline** to \`table\`` → `set a Messages copy's **Show another channel inline** to **A channel** and type \`table\``.
- ~:179: `a Messages copy with its **Channel** set to \`table\`` → `a Messages copy with its **Channel** set to **Another channel** and \`table\``.

## Files owned (only these)
`src/lib/client/components/pipelines/SchemaForm.svelte`, `src/lib/client/sessionLayout/WidgetSettingsPanel.svelte`, `src/lib/client/sessionLayout/ChannelDefaultField.svelte` (delete), `src/lib/client/sessionLayout/widgetSettingsPanel.dom.test.ts`, `src/lib/client/components/pipelines/schemaFormUnset.dom.test.ts` (new), `docs/session-layout.md` (the four sentences). All paths under `/home/jody/github/serene-pub/`.

## Files readable
Everything. `src/lib/client/components/inputs/Select.svelte` (props: `label`, `labelHidden`, `value`, `options`, `onValueChange`), `src/lib/client/stores/widgetSettings.svelte.ts`, `src/lib/shared/widgets/settings.ts`, the other SchemaForm tests (`schemaFormChoiceLabels.dom.test.ts`, `schemaFormObject.dom.test.ts`, `settingsGroups.dom.test.ts`).

## Out of scope — never built
A per-widget override; a setting; changing what a blank stores (it stays `""` through `commit`); renaming `channel`/`channelLane`; the server `sessions/settingsForm.ts` / `SessionSettingField.svelte` (no genre field declares `unset`; don't carry it); the SDK's own `controls/src/SchemaForm.svelte`; any SDK file; `NOMENCLATURE.md`; `STYLE-GUIDE.md`.

## Stop and ask (in your report) when
Drawing it needs a new SchemaForm prop or a new component; a name beyond the snippet/helper/state names is needed; a test outside your list breaks.

## Rules (quoted from CLAUDE.md)
- *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."*
- *"Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."*
- *"It is a **session**, never a *chat*."*
- STYLE-GUIDE §10: *"A hint becomes the field's placeholder (what to type) or its `title` (what it is for)."*
- Re-read every file immediately before editing it. Use Edit, never Write, on existing files.

## Done means — run exactly this, then read the log
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/sessionLayout/widgetSettingsPanel.dom.test.ts src/lib/client/components/pipelines/schemaFormUnset.dom.test.ts src/lib/client/components/pipelines/schemaFormChoiceLabels.dom.test.ts src/lib/client/components/pipelines/schemaFormObject.dom.test.ts src/lib/client/components/pipelines/settingsGroups.dom.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-W4-w2.log 2>&1; echo exit=$?'
```
Never pipe vitest into `head`. All green. Then `npx prettier --check` on each changed file (report, don't `--write` files you didn't otherwise change; formatting your own changed lines is fine).

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You do not need `sdk:build`; don't run it.)
- Never `git checkout`, `git restore` or `git clean` in either repo.

## Report (in your hand-back)
Changed files with a one-line summary each · tests run, exact command, pass/fail counts · prettier results · anything stopped · Noticed, not done.
