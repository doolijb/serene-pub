<script lang="ts">
	/**
	 * Admin › Writing › Variable layouts (W1): every variable a pipeline can
	 * write out, with the layout in use and why. One choice for the whole
	 * pub, made on a variable's own page. Read-only here: no Add, no bulk
	 * action. `?step=<pipeline>:<step>` narrows it to the variables one step
	 * writes out (the context template's **Change layouts** link).
	 */
	import { onMount } from "svelte"
	import { Braces } from "@lucide/svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import InlineError from "$lib/client/components/InlineError.svelte"
	import type {
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import {
		adminPage,
		adminRouter
	} from "$lib/client/admin/adminRouter.svelte"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import {
		requestTemplateVariableLayouts,
		templateVariableLayoutsOf
	} from "$lib/client/components/pipelines/templateVariableLayouts.svelte"
	import {
		parseStepParam,
		presetsDifferingWords,
		stepWords as stepWordsOf,
		variableHref,
		writtenAsWords
	} from "./variableLayoutWords"

	type Row = Sockets.Pipelines.VariableLayouts.ListRow
	type LibraryPipeline = Sockets.Pipelines.Library.LibraryPipeline

	let rows = $state<Row[]>([])
	let loaded = $state(false)
	let error = $state<string | null>(null)

	const step = $derived(
		parseStepParam(adminPage.url.searchParams.get("step"))
	)
	const stepParam = $derived(step ? `${step.specSlug}:${step.stepKey}` : null)

	/** The step's answer from the shared store; undefined until it arrives. */
	const stepAnswer = $derived(
		step
			? templateVariableLayoutsOf({
					specSlug: step.specSlug,
					stepKey: step.stepKey
				})
			: undefined
	)
	let pipelines = $state<LibraryPipeline[]>([])

	useInterest<"pipelines:libraryVariables:error">(
		"pipelines:libraryVariables:error",
		(res) => {
			error = res.error ?? "The variable layouts could not be read."
			loaded = true
		}
	)
	useInterest("pipelines:library", (res) => {
		if (res.pipelines) pipelines = res.pipelines
	})

	onMount(() =>
		requestWithInterest("pipelines:libraryVariables", {}, (res) => {
			if (!res.variables) return
			rows = res.variables
			error = null
			loaded = true
		})
	)

	$effect(() => {
		const s = step
		const key = stepParam
		if (!s || !key) return
		requestTemplateVariableLayouts({
			specSlug: s.specSlug,
			stepKey: s.stepKey
		})
		const releaseLibrary = requestWithInterest(
			"pipelines:library",
			{},
			() => {}
		)
		return releaseLibrary
	})

	const narrowing = $derived(
		stepAnswer?.keys
			? new Set(stepAnswer.keys.map((k) => k.variableId))
			: null
	)
	const stepFailed = $derived(!!stepAnswer?.error)
	/** A step is asked for and has neither answered nor failed. */
	const stepPending = $derived(stepParam != null && !narrowing && !stepFailed)

	const shown = $derived(
		narrowing ? rows.filter((r) => narrowing.has(r.variableId)) : rows
	)

	const stepWords = $derived.by(() => {
		if (!step) return ""
		const pipeline = pipelines.find((p) => p.slug === step.specSlug)
		return stepWordsOf(stepAnswer?.stepHeading, pipeline?.label)
	})

	function showAll() {
		const q = new URLSearchParams(adminPage.url.search)
		q.delete("step")
		const s = q.toString()
		adminRouter.setQuery(s ? `?${s}` : "")
	}

	const writtenAs = (r: Row) =>
		[writtenAsWords(r), presetsDifferingWords(r.presetsDiffering)]
			.filter(Boolean)
			.join(" ")

	const columns: AdminChangelistColumn<Row>[] = [
		{
			key: "variable",
			label: "Variable",
			primary: true,
			custom: true,
			text: (r) => r.label,
			sortValue: (r) => r.label
		},
		{ key: "supplier", label: "Supplied by", text: (r) => r.supplier },
		{
			key: "writtenAs",
			label: "Written as",
			custom: true,
			text: writtenAs
		},
		{
			key: "layouts",
			label: "Layouts",
			numeric: true,
			text: (r) => String(r.layoutCount)
		}
	]

	const shelves = $derived(
		new Map(rows.map((r) => [r.shelfId, r.shelfLabel]))
	)
	const filters = $derived<AdminChangelistFilter<Row>[]>([
		{
			key: "shelf",
			label: "Shelf",
			values: (r) => r.shelfId,
			optionLabel: (v) => shelves.get(v) ?? v,
			order: [...shelves.keys()]
		}
	])
</script>

<AdminChangelist
	rows={shown}
	rowKey={(r) => r.variableId}
	{columns}
	{filters}
	noun={{ singular: "variable", plural: "variables" }}
	searchText={(r) =>
		`${r.label} ${r.variableId} ${r.key ?? ""} ${r.supplier} ${writtenAs(r)}`}
	rowHref={(r) => variableHref(r.variableId)}
	loading={(!loaded && !error) || stepPending}
	emptyIcon={Braces}
	emptyMessage="No variables yet."
	keepQuery={["step"]}
	syncQuery
	title="Variable layouts"
	purpose="How each variable is written out. One choice for the whole pub."
>
	{#snippet headerExtra()}
		{#if error}
			<InlineError class="mb-3">{error}</InlineError>
		{/if}
		{#if step}
			<p
				class="text-surface-600-400 mb-3 flex flex-wrap items-center gap-x-2 text-sm"
			>
				{#if stepFailed}
					<span role="status">
						The variables {stepWords} writes out could not be found:
						{stepAnswer?.error}. Showing every variable.
					</span>
				{:else}
					<span>Showing the variables {stepWords} writes out.</span>
				{/if}
				<button type="button" class="anchor text-sm" onclick={showAll}>
					Show all
				</button>
			</p>
		{/if}
	{/snippet}
	{#snippet cell(r, col)}
		{#if col.key === "variable"}
			<span class="flex min-w-0 flex-col">
				<span>{r.label}</span>
				<span class="text-surface-600-400 font-mono text-xs break-all">
					{r.key ?? r.variableId}
				</span>
			</span>
		{:else if col.key === "writtenAs"}
			<span class="inline-flex flex-wrap items-baseline gap-x-2">
				<span>{writtenAsWords(r)}</span>
				{#if r.presetsDiffering > 0}
					<span class="text-surface-600-400 text-xs">
						{presetsDifferingWords(r.presetsDiffering)}
					</span>
				{/if}
			</span>
		{/if}
	{/snippet}
</AdminChangelist>
