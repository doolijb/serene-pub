# REPORT — read-only audit of connections / models, speech, images, the admin shell, plugins (programme 0.8, 2026-11-16)

Every finding confirmed by reading both sides. Ranked.

1. **Images: Test Generation works only on the connection the Images loadout points at** (`sockets/images.ts`
   168–191; the form sends no model, `client/connectionForms/ImageConnectionForm.svelte` 188–196). An admin with
   two image connections cannot test the second without repointing the pub's Images loadout. → D25.
2. **Admin › Network "Copy link" uses `navigator.clipboard` unguarded** (`client/admin/sections/network/Page.svelte`
   313–317): on plain-http LAN it throws and shows nothing. Guarded pattern: `SupportReportCard.svelte:95`.
3. **Plugin user settings: a failed save can be wiped and reported as saved** when another plugin's save succeeds
   after it (`client/components/settingsTabs/PluginUserSettingsCard.svelte` 38–57: any list reply clears every
   draft, and all errors at `pending === 0`; the server answers a failed write on `:set:error`,
   `sockets/plugins.ts` 1453–1478).
4. **Deleting the audio.cpp row from Admin › Models › Connections leaves audio.cpp on and the row returns**
   (`client/admin/sections/connections/connectionsAdmin.ts` 122–142 `managerFlagsReleased` handles only
   `koboldcpp_managed` and `ollama`; the Connections view's own Remove switches it off,
   `ConnectionsSidebar.svelte` 568–570). Same gap: `lastOfType("koboldcpp_managed")` ignores
   `koboldcpp_managed_image`.
5. **Any signed-in member can read the sampling map**: `samplingConfigs:usedBy` has no admin check
   (`sockets/samplingConfigs.ts` 302–315); only admin views call it. Breaks "members never see sampling".
6. **Docs:** `docs/connections.md:582` says the managed KoboldCPP reload waits "up to ten minutes"; managed mode
   waits 30 (`koboldcpp/managedPreflight.ts` 302–305; `modelManager.ts` 623 / 692 / 747 / 845).
7. **Dead columns** `system_settings.lock_connection`, `lock_sampling_config`, `lock_context_config`,
   `lock_prompt_config` (`db/schema.ts` 4275–4290): carried by the attic, read by nothing. For the RC1 squash.

Found sound: admin gates on every connections / models / loadouts / audio.cpp / workflows / plugins handler; API
keys never leave the server; socket wiring (no orphan emit or listener; scoped events carry their key; no bare
`socket.off`); reactivity and toasts; file-serving routes; plugin frame and fetch boundaries; audio.cpp and
KoboldCPP settings all read; images and plugins docs; no other product's name in these areas.
