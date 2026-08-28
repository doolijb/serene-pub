<script lang="ts">
	/**
	 * System settings — the instance-wide configuration page. The form itself
	 * is `SystemSettingsTab`, the same component the Settings sidebar's System
	 * tab renders (one source of truth for the fields and their save flows).
	 * The tab already groups each setting into its own card, so the page adds
	 * no wrapper — it only reflows those cards into multiple columns as the
	 * content pane widens (CSS multi-column on the tab's own stack; container
	 * query on the pane, never the viewport).
	 */
	import * as Icons from "@lucide/svelte"
	import SystemSettingsTab from "$lib/client/components/settingsTabs/SystemSettingsTab.svelte"
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
	<SystemSettingsTab />
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
