<script lang="ts">
	/**
	 * A run in flight, with a way to stop it.
	 *
	 * Text generation reports itself by arriving a token at a time — the streaming
	 * IS the progress. An image arrives all at once after a minute of nothing, so
	 * without this there is a button that appears to do nothing, no way to tell a
	 * slow render from a hung one, and no way to call it off.
	 *
	 * Nothing here is image-specific. It renders a `RunProgress`, which is what
	 * any long job reports, so a graph build or a summarize pass gets the same
	 * card by emitting the same events.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { runProgress } from "$lib/client/stores/runProgress.svelte"

	interface Props {
		sessionId: number
	}
	let { sessionId }: Props = $props()

	const socket = useTypedSocket()
	const runs = $derived(runProgress.forSession(sessionId))

	function cancel(runId: string) {
		socket.emit("pipelines:cancelRun", { runId })
		// Not cleared here: the run is asked to stop, and the card stays until
		// the server says it did. Clearing on click would claim it worked before
		// anything confirmed it, and a render that ignores the abort would leave
		// the person believing they stopped it.
	}

	const preview = (r: (typeof runs)[number]) =>
		r.preview ? `data:${r.preview.mime};base64,${r.preview.base64}` : null
</script>

{#each runs as run (run.runId)}
	<div
		class="border-surface-500/25 bg-surface-100-900 mb-2 rounded-lg border p-2 shadow-sm"
	>
		<div class="flex items-center gap-2">
			<Icons.Loader2
				size={14}
				class="text-primary-500 shrink-0 animate-spin"
			/>
			<div class="min-w-0 flex-1">
				<div class="flex items-baseline justify-between gap-2">
					<span class="truncate text-sm font-medium">
						{run.label ?? "Working"}
					</span>
					<span
						class="text-muted-foreground shrink-0 text-xs capitalize"
					>
						{#if run.stage}{run.stage}{/if}
						{#if run.percent != null}
							· {Math.round(run.percent)}%
						{/if}
						{#if run.step != null && run.steps != null}
							· {run.step}/{run.steps}
						{/if}
					</span>
				</div>
				<div
					class="bg-surface-500/20 mt-1 h-1.5 w-full overflow-hidden rounded-full"
				>
					<!-- No percentage means the job cannot say — a pulsing full bar
					     reads as "working", where a 0% bar reads as "stuck". -->
					<div
						class="bg-primary-500 h-full transition-all duration-300"
						class:animate-pulse={run.percent == null}
						style="width: {run.percent ?? 100}%"
					></div>
				</div>
			</div>
			<button
				type="button"
				class="btn btn-sm preset-tonal-error shrink-0"
				onclick={() => cancel(run.runId)}
				title="Stop this run"
			>
				<Icons.X size={14} />
			</button>
		</div>

		{#if run.message}
			<p class="text-muted-foreground mt-1 pl-6 text-xs">{run.message}</p>
		{/if}

		{#if preview(run)}
			<!-- The partially-denoised frame. Transient by construction: it is
			     shown and never stored, so there is nothing to clean up. -->
			<img
				src={preview(run)}
				alt="Preview of the image being generated"
				class="border-surface-200-700 mt-2 h-auto w-full rounded border"
			/>
		{/if}
	</div>
{/each}
