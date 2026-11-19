# REPORT — lane `clip-1` (2026-11-16): one guarded copy helper (programme 0.8b)

Saved by the lead from the supervisor's report. Built.

Helper: `src/lib/client/utils/copyText.ts`, 🚧 `copyText(text): Promise<boolean>`: `navigator.clipboard` only in
a secure context where it exists, else `execCommand("copy")` through a hidden textarea it always removes; never
throws. Tests `client/utils/copyText.dom.test.ts`.

Sites changed (14 copy functions, 13 files; each keeps its own messages and display): `SupportReportCard.svelte`,
`admin/sections/network/Page.svelte` (private `writeClipboard` removed); `InvitePanel.svelte`,
`TotpSettings.svelte` (had no guard and no failure message: now the existing *Could not reach the clipboard.
Select the text and copy it.*; both texts are on screen and selectable); `UserForm.svelte`,
`VersionsPanel.svelte`, `VoiceTryout.svelte`, `prompts/IdPage.svelte`, `users/UserChangeForm.svelte`,
`PipelineConfigOptions.svelte`, `routes/pipelines/library/+page.svelte`, `RunInspector.svelte` (two).
`VoiceTryout.dom.test.svelte.ts` stubs `isSecureContext`.

Guard: a second test in `shared/conformance/secureContext.test.ts`: no browser-reachable file uses
`navigator.clipboard` except `copyText.ts`. Deleted: `client/components/connections/JobSheetSampling.svelte`
(nothing referenced it). No SDK site.

Tests `plans/clip-1-2.log`: 20 of 21; the one failure is the comment check on
`pipelines/boot/sessionOverrideFold.ts:51` (lane ss-2a-fix's file). `npm run check` 0 errors.

Noticed, not done: `PipelineConfigOptions.copyArchived`'s comment says a red toast is not warranted, the code
shows one; failure wording differs between sites ("Copy failed" in `UserForm`, "Clipboard unavailable" in
`VersionsPanel`).
