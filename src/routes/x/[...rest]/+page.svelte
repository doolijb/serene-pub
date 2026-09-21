<script lang="ts">
	/**
	 * The plugin page dispatch route (20 §12): `/x/<pluginId>` mounts an
	 * enabled plugin's declared `page` surface as a full-window
	 * opaque-origin frame. The route existing in the app skeleton is what lets
	 * a compile-time-routed SvelteKit app host plugin pages at all — a plugin
	 * cannot add routes to a built app, so one catch-all resolves them at
	 * runtime against the surface registry.
	 */
	import { page } from "$app/state"
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"

	// The first path segment is the plugin id (a dotted slug, never slashed);
	// the src is resolved server-side in the load, so a page that does not
	// exist renders the not-found state rather than a broken frame.
	const data = $derived(page.data as { src?: string; title?: string })
</script>

{#if data.src}
	<div class="h-screen w-screen">
		<PluginFrame
			src={data.src}
			title={data.title ?? "Extension"}
			surface="page"
		/>
	</div>
{:else}
	<div
		class="flex h-screen w-screen flex-col items-center justify-center gap-2 text-center"
	>
		<p class="text-lg font-semibold">Extension page not found</p>
		<p class="text-surface-600-400 text-sm">
			This extension may be disabled, or declares no page here.
		</p>
	</div>
{/if}
