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
	import { setContext } from "svelte"
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"
	import { WIDGET_REQUESTS_KEY, type WidgetRequestHandler } from "$lib/shared/widgets/context"
	import { guardWidgetRequests } from "$lib/client/components/sessionPage/requests/askers"
	import { answerFilePick } from "$lib/client/components/sessionPage/requests/filePick"
	import { answerFileSave } from "$lib/client/components/sessionPage/requests/fileSave"

	// A plugin page has no session to answer for it, but it still owns the
	// two requests that are about the extension itself: choosing a file for it
	// and saving one from it (M0). Everything else is refused.
	setContext<WidgetRequestHandler>(
		WIDGET_REQUESTS_KEY,
		guardWidgetRequests((async (kind: string, params: unknown, from: { owner: string }) =>
			kind === "file-pick"
				? answerFilePick(params as never, from)
				: kind === "file-save"
					? answerFileSave(params as never, from)
					: Promise.reject(new Error(`'${String(kind)}' is not something this page answers`))) as never)
	)

	// The first path segment is the plugin id (a dotted slug, never slashed);
	// the src is resolved server-side in the load, so a page that does not
	// exist renders the not-found state rather than a broken frame.
	const data = $derived(page.data as { src?: string; title?: string })
</script>

{#if data.src}
	<div class="h-screen w-screen">
		<!-- 🚧 M2c: a plugin page holds the `ui` API only — no session, and it is not an applet. -->
		<PluginFrame
			src={data.src}
			title={data.title ?? "Extension"}
			surface="page"
			apis={["ui"]}
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
