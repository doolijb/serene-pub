<script lang="ts">
	/**
	 * Marks Document View active for this load if someone lands on a
	 * /document-view/* URL directly (bookmark, shared link, typed URL).
	 *
	 * The root layout already wraps this route in AccessibleShell purely from
	 * the URL (its showAccessibleShell), so this changes nothing about what
	 * renders here. What it does cover is the pre-auth login screen, which has
	 * no route to key off and reads the flag directly (showAccessibleLogin) —
	 * so someone following a shared /document-view/* link while signed out
	 * still gets AccessibleLoginForm rather than the standard one.
	 *
	 * Deliberately activateForSession() and NOT enableAccessibility(): this
	 * used to persist the preference to localStorage, which meant arriving
	 * here by any means at all — including the /document-view/help link inside
	 * the in-app docs — silently made Document View that browser's permanent
	 * default, with the only off-switch buried in Document View's own
	 * settings page. Persisting is now reserved for the explicit entry points.
	 */
	import { browser } from "$app/environment"
	import { activateForSession } from "$lib/client/accessibility/state.svelte"
	import type { Snippet } from "svelte"

	interface Props {
		children?: Snippet
	}
	let { children }: Props = $props()

	if (browser) activateForSession()
</script>

{@render children?.()}
