<script lang="ts">
	/**
	 * One connection's dedicated change page. The editor is the Connections
	 * sidebar component (one source of truth for the per-adapter forms),
	 * deep-linked to this row through `initialConnectionId`.
	 *
	 * A prop, not `panelsCtx.digest.connectionId`, which is what this page
	 * seeded before: the digest is one shared slot, and the shell keeps an
	 * opened Connections view MOUNTED while it is hidden, so that copy could
	 * consume the seed first and this page would draw the index instead of the
	 * row. A prop is addressed to the copy on this page.
	 */
	import { page } from "$app/state"
	import * as Icons from "@lucide/svelte"
	import ConnectionsSidebar from "$lib/client/components/sidebars/ConnectionsSidebar.svelte"

	let id = $derived(Number(page.params.id))
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/connections" class="hover:underline">Connections</a>
			/
			<strong>#{id}</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Cable size={20} /> Edit connection
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/connections">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

{#key id}
	<div class="form-max card preset-filled-surface-100-900 p-3 shadow-sm">
		<ConnectionsSidebar initialConnectionId={id} />
	</div>
{/key}

<style>
	.form-max {
		max-width: 56rem;
	}
</style>
