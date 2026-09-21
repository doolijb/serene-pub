<script lang="ts">
	/**
	 * "What this pub can do" — the first card on the Connections index.
	 *
	 * It replaces the defaults pill row (retired 2026-09-17, NOMENCLATURE §23).
	 * The pills answered "which model answers when I press send" only for the
	 * capabilities that were already set: a person with nothing configured saw
	 * one dashed "10 not set" pill, which is the opposite of the case the panel
	 * has to serve. A row per capability, always, says what is missing before
	 * it says what is there.
	 *
	 * ## Four rows always, six behind a fold
	 *
	 * The four sections are the ones an install needs opinions about — chat,
	 * images, embeddings, entities — and they are rendered whether they are set
	 * or not. The other six (vision, documents, image editing, …) are real but
	 * rarely the reason anyone opened this panel, so they are one fold row that
	 * still names them and still counts them.
	 *
	 * ## One dot, one line, one button
	 *
	 * Row grammar from the concept ruling (R7): the button IS the fix, and
	 * filled primary appears only where NOTHING serves chat (`text->text`) —
	 * the one unset capability that blocks play, and so the only state on this
	 * card that is a call to action rather than a repair. Every other unset
	 * row's `Set up` is tonal, same as a fix. Everything the rows say comes
	 * out of `readiness.ts`; this file decides no sentences.
	 */
	import * as Icons from "@lucide/svelte"
	import {
		foldSummary,
		readyCount,
		splitReadiness,
		type ReadinessRow
	} from "./readiness"

	interface Props {
		/** Every transform, in SDK order. */
		rows: ReadinessRow[]
		/** The star capabilities of the four sections, in section order. */
		sectionOrder: readonly string[]
		/** Open the capability's own view. */
		onOpen: (capability: string) => void
		/** Run the row's one fix. The card never emits. */
		onFix: (row: ReadinessRow) => void
	}
	let { rows, sectionOrder, onOpen, onFix }: Props = $props()

	const split = $derived(splitReadiness(rows, sectionOrder))
	const fold = $derived(foldSummary(split.rest))
	const ready = $derived(readyCount(rows))

	let expanded = $state(false)

	const DOT: Record<ReadinessRow["state"], string> = {
		ok: "bg-success-500",
		pending: "bg-warning-500 animate-pulse",
		warning: "bg-warning-500",
		unset: "bg-surface-400-600"
	}
	/** The tile's tone follows the dot — one signal, said twice, never thrice. */
	const TILE: Record<ReadinessRow["state"], string> = {
		ok: "preset-tonal-success",
		pending: "preset-tonal-warning",
		warning: "preset-tonal-warning",
		unset: "preset-tonal-surface"
	}
</script>

{#snippet readinessRowEl(row: ReadinessRow)}
	{@const RowIcon = ((Icons as any)[row.icon] as any) ?? Icons.Boxes}
	<div class="flex min-h-11 items-center gap-2.5">
		<!-- The row itself opens the capability; the button beside it is the
		     fix. Two targets, never nested. -->
		<button
			type="button"
			class="hover:preset-tonal-primary focus-visible:ring-primary-500 flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-1.5 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
			onclick={() => onOpen(row.capability)}
		>
			<span
				class="grid size-8 shrink-0 place-items-center rounded-lg {TILE[
					row.state
				]}"
				aria-hidden="true"
			>
				<RowIcon size={16} />
			</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-sm font-medium">
					{row.label}
				</span>
				<span
					class="text-surface-600-400 flex items-center gap-1.5 text-xs"
				>
					<span
						class="size-1.5 shrink-0 rounded-full {DOT[row.state]}"
						aria-hidden="true"
					></span>
					<span class="min-w-0 truncate">{row.sentence}</span>
				</span>
			</span>
			{#if !row.action}
				<Icons.ChevronRight
					size={16}
					class="text-surface-500 shrink-0"
					aria-hidden="true"
				/>
			{/if}
		</button>
		{#if row.action}
			<button
				type="button"
				class="btn btn-sm shrink-0 text-xs {row.action.emphasis ===
				'primary'
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				onclick={() => onFix(row)}
				aria-label={`${row.action.label} — ${row.label}`}
			>
				{row.action.label}
			</button>
		{/if}
	</div>
{/snippet}

<section
	class="panel-card flex flex-col gap-1"
	aria-label="What this pub can do"
>
	<div class="mb-1 flex items-baseline gap-2">
		<h3 class="min-w-0 flex-1 text-sm font-medium">What this pub can do</h3>
		<span class="text-surface-600-400 shrink-0 text-[11px]">
			{ready} of {rows.length} ready
		</span>
	</div>

	{#each split.sections as row (row.capability)}
		{@render readinessRowEl(row)}
	{/each}

	{#if fold.count}
		<button
			type="button"
			class="hover:preset-tonal-primary text-surface-600-400 flex min-h-9 items-center gap-2 rounded-[10px] px-1.5 text-left text-xs"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			{#if expanded}
				<Icons.ChevronDown size={14} aria-hidden="true" />
			{:else}
				<Icons.ChevronRight size={14} aria-hidden="true" />
			{/if}
			<span class="min-w-0 truncate">
				{fold.count} more · {fold.names} · {fold.setCount} set
			</span>
		</button>
		{#if expanded}
			{#each split.rest as row (row.capability)}
				{@render readinessRowEl(row)}
			{/each}
		{/if}
	{/if}
</section>
