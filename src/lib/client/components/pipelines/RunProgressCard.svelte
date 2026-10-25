<script lang="ts">
	import SpProgress from "$lib/client/components/hostElements/SpProgress.svelte"
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
	 * invisible. The interest belongs to the one component that renders them
	 * rather than to a global listener, so nothing accumulates for a screen with
	 * no session on it.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { runProgress } from "$lib/client/stores/runProgress.svelte"
	import { runInspector } from "$lib/client/stores/runInspector.svelte"
	import { getContext, untrack } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { statusText } from "$lib/client/i18n/state.svelte"
	import { outcomeOf, outcomeIcon, outcomeStatusText } from "./runOutcome"
	import { adminScreenSegments } from "./adminScreenLink"
	import type { RunProgress } from "$lib/shared/sockets/progress"
	import { receiptStands, runIsOnChannel } from "./runCardScope"
	import { actionRetryOf, rememberFiredAction } from "./actionRetry"
	import { v4 as uuid } from "uuid"

	interface Props {
		sessionId: number
		/**
		 * The channel of the conversation copy this card sits in — its
		 * composer's lane. Only that channel's runs are drawn
		 * (`runCardScope`); absent, every run of the session.
		 */
		channel?: string
		/** The newest row's id on `channel`: a newer one retires a receipt. */
		newestRowId?: number
		/**
		 * 🚧 A row on `channel` is generating, with its own Stop (2026-10-18,
		 * the 100-turn walk #28: a Rest drew four Stops at once — the waiting
		 * row's, the turn line's, this card's and the composer's). The card
		 * then says what is running and leaves stopping to that row.
		 */
		rowStops?: boolean
	}
	let { sessionId, channel, newestRowId = 0, rowStops = false }: Props = $props()
	// A receipt is an administrator's (R55): only they are offered Inspect.
	const userCtx: UserCtx | undefined = getContext("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)

	const socket = useTypedSocket()
	const runs = $derived(
		runProgress.forSession(sessionId).filter((r) => runIsOnChannel(r, channel))
	)

	/**
	 * The run that just ended, so its receipt is still one click away.
	 *
	 * The store drops a run on its terminal event — there is nothing left to
	 * show about it — and keeps what it knew as the session's `lastFinished`,
	 * which is read from THERE rather than caught here: the session page
	 * applies the same frames, and a card that read the store at its own
	 * turn found the run already gone and titled the receipt "Working"
	 * (2026-09-17). One run, the most recent: the card is about what is
	 * happening now, and a list of every turn's receipt is what the runs
	 * panel is for.
	 */
	const finishedRun = $derived(runProgress.lastFinished(sessionId))
	/**
	 * The receipt yields to what came after it (walkthrough 2026-10-15:
	 * "Rest finished" stood over the next turn): the newest row on this
	 * channel when the card first drew the receipt, and the receipt goes
	 * once a newer one lands. Only this channel's receipt is drawn.
	 */
	let seen = $state<{ runId: string; newestRowId: number } | null>(null)
	$effect(() => {
		const ended = finishedRun
		if (ended && seen?.runId !== ended.runId)
			seen = { runId: ended.runId, newestRowId: untrack(() => newestRowId) }
	})
	/**
	 * The runs this card has drawn in flight. A receipt is for a run the
	 * reader watched end here, never one that ended before the card drew
	 * (a reload, coming back to the page) — `receiptStands`.
	 */
	const inFlightSeen = new SvelteSet<string>()
	$effect(() => {
		for (const r of runs) if (!untrack(() => inFlightSeen.has(r.runId))) inFlightSeen.add(r.runId)
	})
	const lastFinished = $derived(
		finishedRun &&
			runIsOnChannel(finishedRun, channel) &&
			receiptStands(finishedRun, seen, newestRowId, inFlightSeen.has(finishedRun.runId))
			? finishedRun
			: undefined
	)

	/**
	 * The caption beside the title, which the `capitalize` class above
	 * already reads as "Respond" — `outcomeStatusText` (`./runOutcome`) is
	 * the locale map, this resolves it the same way a node's own status is
	 * (2026-09-16: a card that said "Respond finished ✓" on an errored run
	 * was reading `done` as success; every terminal frame now carries its
	 * own `outcome`, projected by `./runOutcome`, pinned there).
	 */
	const outcomeCaption = (f: RunProgress) =>
		statusText(outcomeStatusText(outcomeOf(f), f.haltStep))

	const onRunStarted = (event: RunProgress) => runProgress.started(event)
	const onProgress = (event: RunProgress) => runProgress.apply(event)

	/**
	 * Both pushes carry `sessionId`, so both are declared as SCOPED interest
	 * (`pipelines:runStarted#<id>`, `pipelines:progress#<id>`) — this card only
	 * ever draws its own session's runs, and the server has no reason to send
	 * it another one's.
	 *
	 * The `$effect` form rather than `useInterest`: the prop can be re-pointed
	 * at another session, and `useInterest` reads its key ONCE. Declaring here
	 * releases the old key as it takes the new one — keyed on `scopeId`, a
	 * `$derived` copy of the prop: a parent that hands the id down as
	 * `{session.id}` passes a getter over an object the session page replaces
	 * per streamed chunk, and an effect reading the prop directly would
	 * re-declare both keys per token (B8).
	 */
	const scopeId = $derived(sessionId)
	$effect(() =>
		declareInterest<"pipelines:runStarted">(
			interestKey("pipelines:runStarted", scopeId),
			onRunStarted
		)
	)
	$effect(() =>
		declareInterest<"pipelines:progress">(
			interestKey("pipelines:progress", scopeId),
			onProgress
		)
	)

	function cancel(runId: string) {
		socket.emit("pipelines:cancelRun", { runId })
		// Not cleared here: the run is asked to stop, and the card stays until
		// the server says it did. Clearing on click would claim it worked before
		// anything confirmed it, and a render that ignores the abort would leave
		// the person believing they stopped it.
	}

	/**
	 * 🚧 Fire a halted (or failed) action run's press again (2026-10-16): the
	 * same action and params, a new run id — kept too, so a second halt
	 * offers Retry again. The receipt goes; the new run draws its own card.
	 */
	function retry(ended: RunProgress) {
		const press = actionRetryOf(ended)
		if (!press) return
		const params = { ...press, runId: uuid() }
		rememberFiredAction(params)
		socket.emit("sessions:fireAction", params)
		runProgress.dismissFinished(sessionId)
	}

	const preview = (r: (typeof runs)[number]) =>
		r.preview ? `data:${r.preview.mime};base64,${r.preview.base64}` : null

	// A label is an identifier the server already had ("respond",
	// "adventure-look"), not copy somebody wrote. Spacing it out here is one
	// place rather than one per emitter.
	const title = (r: (typeof runs)[number]) =>
		(r.label ?? "Working").replace(/[-_]/g, " ")

	/**
	 * The run's own word for what it is doing (R-19) — *Jasmine is typing*,
	 * *summarising part 2 of 5* — in the reader's language. Shown in place
	 * of the stage name when the run has said one; the step count stays
	 * beside it as the secondary detail. The store merges frames, so a
	 * status once sent stands until the next.
	 */
	const status = (r: (typeof runs)[number]) => statusText(r.status)
</script>

{#if lastFinished && !runs.length}
	{@const ended = lastFinished}
	<!-- The receipt, while the answer to "what did that just do" is still the
	     question being asked. -->
	<div
		class="border-surface-500/25 bg-surface-100-900 mb-2 rounded-lg border p-2 shadow-sm"
	>
		<div class="flex items-center gap-2">
			{#if outcomeIcon(outcomeOf(ended)) === "check"}
				<Icons.Check size={14} class="text-success-500 shrink-0" />
			{:else if outcomeIcon(outcomeOf(ended)) === "ban"}
				<Icons.Ban size={14} class="text-surface-600-400 shrink-0" />
			{:else}
				<!-- `err` and `halt` alike — neither produced a reply, and a
				     check mark on either is the defect this fixes. -->
				<Icons.TriangleAlert size={14} class="text-error-600-400 shrink-0" />
			{/if}
			<span class="min-w-0 flex-1 truncate text-sm capitalize">
				{title(ended)}
				<span class="text-surface-600-400 text-xs lowercase">
					{outcomeCaption(ended)}
				</span>
			</span>
			{#if actionRetryOf(ended)}
				<button
					type="button"
					class="btn btn-sm preset-tonal-primary shrink-0"
					onclick={() => retry(ended)}
					title="Run this action again"
				>
					<Icons.RotateCcw size={14} /> Retry
				</button>
			{/if}
			{#if isAdmin}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface shrink-0"
					onclick={() => runInspector.open(ended.runId)}
					title="See what this run did, step by step"
				>
					<Icons.Receipt size={14} /> Inspect
				</button>
			{/if}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface shrink-0"
				onclick={() => runProgress.dismissFinished(sessionId)}
				aria-label="Dismiss"
			>
				<Icons.X size={14} />
			</button>
		</div>
		{#if ended.error}
			<!-- The reason, when the outcome carries one — never on `cancelled`,
			     whose frame carries none. Already redacted server-side
			     (`redactConnections`, applied at every `emitToUser`) — shown as
			     it arrived, and said here only: the page toasts a failure no
			     card is showing (D4). The screen it names (Admin › Models ›
			     Defaults, for a job with no model) is a link for an
			     administrator and text for a member (D1). One line, so no
			     whitespace lands between a segment and its link. -->
			<p class="text-surface-600-400 mt-1 pl-6 text-xs">
				<!-- prettier-ignore -->
				{#each adminScreenSegments(ended.error, { linked: isAdmin }) as seg, i (i)}{#if seg.href}<a class="anchor" href={seg.href}>{seg.text}</a>{:else}{seg.text}{/if}{/each}
			</p>
		{/if}
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
						class="text-surface-600-400 min-w-0 truncate text-xs"
						data-run-status={status(run) ? "" : undefined}
					>
						{#if status(run)}
							{status(run)}
						{:else if run.stage}
							<span class="capitalize">{run.stage}</span>
						{/if}
						{#if run.percent != null}
							· {Math.round(run.percent)}%
						{/if}
						{#if run.step != null && run.steps != null}
							· {run.step}/{run.steps}
						{/if}
					</span>
				</div>
				<!-- No percentage means the job cannot say: SpProgress draws its
				     indeterminate bar, pulsing, which reads as "working" where a 0%
				     bar reads as "stuck". -->
				<div class="text-primary-500 mt-1" class:animate-pulse={run.percent == null}>
					<SpProgress
						attrs={{
							value: run.percent == null ? null : String(run.percent),
							label: "Run progress"
						}}
					/>
				</div>
			</div>
			{#if !rowStops}
			<button
				type="button"
				class="btn btn-sm preset-tonal-error shrink-0"
				onclick={() => cancel(run.runId)}
				title="Stop this run"
				aria-label="Stop this run"
			>
				<Icons.X size={14} />
			</button>
			{/if}
		</div>

		{#if run.message}
			<p class="text-surface-600-400 mt-1 pl-6 text-xs">{run.message}</p>
		{/if}

		{#if preview(run)}
			<!-- The partially-denoised frame. Transient by construction: it is
			     shown and never stored, so there is nothing to clean up. -->
			<img
				src={preview(run)}
				alt="Preview of the image being generated"
				class="border-surface-200-800 mt-2 h-auto w-full rounded border"
			/>
		{/if}
	</div>
{/each}
