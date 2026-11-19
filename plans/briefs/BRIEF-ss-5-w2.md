# BRIEF — worker `ss-5-w2` — a read-only setting row says its cause, tied with `aria-describedby`

Repo `/home/jody/github/serene-pub`. Supervisor: lane `ss-5`. Paths under `src/lib/client/components/`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout` / `restore`; never `prettier --write` (nor a scratch-copy equivalent). No server file,
no SDK file.

## Goal

The server is about to send the session's **owner** settings a layer above has locked (today only admins get
them), as fields with `editable: false` and a `readOnlyReason` such as *Set by the session's preset.* or *Set by
the session's genre.* The client already draws read-only fields as words. Make every surface that draws a
session setting row say the read-only value as words (never a disabled control) with the reason on its own line,
the reason carrying an id, and the value naming that id in `aria-describedby`. No new copy: the reason text is the
server's `readOnlyReason`, drawn as is.

## Build

1. `sessionForms/SessionSettingField.svelte` (read-only branch ~124–134): the reason `<p>` gets
   `id="{id}-reason"`; the value element (the `<p>` and the JSON `<pre>`) gets
   `aria-describedby="{id}-reason"` when `field.readOnlyReason` is present (omit the attribute otherwise). Keep
   `aria-labelledby` and the testids.
2. `sessionForms/SpeechSettingsBlock.svelte`: the same in each read-only branch: `voiceField` snippet (~160–164),
   Read aloud (~190–191), What is read (~221–222). **Language** (~305–340) today draws a `disabled` input when
   `!language.editable`: give it a read-only branch instead, the value as words (the code, or *Empty: the pub's
   default* is NOT to be invented: show the stored code, or nothing in the value line when empty) plus the
   reason line with the same id/aria wiring; the editable branch stays exactly as it is (drop only
   `|| !language.editable` from its `disabled`). Use `fieldDomId(f)` for ids, as the file already does.
3. `sessionForms/SessionRoutineRow.svelte` (~132–140): the read-only mode value `<p>` gets
   `aria-describedby` naming the reason `<p>`, which gets an id from `fieldDomId(modeField)` + `-reason`.
4. `sessionPage/TurnPicker.svelte` draws the narrator cadence through `SessionSettingField` (~174–182): nothing to
   change there; confirm it in your report.
5. Header comment of `sessionForms/SessionSettingsForm.svelte` (~14–18) says an owner sees "nothing a layer
   above locked": change that sentence to say an owner sees a locked setting read-only with the layer's reason,
   as an administrator does. Comment only.
6. **DOM tests** (extend the existing files; follow their mounting pattern):
   - `sessionForms/sessionSettingsForm.dom.test.ts`: viewer `owner`, a genre field and a pipeline field with
     `editable: false`, `lockedAt: "preset"` / `"genre"` and the reasons above: no `input`, `select`, `button`
     or `[role=switch]` inside that field's `[data-setting]`; the value text and the reason text are shown; the
     value element's `aria-describedby` equals the reason element's `id`. A routine whose mode field is
     read-only: the same wiring.
   - `sessionForms/SpeechSettingsBlock.dom.test.svelte.ts`: a locked Language and a locked Read aloud: words, no
     `input`/`button`, reason shown, wiring as above.
   - `sessionPage/turnPickerCadence.dom.test.svelte.ts`: a locked cadence field: words, reason, wiring.
7. **Run, only this way, one run at a time** (other lanes run vitest too — wait first):
   ```
   until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
   cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-5-w2-<n>.log 2>&1"
   ```
   Never pipe vitest into `head`. A failing assertion on a happy-dom element has OOM-killed VS Code: keep the
   run capped as above and assert on strings/attributes, not whole elements. Files: the three test files above.
   Then `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx svelte-check --threshold error 2>&1 | grep -E "SessionSettingField|SpeechSettingsBlock|SessionRoutineRow|SessionSettingsForm|sessionSettingsForm.dom|turnPickerCadence"`
   must print nothing (if `svelte-check` directly is awkward, `npm run check` and grep the same names).

## Files owned

`sessionForms/SessionSettingField.svelte`, `sessionForms/SpeechSettingsBlock.svelte`,
`sessionForms/SessionRoutineRow.svelte`, `sessionForms/SessionSettingsForm.svelte` (comment only), and the three
test files above. Read anything.

## Rules your work depends on (quoted)

- STYLE-GUIDE §6.17 / ~2166: "**Read-only** is the value's name plus [the reason] …, never a disabled control
  (§6.11)." and ~1593: "A read-only value is shown as words, never as a disabled tick."
- STYLE-GUIDE ~1061: "a disabled control's reason is a 12px muted line it names in `aria-describedby`." (Here: the
  value's reason, named the same way.) Reason lines keep `text-surface-600-400 text-xs`.
- Cold review: "Read-only is words, never a disabled control … Give the cause line an id and tie it to the value
  with `aria-describedby`."
- CLAUDE.md: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no
  `navigator.clipboard`." · "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` /
  `SvelteMap`." · "Do what was asked, at the size asked. Findings … under **Noticed, not done**."
- No new user-visible words. If a surface seems to need one, stop and say so in your report.

## Out of scope

Any server file; the start form (`StartSessionForm` and its parts); the Pipelines card; envoy voices' editable
pickers; restyling.

## Report

Write `/home/jody/github/serene-pub/plans/REPORT-ss-5-w2-2026-11-16.md` (status question line; changed files with
line ranges; tests with pass counts and log paths; svelte-check result; prettier `--check` per file; Noticed, not
done). Under 400 words.
