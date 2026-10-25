<script lang="ts">
	/**
	 * The line: the spec at reading size. One card per node, the key and
	 * nothing else (the drawer owns the rest); a clause is a container that
	 * opens in place into its branches drawn as parallel lines, the branch
	 * name and its predicate at the head of each, the cards stacked under
	 * it. A closed clause is one row carrying its members as dots.
	 *
	 * No data lines. What a card receives and sends is the drawer's.
	 */
	import * as Icons from "@lucide/svelte"
	import type { LineBranch, LineModel, LineRow } from "./lineModel"
	import type { DiffMark } from "./lineModel"
	import { CLAUSE_LABEL, KIND_STRIPE } from "../flow/context"
	import { MARK_LABEL, MARK_VAR, predicateSentence } from "./canvasTokens"

	interface Props {
		model: LineModel
		selected: string | null
		/** Open clause ids. */
		isOpen: (clauseId: string) => boolean
		/** The colour of a card's status dot, or null for none. */
		dotOf: (key: string, kind: string) => string | null
		/** A hover title for the dot. */
		dotTitleOf?: (key: string) => string
		markOf?: (key: string) => DiffMark | null
		onSelect: (key: string) => void
		onToggle: (clauseId: string) => void
	}

	let {
		model,
		selected,
		isOpen,
		dotOf,
		dotTitleOf = () => "",
		markOf = () => null,
		onSelect,
		onToggle
	}: Props = $props()

	/** A long single-chain body (an each or loop) folds into columns of seven. */
	const columnsOf = (b: LineBranch, kind: string): { label: string; rows: LineRow[] }[] => {
		if ((kind === "each" || kind === "loop") && b.rows.length > 9) {
			const out: { label: string; rows: LineRow[] }[] = []
			for (let i = 0; i < b.rows.length; i += 7)
				out.push({ label: i === 0 ? b.name : "↳", rows: b.rows.slice(i, i + 7) })
			return out
		}
		return [{ label: b.name, rows: b.rows }]
	}

	const memberCount = (r: Extract<LineRow, { kind: "clause" }>) =>
		r.branches.reduce((n, b) => n + b.rows.length, 0)

	const shortKey = (key: string) => key.split(".").pop() ?? key

	const clauseSummary = (r: Extract<LineRow, { kind: "clause" }>) => {
		const c = r.clause
		const kind = CLAUSE_LABEL[c.kind] ?? c.kind
		if (c.kind === "gather") return `${kind} · ${c.mode} · ${c.chains.length} ${c.chains.length === 1 ? "chain" : "chains"}`
		if (c.kind === "each") return `${kind} · ${c.mode} · ≤${c.max ?? "?"} items · ${memberCount(r)} nodes`
		if (c.kind === "loop") return `${kind} · ≤${c.max ?? "?"} passes · ${memberCount(r)} nodes`
		return `${kind} · ${c.chains.length} ${c.chains.length === 1 ? "branch" : "branches"}`
	}
</script>

{#snippet card(row: Extract<LineRow, { kind: "node" }>, dense: boolean)}
	{@const key = row.key}
	{@const mark = markOf(key)}
	{@const dot = dotOf(key, row.node.kind)}
	{@const active = key === selected}
	<button
		type="button"
		class="bg-surface-50-950 border-surface-200-800 relative flex items-stretch overflow-hidden rounded-md border text-left transition-colors
			{active ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-surface-100-900' : 'hover:border-primary-500/60'}
			{mark === 'removed' ? 'border-dashed opacity-60 line-through' : ''}
			{dense ? 'h-6 w-[7.5rem]' : 'h-7 w-[11rem]'}"
		aria-current={active ? "true" : undefined}
		aria-label={key}
		title={key}
		onclick={() => onSelect(key)}
	>
		<span aria-hidden="true" class="w-[3px] shrink-0 {KIND_STRIPE[row.node.kind] ?? 'bg-surface-400-600'}"></span>
		<span class="min-w-0 flex-1 truncate px-2 font-mono {dense ? 'text-meta leading-6' : 'text-xs leading-7'}">
			{shortKey(key)}
		</span>
		{#if mark && mark !== "removed"}
			<span
				class="mr-1.5 self-center rounded px-1 font-mono text-meta font-semibold leading-4"
				style="background: {MARK_VAR[mark]}; color: var(--color-surface-950)"
				title={MARK_LABEL[mark]}>{mark === "added" ? "+" : "~"}</span
			>
		{:else if dot}
			<span aria-hidden="true" class="mr-2 size-2 shrink-0 self-center rounded-full" style="background: {dot}" title={dotTitleOf(key)}></span>
		{/if}
	</button>
{/snippet}

{#snippet rows(list: LineRow[], dense: boolean)}
	{#each list as row (row.key)}
		{#if row.kind === "node"}
			{@render card(row, dense)}
		{:else}
			{@const open = isOpen(row.key)}
			{@const active = row.key === selected}
			{@const mark = markOf(row.key)}
			<div
				class="rounded-lg border border-dashed
					{active ? 'border-primary-500 ring-2 ring-primary-500 ring-offset-2 ring-offset-surface-100-900' : 'border-surface-200-800'}
					{mark === 'removed' ? 'opacity-60' : ''}
					bg-surface-100-900/60 {dense ? 'w-full' : ''}"
			>
				<div class="flex h-7 items-center gap-1.5 px-1.5">
					<button
						type="button"
						class="hover:bg-surface-200-800 flex size-5 shrink-0 items-center justify-center rounded"
						aria-expanded={open}
						aria-label="{open ? 'Close' : 'Open'} {row.key}"
						onclick={() => onToggle(row.key)}
					>
						{#if open}<Icons.ChevronDown size={14} />{:else}<Icons.ChevronRight size={14} />{/if}
					</button>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-baseline gap-2 text-left"
						aria-current={active ? "true" : undefined}
						onclick={() => onSelect(row.key)}
					>
						<span class="truncate font-mono text-xs font-medium">{shortKey(row.key)}</span>
						<span class="text-surface-600-400 truncate text-meta">{clauseSummary(row)}</span>
					</button>
					{#if mark}
						<span class="rounded px-1 font-mono text-meta font-semibold leading-4" style="background: {MARK_VAR[mark]}; color: var(--color-surface-950)">{MARK_LABEL[mark]}</span>
					{/if}
					{#if !open}
						<span class="flex shrink-0 items-center gap-[3px] pr-1" aria-hidden="true">
							{#each row.branches as b (b.name)}
								{#each b.rows as member (member.key)}
									{#if member.kind === "node"}
										<i class="block size-1.5 rounded-full" style="background: {dotOf(member.key, member.node.kind) ?? 'var(--color-surface-500)'}"></i>
									{:else}
										<i class="bg-surface-500 block size-1.5"></i>
									{/if}
								{/each}
							{/each}
						</span>
					{/if}
				</div>
				{#if open}
					<div class="border-surface-200-800 mx-2 mb-2 border-t border-b py-2">
						<div class="flex flex-wrap items-start gap-x-4 gap-y-3">
							{#each row.branches as b (b.name)}
								{#each columnsOf(b, row.clause.kind) as col (col.label + b.name)}
									<div class="border-surface-400-600 flex min-w-0 flex-col gap-1 border-l-2 pl-2">
										<div class="text-surface-600-400 flex items-baseline gap-2 pb-0.5">
											<span class="font-mono text-meta">{col.label}</span>
											{#if b.predicate && col.label === b.name}
												<span class="text-meta">{predicateSentence(b.predicate)}</span>
											{/if}
										</div>
										{#if col.rows.length === 0}
											<span class="text-surface-500 text-meta italic">empty</span>
										{/if}
										{@render rows(col.rows, true)}
									</div>
								{/each}
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{/each}
{/snippet}

<div class="border-surface-200-800 ml-3 flex flex-col gap-1.5 border-l-2 py-2 pl-4" role="list" aria-label="Pipeline line">
	{@render rows(model.rows, false)}
</div>
