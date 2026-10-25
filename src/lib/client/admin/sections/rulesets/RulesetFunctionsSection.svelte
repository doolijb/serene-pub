<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 **Functions** (PLAN-rulesets-functions D1, D8; lane A4, 2026-10-23):
	 * what happens, when, and how things are decided — each one a sentence
	 * (`RulesetFunctionRow`), in the ruleset's order (the first way to decide
	 * is the default one). They are added from the catalogue beside them
	 * (`RulesetCatalogue`, drawn by the page). A long list gets a filter.
	 */
	import * as Icons from "@lucide/svelte"
	import { tick } from "svelte"
	import { functionRefDecides, functionWayKeys, i18nText, type FunctionDecl } from "@serene-pub/sdk"
	import RulesetFunctionRow from "./RulesetFunctionRow.svelte"
	import { removeFunction, type FindingsByRow, type FunctionRow, type SectionsForm } from "./rulesetSectionsForm"
	import type { TryOutResult } from "./rulesetScene"

	type FunctionChoice = Sockets.Rulesets.DetailRow["functionChoices"][number]
	type Pick = { value: string; label: string; hint?: string; kinds?: readonly string[]; type?: string }

	interface Props {
		form: SectionsForm
		choices: readonly FunctionChoice[]
		rulesetId: string
		targets: Record<"attribute" | "entry-type" | "zone-type" | "scope" | "owner", readonly Pick[]> & { "entry-field"?: readonly Pick[] }
		nameOf: (id: string) => string
		/** 🚧 The saved draft's findings, by row (RF fix 2): said on the row, after a Save. */
		findings?: FindingsByRow
		readonly?: boolean
		onTry?: (row: FunctionRow) => Promise<TryOutResult>
		/** Bring the catalogue's search into view: what **Add a function** does. */
		onFindMore?: () => void
	}
	let { form = $bindable(), choices, rulesetId, targets, nameOf, findings, readonly = false, onTry, onFindMore }: Props = $props()

	const FILTER_FROM = 8
	let query = $state("")
	const outcomes = $derived(form.outcomes.map((o) => o.label.trim() || o.id).filter(Boolean))
	const choiceOf = (row: FunctionRow) => choices.find((c) => c.id === row.ref) ?? null
	const matches = (row: FunctionRow) => {
		const q = query.trim().toLowerCase()
		if (!q) return true
		const c = choiceOf(row)
		return `${row.key} ${c?.name ?? ""} ${c?.meaning ?? ""}`.toLowerCase().includes(q)
	}
	const decidingCount = $derived(form.functions.filter((f) => (f.module?.kind ?? choiceOf(f)?.kind) === "deciding").length)

	/** A function's name as its row heads it: its own words, its module's or the catalogue's name, else its key. */
	const nameOfRow = (row: FunctionRow): string =>
		i18nText(row.options.label as never) || i18nText((row.module as { name?: never } | null)?.name) || choiceOf(row)?.name || row.key
	/** 🚧 A way to decide (a function that decides a moment by itself): the catalogue says; a module of this ruleset's own is read. */
	function isWay(row: FunctionRow): boolean {
		if (!row.module) return !!choiceOf(row)?.decides
		const ways = functionWayKeys(form.functions.map((f) => ({ ref: f.ref, key: f.key, options: f.options })))
		return functionRefDecides({ ref: row.ref, key: row.key, module: row.module as unknown as FunctionDecl }, ways)
	}

	/**
	 * 🚧 What the last removal moved, said once above the list (RF fix 6):
	 * the way a moment is decided by when it names none, and the saved tests
	 * that lost their change.
	 */
	let removedNote = $state<string | null>(null)

	/** Remove one, and what named it (`removeFunction`); the focus stays in the list, so Ctrl+S still saves. */
	async function remove(uid: string) {
		const at = form.functions.findIndex((f) => f.uid === uid)
		const row = form.functions[at]
		if (!row) return
		const r = removeFunction(form, uid, { isWay, name: nameOfRow(row) })
		const said: string[] = []
		if (r.wasDefault)
			said.push(
				r.nowDefault
					? `${nameOfRow(r.nowDefault)} is now the way a moment is decided when it names none.`
					: "No way to decide is left: whoever runs the game judges each moment in words."
			)
		if (r.tests.length) said.push(`${r.tests.length === 1 ? "The saved test" : "The saved tests"} ${r.tests.map((t) => `“${t}”`).join(", ")} no longer say${r.tests.length === 1 ? "s" : ""} what happens.`)
		removedNote = said.length ? said.join(" ") : null
		await tick()
		const next = form.functions[Math.min(at, form.functions.length - 1)]
		const el = next ? document.getElementById(`fn-${next.uid}`) : document.querySelector<HTMLElement>("[data-add-function]")
		el?.focus({ preventScroll: true })
	}
	function move(i: number, by: -1 | 1) {
		const next = [...form.functions]
		const [row] = next.splice(i, 1)
		next.splice(i + by, 0, row!)
		form.functions = next
	}
</script>

<section class="@container/fns flex min-w-0 flex-col gap-3" aria-labelledby="functions-heading" data-section="functions">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div class="flex min-w-0 flex-col gap-0.5">
			<h2 id="functions-heading" class="text-base font-medium">Functions</h2>
			<FieldHelp>What happens, when, and how things are decided. Each one is a sentence you can read.</FieldHelp>
		</div>
		{#if form.functions.length >= FILTER_FROM}
			<label class="text-surface-600-400 flex flex-col gap-1 text-xs">
				Filter
				<input class="input w-56" type="search" bind:value={query} placeholder="e.g. stealth" data-functions-filter />
			</label>
		{/if}
	</div>
	{#if decidingCount > 1}
		<FieldHelp>The first way to decide is the one a moment uses when it names none.</FieldHelp>
	{/if}
	{#if removedNote}
		<p class="text-surface-700-300 bg-surface-100-900 rounded-md px-3 py-2 text-sm" role="status" data-functions-removed>{removedNote}</p>
	{/if}

	{#if !form.functions.length}
		<div class="panel-card text-surface-600-400 flex flex-col gap-1 text-sm" data-functions-empty>
			<p>No functions: the model judges everything from your sentences, and nothing changes unless it says so.</p>
			<p>Pick one from the catalogue to make something happen by the rules — a value that refills each morning, a confession weighed against affection.</p>
		</div>
	{/if}

	<ul class="flex flex-col gap-3">
		{#each form.functions as row, i (row.uid)}
			{#if matches(row)}
				<li>
					<RulesetFunctionRow
						bind:row={form.functions[i]}
						choice={choiceOf(row)}
						{rulesetId}
						{targets}
						{outcomes}
						{nameOf}
						findings={findings?.rows[row.uid] ?? []}
						{readonly}
						first={i === 0}
						last={i === form.functions.length - 1}
						{onTry}
						onRemove={() => remove(row.uid)}
						onMove={(by) => move(i, by)}
					/>
				</li>
			{/if}
		{/each}
	</ul>

	{#if !readonly}
		<button type="button" class="btn preset-tonal-primary self-start" onclick={() => onFindMore?.()} data-add-function>
			<Icons.Plus size={16} aria-hidden="true" /> Add a function
		</button>
	{/if}
</section>
