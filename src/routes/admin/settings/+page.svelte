<script lang="ts">
	/**
	 * System settings — the instance-wide configuration page, and since 28 the
	 * ONLY one. The Settings sidebar used to render this same component in a
	 * System tab; that tab is gone (the sidebar is per-user now), so nothing
	 * moved — the duplicate entry point simply went away.
	 * The tab already groups each setting into its own card, so the page adds
	 * no wrapper — it only reflows those cards into multiple columns as the
	 * content pane widens (CSS multi-column on the tab's own stack; container
	 * query on the pane, never the viewport).
	 */
	import * as Icons from "@lucide/svelte"
	import { beforeNavigate } from "$app/navigation"
	import SystemSettingsTab from "$lib/client/components/settingsTabs/SystemSettingsTab.svelte"

	let hasUnsavedChanges = $state(false)

	/**
	 * The sidebar tab guarded its buffered fields on tab switch and on close.
	 * With the tab gone this page is the only way to reach them, so the guard
	 * had to come with them — otherwise removing the tab would have quietly
	 * dropped the protection rather than relocating it.
	 *
	 * `confirm` rather than a modal, matching the pipelines editor's guard:
	 * beforeNavigate is synchronous, so an async dialog cannot cancel in time.
	 */
	beforeNavigate((nav) => {
		if (!hasUnsavedChanges) return
		if (!confirm("You have unsaved changes. Leave without saving?")) {
			nav.cancel()
		}
	})
</script>

<div class="mb-4">
	<h2 class="flex items-center gap-2 text-lg font-semibold">
		<Icons.Settings size={20} /> System settings
	</h2>
	<p class="text-surface-600-400 text-sm">
		Global configuration for this Serene Pub instance.
	</p>
</div>

<div class="settings-columns">
	<SystemSettingsTab bind:hasUnsavedChanges />
</div>

<style>
	/* The tab's root is a `flex flex-col gap-6` stack of setting cards. In a
	   wide pane, reflow it as CSS columns so the cards pack side by side —
	   display:block overrides the flex (higher specificity than the utility),
	   margins replace the flex gap, and each card refuses to split. */
	.settings-columns > :global(div) {
		display: block;
		column-gap: 1.5rem;
	}
	.settings-columns > :global(div) > :global(*) {
		break-inside: avoid;
		margin-bottom: 1.5rem;
	}
	@container content (min-width: 980px) {
		.settings-columns > :global(div) {
			columns: 2;
		}
	}
	@container content (min-width: 1560px) {
		.settings-columns > :global(div) {
			columns: 3;
		}
	}
</style>
