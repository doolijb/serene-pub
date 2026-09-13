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
	 *
	 * ⚠ **This is where the events are taken off the wire**, and it used not to
	 * be anywhere: the server emitted `pipelines:runStarted` and
	 * `pipelines:progress`, the store had an `apply` for them, and nothing in
	 * the client ever called it. Every card this component can draw was
	 * invisible. The subscription belongs to the one component that renders them
	 * rather than to a global listener, so nothing accumulates for a screen with
	 * no session on it.
	 */
	import { onDestroy } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { runProgress } from "$lib/client/stores/runProgress.svelte"
	import { runInspector } from "$lib/client/stores/runInspector.svelte"
	import type { RunProgress } from "$lib/shared/sockets/progress"

	interface Props {
		sessionId: number
	}
	let { sessionId }: Props = $props()

	const socket = useTypedSocket()
	const runs = $derived(runProgress.forSession(sessionId))

	/**
	 * The run that just ended, so its receipt is still one click away.
	 *
	 * The store drops a run on its terminal event — there is nothing left to
	 * show about it — and that event is the only moment this card can learn
	 * the run is over. Caught here, before `apply` forgets it. One run, the
	 * most recent: the card is about what is happening now, and a list of
	 * every turn's receipt is what the runs panel is for.
	 */
	let lastFinished = $state<{
		runId: string
		title: string
		outcome: string
	} | null>(null)

	const onRunStarted = (event: RunProgress) => {
		if (event.sessionId === sessionId) lastFinished = null
		runProgress.apply(event)
	}

	const onProgress = (event: RunProgress) => {
		if (event.done || event.error) {
			const known = runProgress.get(event.runId)
			if ((event.sessionId ?? known?.sessionId) === sessionId)
				lastFinished = {
					runId: event.runId,
					title: title(known ?? event),
					outcome: event.cancelled
						? "stopped"
						: event.error
							? "failed"
							: "finished"
				}
		}
		runProgress.apply(event)
	}

	socket.on("pipelines:runStarted", onRunStarted)
	socket.on("pipelines:progress", onProgress)
	onDestroy(() => {
		// Named handlers, always: `off(event)` with no handler removes every
		// listener on that event, app-wide.
		socket.off("pipelines:runStarted", onRunStarted)
		socket.off("pipelines:progress", onProgress)
	})

	function cancel(runId: string) {
		socket.emit("pipelines:cancelRun", { runId })
		// Not cleared here: the run is asked to stop, and the card stays until
		// the server says it did. Clearing on click would claim it worked before
		// anything confirmed it, and a render that ignores the abort would leave
		// the person believing they stopped it.
	}

	const preview = (r: (typeof runs)[number]) =>
		r.preview ? `data:${r.preview.mime};base64,${r.preview.base64}` : null

	// A label is an identifier the server already had ("respond",
	// "adventure-look"), not copy somebody wrote. Spacing it out here is one
	// place rather than one per emitter.
	const title = (r: (typeof runs)[number]) =>
		(r.label ?? "Working").replace(/[-_]/g, " ")
</script>

{#if lastFinished && !runs.length}
	<!-- The receipt, while the answer to "what did that just do" is still the
	     question being asked. -->
	<div
		class="border-surface-500/25 bg-surface-100-900 mb-2 flex items-center gap-2 rounded-lg border p-2 shadow-sm"
	>
		<Icons.Check size={14} class="text-success-500 shrink-0" />
		<span class="min-w-0 flex-1 truncate text-sm capitalize">
			{lastFinished.title}
			<span class="text-muted-foreground text-xs lowercase">
				{lastFinished.outcome}
			</span>
		</span>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface shrink-0"
			onclick={() => runInspector.open(lastFinished!.runId)}
			title="See what this run did, stage by stage"
		>
			<Icons.Receipt size={14} /> Inspect
		</button>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface shrink-0"
			onclick={() => (lastFinished = null)}
			aria-label="Dismiss"
		>
			<Icons.X size={14} />
		</button>
	</div>
{/if}

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
					<span class="truncate text-sm font-medium capitalize">
						{title(run)}
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
