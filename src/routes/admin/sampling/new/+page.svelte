<script lang="ts">
	/** The new-config page: the Sampling panel with its create flow opened. */
	import * as Icons from "@lucide/svelte"
	import SamplingSidebar from "$lib/client/components/sidebars/SamplingSidebar.svelte"
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/sampling" class="hover:underline">Sampling</a>
			/ <strong>New</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.SlidersHorizontal size={20} /> New sampling config
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/sampling">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

<div
	class="form-max card preset-tonal p-3 shadow-sm"
>
	<SamplingSidebar startNew />
</div>

<style>
	.form-max {
		max-width: 56rem;
	}
</style>
