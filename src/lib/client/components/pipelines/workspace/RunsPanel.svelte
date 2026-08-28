<script lang="ts">
	/**
	 * One pipeline's run receipts (22 §2.4): the honest answer to "did that
	 * use the pipeline". A halt is not a failure — an aborted generation and
	 * an empty completion both halt, with the reason recorded — so outcomes
	 * filter as chips rather than hiding behind search. Clicking a row fetches
	 * the full receipt; node keys appear there because this surface may name
	 * topology (05 §0a).
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import { onDestroy, onMount } from "svelte"

	type Run = Sockets.Pipelines.Runs.Response["runs"][number]

	interface Props {
		runs: Run[]
		loading: boolean
		/** Distinguishes this list's persisted view from the browser's. */
		storageKey?: string
	}

	let {
		runs,
		loading,
		storageKey = "serene-pub:adminView:pipelineDetailRuns"
	}: Props = $props()

	const socket = useTypedSocket()

	/* ── outcome cut ────────────────────────────────────────────────── */

	let outcomeFilter = $state<string | null>(null)
	const outcomes = $derived([...new Set(runs.map((r) => r.outcome))].sort())
	const filtered = $derived(
		outcomeFilter ? runs.filter((r) => r.outcome === outcomeFilter) : runs
	)

	/* ── the receipt ────────────────────────────────────────────────── */

	let openRun = $state<Sockets.Pipelines.Run.Response["run"] | null>(null)
	let openRunLoading = $state(false)
	const onRunDetail = (res: Sockets.Pipelines.Run.Response) => {
		openRunLoading = false
		if (res.run) openRun = res.run
		else if (res.error) toaster.error({ title: res.error })
	}
	function showRun(r: Run) {
		if (openRun?.runId === r.runId) {
			openRun = null
			return
		}
		openRunLoading = true
		socket.emit("pipelines:run", { runId: r.runId })
	}

	onMount(() => {
		socket.on("pipelines:run", onRunDetail)
		socket.on("pipelines:run:error", onRunDetail)
	})
	onDestroy(() => {
		socket.off("pipelines:run", onRunDetail)
		socket.off("pipelines:run:error", onRunDetail)
	})

	type ReceiptNode = {
		nodeKey: string
		seq: number
		kind: string
		result: string
		elapsedMs: number
		tokens?: number
		reason?: string
		iteration?: number
		cacheHit?: boolean
		blockChain?: string
	}
	const receiptNodes = $derived(
		((openRun?.receipt as any)?.nodes ?? []) as ReceiptNode[]
	)

	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString() : "—"

	const runColumns: AdminColumn<Run>[] = [
		{ key: "startedAt", label: "When", value: (r) => r.startedAt },
		{ key: "outcome", label: "Outcome", value: (r) => r.outcome },
		{
			key: "elapsedMs",
			label: "Time",
			value: (r) => r.elapsedMs,
			class: "text-right"
		},
		{
			key: "tokensSpent",
			label: "Tokens",
			value: (r) => r.tokensSpent,
			class: "text-right"
		}
	]
</script>

{#if outcomes.length > 1}
	<div class="flex flex-wrap items-center gap-1.5">
		{#each outcomes as o (o)}
			<button
				class="chip rounded-full px-2.5 py-1 text-xs {outcomeFilter === o
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				onclick={() => (outcomeFilter = outcomeFilter === o ? null : o)}
			>
				{o}
				<span class="opacity-70">
					{runs.filter((r) => r.outcome === o).length}
				</span>
			</button>
		{/each}
		{#if outcomeFilter}
			<button
				class="text-surface-600-400 text-xs underline"
				onclick={() => (outcomeFilter = null)}
			>
				clear
			</button>
		{/if}
	</div>
{/if}

<AdminList
	rows={filtered}
	columns={runColumns}
	{loading}
	searchText={(r) => `${r.outcome} ${r.haltReason ?? ""}`}
	searchPlaceholder="Search runs…"
	defaultSort="startedAt"
	defaultSortDir="desc"
	{storageKey}
	emptyMessage="No runs recorded for this pipeline yet."
	onRowClick={showRun}
>
	{#snippet cell(r, col)}
		{#if col.key === "startedAt"}
			<span class="whitespace-nowrap">{when(r.startedAt)}</span>
		{:else if col.key === "outcome"}
			{#if r.outcome === "ok"}
				<span class="text-success-500">ok</span>
			{:else}
				<span class="text-warning-500">{r.outcome}</span>
				{#if r.haltReason}
					<span class="text-surface-600-400 block text-xs">
						{r.haltReason}
					</span>
				{/if}
			{/if}
			{#if r.isPreview}
				<span class="text-surface-600-400 text-xs">(preview)</span>
			{/if}
		{:else if col.key === "elapsedMs"}
			<span class="whitespace-nowrap">{r.elapsedMs} ms</span>
		{:else if col.key === "tokensSpent"}
			{r.tokensSpent || "—"}
		{/if}
	{/snippet}
</AdminList>

{#if openRunLoading}
	<p class="text-surface-600-400 text-sm">Loading receipt…</p>
{:else if openRun}
	<section
		class="card preset-tonal flex flex-col gap-2 p-3"
		aria-label="Run receipt"
	>
		<div class="flex flex-wrap items-baseline gap-2">
			<h4 class="text-sm font-semibold">Receipt</h4>
			<span class="text-surface-600-400 font-mono text-xs">
				{openRun.runId}
			</span>
			<span class="flex-1"></span>
			<button
				class="btn btn-sm preset-tonal-surface"
				onclick={() => (openRun = null)}
			>
				<Icons.X size={13} /> Close
			</button>
		</div>
		{#if (openRun.receipt as any)?.compact}
			<p class="text-surface-600-400 text-xs">
				Compacted: this run halted before any effectful node, so the
				receipt keeps attribution only
				{#if (openRun.receipt as any)?.compactedNodeCount}
					({(openRun.receipt as any).compactedNodeCount} node rows
					dropped){/if}.
			</p>
		{/if}
		{#if receiptNodes.length}
			<div class="overflow-x-auto">
				<table class="w-full min-w-[560px] border-collapse text-xs">
					<thead>
						<tr
							class="text-surface-600-400 border-surface-300-700 border-b text-left text-[0.68rem] tracking-wider uppercase"
						>
							<th class="px-2 py-1.5">#</th>
							<th class="px-2 py-1.5">Node</th>
							<th class="px-2 py-1.5">Kind</th>
							<th class="px-2 py-1.5">Result</th>
							<th class="px-2 py-1.5 text-right">Time</th>
							<th class="px-2 py-1.5 text-right">Tokens</th>
							<th class="px-2 py-1.5">Notes</th>
						</tr>
					</thead>
					<tbody>
						{#each receiptNodes as nr (nr.seq)}
							<tr
								class="border-surface-300-700/50 border-b last:border-b-0"
							>
								<td
									class="text-surface-600-400 px-2 py-1.5 font-mono"
								>
									{nr.seq}
								</td>
								<td class="px-2 py-1.5 font-mono">
									{nr.nodeKey}{nr.iteration != null
										? ` [${nr.iteration}]`
										: ""}
								</td>
								<td class="text-surface-700-300 px-2 py-1.5">
									{nr.kind}
								</td>
								<td class="px-2 py-1.5">
									<span
										class={nr.result === "ok"
											? "text-success-500"
											: nr.result === "halt"
												? "text-warning-500"
												: "text-error-500"}
									>
										{nr.result}
									</span>
								</td>
								<td
									class="px-2 py-1.5 text-right whitespace-nowrap"
								>
									{nr.elapsedMs} ms
								</td>
								<td class="px-2 py-1.5 text-right">
									{nr.tokens ?? "—"}
								</td>
								<td
									class="text-surface-600-400 max-w-[24rem] truncate px-2 py-1.5"
									title={nr.reason}
								>
									{[
										nr.cacheHit ? "cache hit" : null,
										nr.reason ?? null
									]
										.filter(Boolean)
										.join(" · ") || "—"}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		<details>
			<summary
				class="text-surface-600-400 cursor-pointer text-xs select-none"
			>
				Raw receipt JSON
			</summary>
			<pre
				class="bg-surface-200-800 mt-2 max-h-96 overflow-auto rounded p-2 font-mono text-[11px]">{JSON.stringify(
					openRun.receipt,
					null,
					2
				)}</pre>
		</details>
	</section>
{/if}
