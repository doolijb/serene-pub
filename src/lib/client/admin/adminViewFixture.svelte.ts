/**
 * 🚧 Fixture state for `adminView.dom.test.svelte.ts` (RF fix 2, item 5): the view
 * mode the stand-in `ViewModeTracker` reports, and how often the probe
 * section was mounted. Test-only; nothing in the app imports it.
 */
export const viewMode = $state({ value: "desk" as "desk" | "compact" })
export const probe = { mounts: 0 }
