<script lang="ts">
	/**
	 * The loadout editor's **Sampling** card: what the choice decides (one
	 * sentence), then the configs of the job's shape as radio rows, each with
	 * its key knobs read inline (*Temperature 0.7 · 512 tokens max*) — the one
	 * the loadout is **Best with** first and chipped so — a filter box once
	 * the list is long, the swap notice when a pair change replaced one that
	 * did not fit, and *Open in Sampling*. Every word from `loadoutSheet.ts`.
	 */
	import * as Icons from "@lucide/svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import {
		NO_SAMPLING_PICKED,
		NO_SAMPLING_SENTENCE,
		orderSamplingRows,
		SAMPLING_FILTER_FROM,
		samplingLede,
		VERBS
	} from "../loadoutSheet"

	interface Row {
		id: number
		name: string
		/** The knobs read inline; empty when the config switches none on. */
		knobs: string[]
	}
	interface Props {
		rows: Row[]
		/** The job's transform, for the opening sentence. */
		transform: string
		/** The config the loadout ships with (its *Best with*), or null. */
		bestWithId?: number | null
		checkedId: number | null
		/** The swap rule's sentence, after a pair change. */
		notice: string | null
		disabled?: boolean
		onPick: (id: number | null) => void
		onOpenSampling: () => void
	}
	let {
		rows,
		transform,
		bestWithId = null,
		checkedId,
		notice,
		disabled = false,
		onPick,
		onOpenSampling
	}: Props = $props()

	const uid = $props.id()
	let query = $state("")
	const shown = $derived(orderSamplingRows(rows, bestWithId, query))
	const lede = $derived(samplingLede(transform))
	const stopId = $derived(
		shown.some((r) => r.id === checkedId)
			? checkedId
			: (shown[0]?.id ?? null)
	)
	let listEl = $state<HTMLElement | null>(null)

	function onKey(e: KeyboardEvent, index: number) {
		const step =
			e.key === "ArrowDown" || e.key === "ArrowRight"
				? 1
				: e.key === "ArrowUp" || e.key === "ArrowLeft"
					? -1
					: 0
		if (!step || !shown.length) return
		e.preventDefault()
		const next = shown[(index + step + shown.length) % shown.length]!
		onPick(next.id)
		listEl?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus()
	}
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="{uid}-h">
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<Icons.SlidersHorizontal
				size={16}
				class="text-surface-600-400"
				aria-hidden="true"
			/>
			<h3 id="{uid}-h" class="flex-1 text-sm font-medium">Sampling</h3>
			{#if rows.length}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface text-xs"
					onclick={onOpenSampling}
				>
					<Icons.ExternalLink size={14} aria-hidden="true" />
					{VERBS.openInSampling}
				</button>
			{/if}
		</div>
		{#if lede && rows.length}
			<p class="text-surface-600-400 text-xs leading-relaxed">{lede}</p>
		{/if}
	</div>

	{#if notice}
		<p
			class="bg-surface-200-800 flex items-start gap-2 rounded-base px-3 py-2 text-xs"
			role="status"
		>
			<Icons.ArrowRightLeft
				size={14}
				class="mt-px shrink-0"
				aria-hidden="true"
			/>
			<span>{notice}</span>
		</p>
	{/if}

	{#if !rows.length}
		<p class="text-surface-600-400 text-sm">{NO_SAMPLING_SENTENCE}</p>
	{:else}
		{#if rows.length > SAMPLING_FILTER_FROM}
			<PanelFilterInput
				bind:value={query}
				placeholder="sampling configs"
				singular="sampling config"
				count={rows.length}
				{disabled}
			/>
		{/if}
		<div
			bind:this={listEl}
			class="grid grid-cols-1 gap-1 @lg/editor:grid-cols-2"
			role="radiogroup"
			aria-labelledby="{uid}-h"
		>
			{#each shown as row, index (row.id)}
				{@const checked = row.id === checkedId}
				<button
					type="button"
					role="radio"
					aria-checked={checked}
					data-id={row.id}
					tabindex={row.id === stopId ? 0 : -1}
					{disabled}
					class="focus-visible:outline-primary-500 flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-base px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed {checked
						? 'sidebar-row-active'
						: 'hover:bg-surface-200-800'}"
					onclick={() => onPick(row.id)}
					onkeydown={(e) => onKey(e, index)}
				>
					<span
						class="grid size-4 shrink-0 place-items-center rounded-full border-2 {checked
							? 'border-primary-500'
							: 'border-surface-400-600'}"
						aria-hidden="true"
					>
						{#if checked}
							<span
								class="bg-primary-500 size-2 rounded-full"
							></span>
						{/if}
					</span>
					<span class="min-w-0 flex-1">
						<span class="flex min-w-0 items-center gap-1.5">
							<span class="truncate text-sm font-medium">
								{row.name}
							</span>
							{#if row.id === bestWithId}
								<span
									class="preset-tonal-tertiary shrink-0 rounded-full px-1.5 py-px text-meta"
									title="The config this loadout ships with"
								>
									Best with
								</span>
							{/if}
						</span>
						{#if row.knobs.length}
							<span
								class="text-surface-600-400 block truncate text-xs"
							>
								{row.knobs.join(" · ")}
							</span>
						{/if}
					</span>
				</button>
			{:else}
				<p class="text-surface-600-400 px-3 py-2 text-sm">
					No sampling config matches “{query.trim()}”.
				</p>
			{/each}
		</div>
		{#if checkedId == null}
			<p class="text-surface-600-400 text-xs">{NO_SAMPLING_PICKED}</p>
		{/if}
	{/if}
</section>
