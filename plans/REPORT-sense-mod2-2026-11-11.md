# REPORT — lane `sense-mod2` — 2026-11-11

Written by the lead from the supervisor's final message.

## Built

- `src/routes/document-view/koboldcpp/+page.svelte`: in Managed mode the Server URL is words (the stored address,
  `koboldCppSettingsCtx.settings.koboldCppManagerBaseUrl`, with a hint), no input and no **Save URL**. External mode
  and Not configured keep the editable form. No third spelling of the address.
- `src/lib/client/components/connections/SetupChatFlow.svelte`, `sidebars/ModelsSidebar.svelte`: the unused
  `onChooseJobModel` prop is gone; no caller remains in `src/`.
- Tests: `document-view/koboldcpp/koboldcppPage.dom.test.svelte.ts` (two new), `setupChatFlow.dom.test.svelte.ts`
  (the "never writes Reply" check is now "no `connections:setDefault` emit"), `setupChatFlow.ssr.test.ts`.

## Tests

Capped run, 3 files, **21/21 passed**. `tsc` and `check` left to the grouped verification.

## Open ★

1. Hint copy 🚧. The settings tab's "Follows the port below." would be false on this page (it has no Port field).
   Used: _"Follows the port. Change the port in KoboldCPP's settings in the usual interface."_ Alternatives: just
   "Follows the port.", or a Port field on this page (a new control).

## Noticed, not done

- `KoboldCppSettingsTab.svelte:738` still spells `http://localhost:{port}` by hand; it could show the stored address as this page now does.
- Pre-existing prettier warnings on lines the lane did not touch.
