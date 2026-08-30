<script lang="ts">
	/**
	 * One sampling config's dedicated change page: the Sampling panel
	 * component deep-linked to this row (`initialSelectedId`).
	 */
	import { page } from "$app/state"
	import * as Icons from "@lucide/svelte"
	import SamplingSidebar from "$lib/client/components/sidebars/SamplingSidebar.svelte"

	let id = $derived(Number(page.params.id))
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/sampling" class="hover:underline">Sampling</a>
			/ <strong>#{id}</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.SlidersHorizontal size={20} /> Edit sampling config
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/sampling">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

{#key id}
	<div
		class="form-max card preset-filled-surface-100-900 p-3 shadow-sm"
	>
		<SamplingSidebar initialSelectedId={id} />
	</div>
{/key}

<style>
	.form-max {
		max-width: 56rem;
	}
</style>
