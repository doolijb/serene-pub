<script lang="ts">
	/**
	 * One pipeline's run receipts (22 §2.4): the honest answer to "did that
	 * use the pipeline". A halt is not a failure — an aborted generation and
	 * an empty completion both halt, with the reason recorded — so outcomes
	 * filter as chips rather than hiding behind search. Clicking a row opens
	 * the run inspector under it; node keys appear there because this surface
	 * may name topology (05 §0a).
	 */
	import * as Icons from "@lucide/svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import RetrievalPanel from "./RetrievalPanel.svelte"
	import SessionUsagePanel from "./SessionUsagePanel.svelte"
	import RunInspector from "$lib/client/components/pipelines/inspector/RunInspector.svelte"
	import { onMount } from "svelte"

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

	/* ── outcome cut ────────────────────────────────────────────────── */

	let outcomeFilter = $state<string | null>(null)
	const outcomes = $derived([...new Set(runs.map((r) => r.outcome))].sort())
	const filtered = $derived(
		outcomeFilter ? runs.filter((r) => r.outcome === outcomeFilter) : runs
	)

	/* ── the receipt ────────────────────────────────────────────────── */

	/**
	 * Which receipt is open. The inspector fetches it — this panel holds only
	 * the address, so the list and the reader do not each ask for the same run.
	 */
	let openRunId = $state<string | null>(null)
	/** The open run's session, learned from the read the inspector made. */
	let openSessionId = $state<number | null>(null)

	function showRun(r: Run) {
		openRunId = openRunId === r.runId ? null : r.runId
		openSessionId = openRunId ? r.sessionId : null
	}

	onMount(() => {
		/**
		 * `?run=<runId>` — the receipt somebody was sent to, opened.
		 *
		 * Read here rather than by the route because the receipt is fetched by
		 * run id: the run does not have to be in `runs` for the link to land,
		 * so a media gallery can hand over a run from a spec whose list this
		 * panel is not currently showing. Applied once, on mount, and left in
		 * the URL — the route's own mirror rewrites `tab`, `step` and `config`
		 * and preserves everything else, so the link stays shareable.
		 */
		const wanted =
			typeof window !== "undefined"
				? new URLSearchParams(window.location.search).get("run")
				: null
		if (wanted) openRunId = wanted
	})

	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString() : "—"

	const runColumns: AdminColumn<Run>[] = [
		{ key: "startedAt", label: "When", value: (r) => r.startedAt },
		// Whose run: the list holds every user's runs (R55).
		{ key: "username", label: "User", value: (r) => r.username ?? "" },
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
		},
		{
			// What the run left behind. A count rather than a list: the row is
			// a summary and the receipt below it is where the detail belongs —
			// but "produced nothing" and "produced four things" are the fact
			// this column exists to separate, and the old single message id
			// showed neither.
			key: "artifacts",
			label: "Made",
			value: (r) => r.artifacts.length,
			class: "text-right"
		}
	]
</script>

{#if outcomes.length > 1}
	<div class="flex flex-wrap items-center gap-1.5">
		{#each outcomes as o (o)}
			<button
				class="chip rounded-full px-2.5 py-1 text-xs {outcomeFilter ===
				o
					? 'preset-tonal-primary'
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
		{:else if col.key === "username"}
			{r.username ?? "—"}
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
		{:else if col.key === "artifacts"}
			{r.artifacts.length || "—"}
		{/if}
	{/snippet}
</AdminList>

{#if openRunId}
	<section
		class="panel-card flex flex-col gap-2"
		aria-label="Run receipt"
	>
		<div class="flex items-baseline gap-2">
			<h4 class="text-sm font-semibold">Receipt</h4>
			<span class="flex-1"></span>
			<button
				class="btn btn-sm preset-tonal-surface"
				onclick={() => (openRunId = null)}
			>
				<Icons.X size={13} /> Close
			</button>
		</div>

		<RunInspector
			runId={openRunId}
			onLoaded={(run) => (openSessionId = run.sessionId)}
		/>

		<!-- The candidate-level half of the same receipt. The inspector says
		     which nodes ran; this says what they decided about each entry,
		     which is the question the step rows cannot answer (design §9). -->
		<RetrievalPanel runId={openRunId} />
		<!-- And the same question asked of the whole session rather than of
		     this turn: which entries have ever reached a prompt here. A
		     decision belongs to a run, so it cannot be answered from the
		     receipt above — but a reader looking at one receipt is exactly the
		     person asking. -->
		<SessionUsagePanel sessionId={openSessionId} />
	</section>
{/if}
