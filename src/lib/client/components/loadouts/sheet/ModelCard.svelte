<script lang="ts">
	/**
	 * The loadout editor's **Model** card: one searchable list of every model
	 * that can do the loadout's job, across connections, each row's
	 * connection as a chip. The chosen row opens to its facts, its capability
	 * chips and — when the pair cannot do what the loadout's users wire — the
	 * consequence in the receipt's words. A radiogroup: arrows move the pick.
	 * Every row and word comes from `loadoutSheet.ts`.
	 */
	import * as Icons from "@lucide/svelte"
	import { connectionTypeIcon } from "$lib/client/components/connections/connectionTypeIcon"
	import {
		filterModelOptions,
		MODEL_FILTER_FROM,
		noModelSentence,
		VERBS,
		type ModelOption
	} from "../loadoutSheet"

	interface Props {
		options: ModelOption[]
		/** `<connectionId>:<modelId>` of the draft's pair, or null. */
		chosenKey: string | null
		/** The job's label, for the empty sentence. */
		jobLabel: string
		disabled?: boolean
		onPick: (option: ModelOption) => void
		onClear: () => void
	}
	let {
		options,
		chosenKey,
		jobLabel,
		disabled = false,
		onPick,
		onClear
	}: Props = $props()

	const uid = $props.id()
	let query = $state("")
	const shown = $derived(filterModelOptions(options, query))
	const chosen = $derived(options.find((o) => o.key === chosenKey) ?? null)
	/** The roving stop: the chosen row, else the first. */
	const stopKey = $derived(
		shown.some((o) => o.key === chosenKey)
			? chosenKey
			: (shown[0]?.key ?? null)
	)
	let listEl = $state<HTMLElement | null>(null)

	function onKey(e: KeyboardEvent, index: number) {
		const step =
			e.key === "ArrowDown" || e.key === "ArrowRight"
				? 1
				: e.key === "ArrowUp" || e.key === "ArrowLeft"
					? -1
					: 0
		if (!step) return
		e.preventDefault()
		let i = index
		for (let n = 0; n < shown.length; n++) {
			i = (i + step + shown.length) % shown.length
			if (shown[i]!.usable) break
		}
		const next = shown[i]
		if (!next) return
		onPick(next)
		listEl?.querySelector<HTMLElement>(`[data-key="${next.key}"]`)?.focus()
	}
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="{uid}-h">
	<div class="flex items-center gap-2">
		<Icons.Cpu size={16} class="text-surface-600-400" aria-hidden="true" />
		<h3 id="{uid}-h" class="flex-1 text-sm font-medium">Model</h3>
		{#if chosen && !disabled}
			<button
				type="button"
				class="btn btn-sm text-surface-600-400 hover:text-surface-950-50 px-2 text-xs"
				onclick={onClear}
			>
				{VERBS.clearPair}
			</button>
		{/if}
	</div>

	{#if !options.length}
		<p class="text-surface-600-400 text-sm">{noModelSentence(jobLabel)}</p>
	{:else}
		{#if options.length > MODEL_FILTER_FROM}
			<label class="relative block">
				<span class="sr-only">Filter models</span>
				<Icons.Search
					size={16}
					class="text-surface-500 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
					aria-hidden="true"
				/>
				<input
					class="input h-10 pl-9 text-sm"
					type="search"
					placeholder="Filter {options.length} models"
					bind:value={query}
					{disabled}
				/>
			</label>
		{/if}
		<div
			bind:this={listEl}
			class="-mx-1 flex max-h-80 flex-col gap-1 overflow-y-auto px-1 py-0.5"
			role="radiogroup"
			aria-labelledby="{uid}-h"
		>
			{#each shown as option, index (option.key)}
				{@const checked = option.key === chosenKey}
				{@const RowIcon = connectionTypeIcon(
					option.connectionType,
					Icons.Cable
				)}
				<div
					class="rounded-[10px] {checked ? 'sidebar-row-active' : ''}"
				>
					<button
						type="button"
						role="radio"
						aria-checked={checked}
						data-key={option.key}
						tabindex={option.key === stopKey ? 0 : -1}
						disabled={disabled || (!option.usable && !checked)}
						class="focus-visible:outline-primary-500 flex min-h-11 w-full min-w-0 items-center gap-3 rounded-[10px] px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed {checked
							? ''
							: option.usable
								? 'hover:bg-surface-200-800'
								: 'opacity-60'}"
						onclick={() => onPick(option)}
						onkeydown={(e) => onKey(e, index)}
					>
						<span class="min-w-0 flex-1">
							<span
								class="block truncate text-[15px] font-medium"
							>
								{option.modelName}
							</span>
							<span
								class="text-surface-600-400 block truncate text-xs"
							>
								{option.fact}
							</span>
						</span>
						<span
							class="bg-surface-200-800 text-surface-700-300 inline-flex max-w-[40%] shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs"
						>
							<RowIcon size={12} aria-hidden="true" />
							<span class="truncate">
								{option.connectionTitle}
							</span>
						</span>
					</button>
					{#if checked && (option.facts.length || option.chips.length || option.consequences.length)}
						<div class="flex flex-col gap-2 px-3 pb-3">
							{#if option.facts.length}
								<dl
									class="flex flex-wrap gap-x-4 gap-y-1 text-xs"
								>
									{#each option.facts as fact (fact.label)}
										<div class="flex gap-1">
											<dt class="text-surface-600-400">
												{fact.label}
											</dt>
											<dd class="text-surface-800-200">
												{fact.value}
											</dd>
										</div>
									{/each}
								</dl>
							{/if}
							{#if option.chips.length}
								<ul
									class="flex flex-wrap gap-1.5"
									aria-label="What it does natively"
								>
									{#each option.chips as chip (chip)}
										<li
											class="preset-tonal-tertiary rounded-full px-2 py-0.5 text-xs"
										>
											{chip}
										</li>
									{/each}
								</ul>
							{/if}
							{#if option.consequences.length}
								<p
									class="text-surface-700-300 flex items-start gap-1.5 text-xs"
								>
									<Icons.Info
										size={14}
										class="mt-px shrink-0"
										aria-hidden="true"
									/>
									<span>
										Runs with {option.consequences.join(
											" · "
										)}
									</span>
								</p>
							{/if}
						</div>
					{/if}
				</div>
			{:else}
				<p class="text-surface-600-400 px-3 py-2 text-sm">
					No model matches “{query}”.
				</p>
			{/each}
		</div>
	{/if}
</section>
