<script lang="ts">
	/**
	 * Force-enables Document View if someone lands on a /document-view/* URL
	 * directly (bookmark, shared link, typed URL) without ever pressing the
	 * shortcut first. The root layout already wraps this route in
	 * AccessibleShell purely based on the URL (see its showAccessibleShell),
	 * so this doesn't affect what renders right now — it's what makes the
	 * preference persist (localStorage) and the redirect-on-reload effect
	 * behave correctly on the *next* load, when the URL might not start
	 * under /document-view on its own.
	 */
	import { browser } from "$app/environment"
	import {
		isAccessibilityEnabled,
		enableAccessibility
	} from "$lib/client/accessibility/state.svelte"
	import type { Snippet } from "svelte"

	interface Props {
		children?: Snippet
	}
	let { children }: Props = $props()

	if (browser && !isAccessibilityEnabled()) {
		enableAccessibility()
	}
</script>

{@render children?.()}
