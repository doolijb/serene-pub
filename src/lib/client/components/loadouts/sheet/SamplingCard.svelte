<script lang="ts">
	/**
	 * The loadout editor's **Sampling** card: the configs of the job's shape
	 * as radio rows, each with its key knobs read inline (*Temperature 0.7 ·
	 * 512 tokens max*), the swap notice when a pair change replaced one that
	 * did not fit, and *Open in Sampling*. Every word from `loadoutSheet.ts`.
	 */
	import * as Icons from "@lucide/svelte"
	import {
		NO_SAMPLING_PICKED,
		NO_SAMPLING_SENTENCE,
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
		checkedId: number | null
		/** The swap rule's sentence, after a pair change. */
		notice: string | null
		disabled?: boolean
		onPick: (id: number | null) => void
		onOpenSampling: () => void
	}
	let {
		rows,
		checkedId,
		notice,
		disabled = false,
		onPick,
		onOpenSampling
	}: Props = $props()

	const uid = $props.id()
	const stopId = $derived(
		rows.some((r) => r.id === checkedId) ? checkedId : (rows[0]?.id ?? null)
	)
	let listEl = $state<HTMLElement | null>(null)

	function onKey(e: KeyboardEvent, index: number) {
		const step =
			e.key === "ArrowDown" || e.key === "ArrowRight"
				? 1
				: e.key === "ArrowUp" || e.key === "ArrowLeft"
					? -1
					: 0
		if (!step || !rows.length) return
		e.preventDefault()
		const next = rows[(index + step + rows.length) % rows.length]!
		onPick(next.id)
		listEl?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus()
	}
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="{uid}-h">
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

	{#if notice}
		<p
			class="bg-surface-200-800 flex items-start gap-2 rounded-[10px] px-3 py-2 text-xs"
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
		<div
			bind:this={listEl}
			class="grid grid-cols-1 gap-1 @lg/editor:grid-cols-2"
			role="radiogroup"
			aria-labelledby="{uid}-h"
		>
			{#each rows as row, index (row.id)}
				{@const checked = row.id === checkedId}
				<button
					type="button"
					role="radio"
					aria-checked={checked}
					data-id={row.id}
					tabindex={row.id === stopId ? 0 : -1}
					{disabled}
					class="focus-visible:outline-primary-500 flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[10px] px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed {checked
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
						<span class="block truncate text-sm font-medium">
							{row.name}
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
			{/each}
		</div>
		{#if checkedId == null}
			<p class="text-surface-600-400 text-xs">{NO_SAMPLING_PICKED}</p>
		{/if}
	{/if}
</section>
