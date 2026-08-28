<script lang="ts">
	/**
	 * The new-connection page: the Connections panel with its create flow
	 * opened immediately (`startNew`).
	 */
	import * as Icons from "@lucide/svelte"
	import ConnectionsSidebar from "$lib/client/components/sidebars/ConnectionsSidebar.svelte"
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/connections" class="hover:underline">Connections</a>
			/ <strong>New</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Cable size={20} /> New connection
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/connections">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

<div
	class="form-max card preset-tonal p-3 shadow-sm"
>
	<ConnectionsSidebar startNew />
</div>

<style>
	.form-max {
		max-width: 56rem;
	}
</style>
