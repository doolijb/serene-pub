<script lang="ts">
	/**
	 * 🚧 The Runs tab (lay-R, owner 2026-11-06): what pipelines ran in this
	 * session, newest first, for an administrator (R55 — the parent mounts it
	 * only for one). Steps open inline; Inspect opens the receipt modal.
	 *
	 * Reads are BARE (`pipelines:runs` / `pipelines:run` are not scoped), so a
	 * reply is kept only when it names this session / run. A failed read is one
	 * muted line here, never a toast.
	 */
	import { getContext, onMount, untrack } from "svelte"
	import { SvelteMap, SvelteSet } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import {
		SESSION_RUNS_FIRST,
		SESSION_RUNS_MOST,
		canShowMoreRuns,
		sessionRunRows,
		sessionRunStepRows,
		type SessionRunRow,
		type SessionRunStepRow
	} from "@serene-pub/core-catalog/session-runs"
	import MetaLine from "$lib/client/components/panels/MetaLine.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import {
		declareInterest,
		requestWithInterest
	} from "$lib/client/sockets/interest.svelte"
	import { runInspector } from "$lib/client/stores/runInspector.svelte"
	import {
		sessionRunOf,
		sessionRunStepsOf
	} from "$lib/client/components/sessionPage/requests/sessionRuns"

	let { sessionId }: { sessionId: number } = $props()

	const userCtx = getContext<{ user?: { id: number } } | undefined>("userCtx")
	const viewerId = $derived(userCtx?.user?.id ?? null)

	let runs = $state<Sockets.Pipelines.Runs.Response["runs"]>([])
	let loaded = $state(false)
	let readError = $state<string | null>(null)
	let limit = $state(SESSION_RUNS_FIRST)
	let now = $state(Date.now())

	let releaseRuns: (() => void) | null = null
	function askRuns(forSession: number, asked: number) {
		releaseRuns?.()
		limit = asked
		releaseRuns = requestWithInterest(
			"pipelines:runs",
			{ sessionId: forSession, limit: asked },
			(res) => {
				const r = res as Sockets.Pipelines.Runs.Response & {
					error?: string
				}
				if (r.sessionId !== undefined && r.sessionId !== forSession)
					return
				if (r.error) {
					readError = r.error
					loaded = true
					return
				}
				if (r.sessionId !== forSession) return
				readError = null
				runs = r.runs ?? []
				loaded = true
			}
		)
	}

	$effect(() => {
		const id = sessionId
		runs = []
		loaded = false
		readError = null
		untrack(() => open.clear())
		askRuns(id, SESSION_RUNS_FIRST)
		return () => {
			releaseRuns?.()
			releaseRuns = null
		}
	})

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 60_000)
		return () => {
			clearInterval(timer)
			for (const release of pending.values()) release()
			pending.clear()
		}
	})

	const rows = $derived(
		sessionRunRows(
			runs.map((r) => sessionRunOf(r, null)),
			viewerId,
			now
		)
	)

	const open = new SvelteSet<string>()
	const stepsOf = new SvelteMap<string, SessionRunStepRow[]>()
	const stepError = new SvelteMap<string, string>()
	const pending = new Map<string, () => void>()

	function askSteps(runId: string) {
		if (stepsOf.has(runId) || pending.has(runId)) return
		stepError.delete(runId)
		const done = () => {
			pending.get(runId)?.()
			pending.delete(runId)
		}
		// `pipelines:run:error` names no run: it ends the read that is waiting.
		const releaseError = declareInterest<"pipelines:run:error">(
			"pipelines:run:error",
			(res) => {
				stepError.set(
					runId,
					res?.error ?? "That run could not be read."
				)
				done()
			}
		)
		const release = requestWithInterest(
			"pipelines:run",
			{ runId },
			(res) => {
				if (res.run?.runId !== runId) return
				stepsOf.set(
					runId,
					sessionRunStepRows(sessionRunStepsOf(res.run.receipt))
				)
				done()
			}
		)
		pending.set(runId, () => {
			release()
			releaseError()
		})
	}

	function toggleSteps(runId: string) {
		if (open.has(runId)) {
			open.delete(runId)
			return
		}
		open.add(runId)
		askSteps(runId)
	}

	const metaOf = (r: SessionRunRow) => [
		r.startedBy,
		r.when,
		r.duration,
		r.tokens
	]
</script>

<!-- App chrome, not a widget: Tailwind classes, never `data-widget-part`
     (STYLE-GUIDE §6.16 parts are a session widget's, and a style written for
     the Runs widget must not reach the sidebar). The words are the widget's,
     from the one plain half (`@serene-pub/core-catalog/session-runs`). -->
<div class="flex min-h-0 flex-col gap-2 pt-3">
	<div class="flex justify-end">
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface min-h-11 sm:min-h-0"
			onclick={() => askRuns(sessionId, limit)}
		>
			<Icons.RefreshCw size={16} aria-hidden="true" />
			Refresh
		</button>
	</div>

	{#if readError}
		<p class="text-error-600-400 text-xs" role="alert">{readError}</p>
	{/if}

	{#if !loaded}
		<LoadingState message="Loading runs…" />
	{:else if rows.length === 0 && !readError}
		<EmptyState
			icon={Icons.Receipt}
			message="No runs in this session yet."
		/>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each rows as row (row.runId)}
				{@const isOpen = open.has(row.runId)}
				<li
					class="bg-surface-100-900 flex flex-col gap-1 rounded-lg p-3"
					class:ms-4={row.depth > 0}
					data-outcome={row.outcome}
				>
					<div
						class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1"
					>
						<span class="truncate text-sm font-medium">
							{row.pipeline}
						</span>
						<span
							class="text-xs {row.outcome === 'err'
								? 'text-error-600-400'
								: row.outcome === 'ok'
									? 'text-surface-600-400'
									: 'text-warning-600-400'}"
							data-run-outcome
						>
							{row.outcomeWords}
						</span>
						{#if row.preview}
							<span class="badge preset-tonal-surface text-xs">
								Preview
							</span>
						{/if}
					</div>
					<MetaLine items={metaOf(row)} />
					{#if row.stoppedAt}
						<p class="text-surface-600-400 text-xs break-words">
							{row.stoppedAt}
						</p>
					{/if}
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface min-h-11 sm:min-h-0"
							aria-expanded={isOpen}
							aria-controls="session-runs-steps-{row.runId}"
							onclick={() => toggleSteps(row.runId)}
						>
							<Icons.ListTree size={16} aria-hidden="true" />
							Steps
						</button>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface min-h-11 sm:min-h-0"
							onclick={() => runInspector.open(row.runId)}
						>
							<Icons.Search size={16} aria-hidden="true" />
							Inspect
						</button>
					</div>
					<div id="session-runs-steps-{row.runId}" hidden={!isOpen}>
						{#if isOpen}
							{#if stepError.has(row.runId)}
								<p
									class="text-error-600-400 text-xs"
									role="alert"
								>
									{stepError.get(row.runId)}
								</p>
							{:else if stepsOf.has(row.runId)}
								<ol
									class="border-surface-200-800 flex flex-col gap-1 border-t pt-2"
								>
									{#each stepsOf.get(row.runId) ?? [] as step (step.seq)}
										<li
											class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs"
											data-result={step.result}
										>
											<span
												class="font-mono"
												data-step-key
											>
												{step.key}
											</span>
											<span class="text-surface-600-400">
												{step.kind}
											</span>
											<span
												class={step.result ===
													"error" ||
												step.result === "err"
													? "text-error-600-400"
													: "text-surface-600-400"}
											>
												{step.result}
											</span>
											{#if step.reason}
												<span
													class="text-surface-600-400 break-words"
												>
													{step.reason}
												</span>
											{/if}
											<span class="text-surface-600-400">
												{step.duration}
											</span>
											{#if step.tokens}
												<span
													class="text-surface-600-400"
												>
													{step.tokens}
												</span>
											{/if}
										</li>
									{/each}
								</ol>
							{:else}
								<LoadingState message="Loading steps…" />
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if canShowMoreRuns(rows.length, limit)}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface min-h-11 self-start sm:min-h-0"
				onclick={() => askRuns(sessionId, SESSION_RUNS_MOST)}
			>
				Show more
			</button>
		{/if}
	{/if}
</div>
