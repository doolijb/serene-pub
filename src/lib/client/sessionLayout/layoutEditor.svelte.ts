/**
 * Bridge between the shell (Header, Layout) and SessionLayout, which are
 * siblings under `<main>` rather than parent and child — nothing the session
 * page could `setContext` would ever reach the header, so a module-level
 * `$state` singleton is the simplest bridge, exactly as
 * mobileSidePanels.svelte.ts already bridges the same two subtrees.
 *
 * Two things cross, both one-way:
 *
 *  - the header's "Layout" button ASKS for the editor (`requests`), which is
 *    the one way in at every width;
 *  - SessionLayout answers, and says whether the DESKTOP grid editor is open
 *    (`open`) — while it is, its toolbar owns the header's band, so the shell
 *    takes the session header and the Jump pill out of it.
 */
export const layoutEditor = $state({
	/** True while the DESKTOP grid editor is open: the shell hides the session header and the Jump pill. */
	open: false,
	/** Bumped by the header's Layout button; SessionLayout toggles the editor on each change. */
	requests: 0
})

/** The header's Layout button: ask the open session to toggle its editor. */
export function requestLayoutEditor() {
	layoutEditor.requests++
}
