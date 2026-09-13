<script lang="ts">
	/**
	 * The inspector, over whatever the reader was looking at.
	 *
	 * Mounted once in the app shell and driven by `runInspector`, so a message
	 * menu and a finished progress card open the same surface without either
	 * screen owning a copy of it.
	 */
	import * as Icons from "@lucide/svelte"
	import { runInspector } from "$lib/client/stores/runInspector.svelte"
	import RunInspector from "./RunInspector.svelte"

	const runId = $derived(runInspector.runId)

	function onKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") runInspector.close()
	}
</script>

<svelte:window on:keydown={onKeydown} />

{#if runId}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Run inspector"
	>
		<div
			class="bg-surface-100-900 flex max-h-[88vh] w-full max-w-5xl flex-col gap-3 overflow-y-auto rounded-xl p-4 shadow-xl"
		>
			<div class="flex items-start gap-2">
				<Icons.Receipt size={20} class="mt-0.5 shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="font-semibold">What this run did</p>
					<p class="text-surface-600-400 text-xs">
						Every stage in the order it ran, and what each one was
						given and produced.
					</p>
				</div>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => runInspector.close()}
					aria-label="Close the run inspector"
				>
					<Icons.X size={14} />
				</button>
			</div>

			<RunInspector {runId} />
		</div>
	</div>
{/if}
