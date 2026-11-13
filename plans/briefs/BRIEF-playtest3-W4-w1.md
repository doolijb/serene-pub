# BRIEF playtest3-W4-w1 — SDK: the `unset` option on `FieldDecl`, its finding, the four widget declarations

Lane `playtest3-W4` (supervisor: lane-supervisor) · worker `w1` · report: put your full report in your final hand-back message (no report file).

## Goal
The owner ruled (★W3, 2026-11-04): *"add an SDK field option for a named "unset" choice, so the Album's Channel and Show another channel inline derive it too."* A string field declaration may name its blank as a choice. The app's form renderer (another worker) draws such a field as a Select of **‹label›** / **‹other›** with a text box only for the second; the box's placeholder is the field's existing `description`. Your half is the SDK.

### 1. `../serene-pub-sdk/sdk/src/settings.ts` — the option
On `interface FieldDecl` (~:179–394), add ONE optional key, next to `showIf` or after `format` (your pick; keep it near the other presentation keys):

```ts
	/**
	 * 🚧 For a `string` field only (★W3, 2026-11-04): its blank drawn as a named
	 * choice rather than an empty box. A form draws a choice list of `label`
	 * (what a blank does — *Default (main)*) and `other` (*Another channel*), with
	 * the text box only for `other`; the box's placeholder is the field's
	 * `description`. Choosing `label` stores blank, so a blank means what it
	 * always meant; nothing about the stored value changes. Any other field
	 * type is refused (`settingsSchemaFindings`, `checkSchema`).
	 * ⚠ Not an `enum`: the second choice is free text.
	 */
	unset?: { label: I18nText; other: I18nText }
```
(Wording may be tightened; keep 🚧, the string-only rule, "stores blank", the placeholder sentence, and the ⚠.)

### 2. The finding — one rule, both doors
Two finders exist and run at different doors: `settingsSchemaFindings` (strings; display text + shape; runs at `register()`, `genre()`, every widget's `settings` via `widgetDeclsFindings`, `validate()`) and `checkSchema` (`SettingsFinding` with `fix`; runs in `defineSettings`, plugin settings). Widgets pass ONLY `settingsSchemaFindings`. So:
- Add a small private helper in `settings.ts` (e.g. `unsetMisfit(decl: Partial<FieldDecl>): string | null`) that returns the reason sentence when `unset` is declared on a field whose `type !== 'string'`, else null. One sentence, used by both finders — never two copies of the rule.
- `settingsSchemaFindings`: when `f.unset !== undefined`: if not a plain object → `${at}.unset: … { label: 'Default (main)', other: 'Another channel' }` shape finding; else the type misfit (via the helper) as `${at}.unset: …`; and `i18nFindings(f.unset.label, \`${at}.unset.label\`, { required: true })` and the same for `other`. It already recurses into `item`/`fields`, so nested declarations are covered. Update its TSDoc's list of what it checks to name `unset`.
- `checkSchema`: alongside the `lend` check (the exact analogue: "'k' says 'lend', which only a secret has"), push an `error` `SettingsFinding` when the helper returns a reason: message like `'${key}' says 'unset', which only a string field has`, fix like `remove 'unset', or declare the field type: 'string' — the named blank is a choice beside a text box`.
- Error strings are new copy: keep them plain, in the house style of the neighbouring findings. List each exact string in your report.

### 3. `../serene-pub-sdk/core-catalog/src/registry/widgets.ts` — the four declarations
Re-read each before editing (line numbers drift; another lane may be editing other parts of this file — touch only these four field objects):
- Messages widget `channel` (~:233): add `unset: { label: 'Default (main)', other: 'Another channel' }`. Description unchanged.
- Messages widget `channelLane` (~:251): add `unset: { label: 'Default (whole channel)', other: 'Another lane' }`. Description unchanged.
- Messages widget `interleave` (~:267, label *Show another channel inline*; a blank draws no other channel's rows): add `unset: { label: 'Default (none)', other: 'A channel' }`, and reword its description to the Messages pattern so it matches the drawn choices: `"Default (none) leaves it blank: no other channel's lines are drawn here. A channel draws that one's lines under the line each belongs to, by its slug (table: the dice)."`
- Album widget `channel` (~:1188; a blank shows every channel): add `unset: { label: 'Default (every channel)', other: 'One channel' }`, and reword its description: `"Default (every channel) leaves it blank: the album shows every channel's pictures. One channel shows that one's pictures only, by its slug (the Lair's is sanctum)."`
Do NOT touch any other field, rename `channel`/`channelLane`, or change any `default`.

### 4. Tests — `../serene-pub-sdk/sdk-tests/settings.test.ts`
Add to `describe('79 · declaration-time refusals', …)`:
- `unset` on a `number` field is refused by `defineSettings` (throws, message matches `/'unset', which only a string field has/` or whatever you wrote) and by `checkSchema` (an `error`);
- `settingsSchemaFindings({ n: { type: 'number', unset: { label: 'Default', other: 'Another' } } }, 'w')` yields one finding naming `w.n.unset`;
- a `string` field with `unset` passes both (`checkSchema` → `[]`, `settingsSchemaFindings` → `[]`);
- a blank `unset.label` (`''`) is a `settingsSchemaFindings` finding naming `.unset.label`.
Import `settingsSchemaFindings` if not already imported there.

## Files owned (only these)
`/home/jody/github/serene-pub-sdk/sdk/src/settings.ts`, `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/widgets.ts` (the four fields only), `/home/jody/github/serene-pub-sdk/sdk-tests/settings.test.ts`.

## Files readable
Everything. `sdk/src/i18n.ts` (`i18nFindings`, `I18nText`), `sdk/src/descriptors.ts:2821` (`widgetDeclsFindings`).

## Out of scope — never built
A per-widget override of the option; a setting; changing what a blank stores; renaming `channel`/`channelLane`; any app (`serene-pub/src`) file; `NOMENCLATURE.md`; regenerating `docs/generated` (the SDK build does that).

## Stop and ask (in your report) when
The option seems to need a second shape for non-string fields; you would need another new name beyond `unset` and the private helper; a test outside your list breaks.

## Rules (quoted from the lead / CLAUDE.md)
- Re-read every file immediately before editing it. Use Edit, never Write, on existing files.
- **R1** one word, one meaning · **R3** qualify, never the bare noun. Before any new identifier or error string: grep both repos for it first (§24).
- *"0.6 is in users' hands."* Nothing here changes stored data — a blank still means the default.
- *"Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted."*

## Done means — run exactly these, from the SDK's `sdk-tests` dir (sources via tsconfig paths, no build needed)
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test settings.test.ts i18n.test.ts widgetSections.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-W4-w1a.log 2>&1; echo exit=$?'
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test coreConversationComponent.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-W4-w1b.log 2>&1; echo exit=$?'
```
Then read each log (`tail -40`, grep `^# pass|^# fail|not ok`). All green; `coreConversationComponent.test` unchanged and green. Also `npx tsc --noEmit -p /home/jody/github/serene-pub-sdk/sdk/tsconfig.json` if that tsconfig exists (else skip and say so) — the SDK package only, never the whole tree.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You do not need `sdk:build`; don't run it.)

## Report (in your hand-back)
Changed files with a one-line summary each · the exact new strings (TSDoc aside) · tests run, exact commands, pass/fail counts · anything stopped · Noticed, not done.
