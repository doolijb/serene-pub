<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * The loadout editor's **Model** card, top to bottom: what the choice
	 * decides (one sentence), **Fill for me**'s why when it just filled, the
	 * chosen model with its facts, its capability chips and — when the pair
	 * cannot do what the loadout's users wire — the consequence in the
	 * receipt's words; then the find row (STYLE-GUIDE §6.3: the filter box and
	 * the **model filters** popout, every narrowing in force a chip) over one
	 * list of every model that can do the loadout's job, across connections.
	 * Each row says, for THIS loadout, what it answers natively and what it
	 * would do instead. A radiogroup: arrows move the pick.
	 * Every row and word comes from `loadoutSheet.ts`.
	 */
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { connectionTypeIcon } from "$lib/client/components/connections/connectionTypeIcon"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import { toolbarButtonClass } from "$lib/client/components/panels/toolbarButton"
	import type { StepNeeds } from "$lib/shared/loadouts/consequence"
	import {
		applyModelFilters,
		filtersActive,
		MODEL_FILTER_FROM,
		modelFilterChips,
		modelFilterGroups,
		modelLede,
		NO_MODEL_FILTERS,
		noMatchLine,
		noModelSentence,
		pickFilter,
		unfilledModelLine,
		VERBS,
		type FilterGroup,
		type ModelFilters,
		type ModelOption
	} from "../loadoutSheet"

	interface Props {
		options: ModelOption[]
		/** `<connectionId>:<modelId>` of the draft's pair, or null. */
		chosenKey: string | null
		/** The job's transform and label, for the opening and empty sentences. */
		transform: string
		jobLabel: string
		/** What the loadout needs: *Does natively* lists those first. */
		needs?: StepNeeds
		/** The default loadout an unfilled one falls back to, by name. */
		fallbackName?: string | null
		/** **Fill for me**'s sentence, after it filled the draft. */
		explanation?: string | null
		/** Fill for me is asking. */
		filling?: boolean
		disabled?: boolean
		onPick: (option: ModelOption) => void
		onClear: () => void
		/** Absent: no **Fill for me** (a merged loadout). */
		onFill?: () => void
	}
	let {
		options,
		chosenKey,
		transform,
		jobLabel,
		needs = {},
		fallbackName = null,
		explanation = null,
		filling = false,
		disabled = false,
		onPick,
		onClear,
		onFill
	}: Props = $props()

	const uid = $props.id()
	let query = $state("")
	let filters = $state<ModelFilters>({ ...NO_MODEL_FILTERS })
	let filterOpen = $state(false)
	const finds = $derived(options.length > MODEL_FILTER_FROM)
	const shown = $derived(applyModelFilters(options, query, filters))
	const groups = $derived<FilterGroup[]>(
		finds ? modelFilterGroups(options, query, filters, needs) : []
	)
	const chips = $derived(modelFilterChips(options, filters))
	const narrowed = $derived(!!query.trim() || chips.length > 0)
	const chosen = $derived(options.find((o) => o.key === chosenKey) ?? null)
	/** "listed" is true of every row and says nothing (`modelFact`). */
	const factOf = (o: ModelOption) => (o.fact === "listed" ? "" : o.fact)
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
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<Icons.Cpu
				size={16}
				class="text-surface-600-400"
				aria-hidden="true"
			/>
			<h3 id="{uid}-h" class="flex-1 text-sm font-medium">Model</h3>
			{#if onFill && options.length && !disabled}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface text-xs"
					disabled={filling}
					title="Choose the model you have that answers this loadout's needs best, and say why. Nothing is saved until you press Save."
					onclick={onFill}
				>
					<Icons.Wand size={14} aria-hidden="true" />
					{filling ? "Filling…" : VERBS.fillForMe}
				</button>
			{/if}
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
		{#if options.length}
			<p class="text-surface-600-400 text-xs leading-relaxed">
				{modelLede(transform, jobLabel)}
			</p>
		{/if}
	</div>

	{#if explanation}
		<p
			class="bg-surface-200-800 flex items-start gap-2 rounded-base px-3 py-2 text-sm"
			role="status"
		>
			<Icons.Wand size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
			<span>{explanation}</span>
		</p>
	{/if}

	{#if !options.length}
		<p class="text-surface-600-400 text-sm">{noModelSentence(jobLabel)}</p>
	{:else}
		<!-- The choice, said once above the list so scrolling or filtering
		     the list never hides it. -->
		{#if chosen}
			{@const ChosenIcon = connectionTypeIcon(
				chosen.connectionType,
				Icons.Cable
			)}
			<div
				class="border-surface-200-800 flex flex-col gap-2 rounded-container border px-3 py-2.5"
				data-chosen-model
			>
				<div class="flex min-w-0 items-start gap-3">
					<span class="min-w-0 flex-1">
						<span class="text-surface-600-400 block text-xs">
							Chosen
						</span>
						<span
							class="block text-lead font-medium break-words"
						>
							{chosen.modelName}
						</span>
					</span>
					<Badge size="md" class="text-surface-700-300 mt-0.5 inline-flex max-w-[45%] shrink-0 items-center gap-1">
						<ChosenIcon size={12} aria-hidden="true" />
						<span class="truncate">{chosen.connectionTitle}</span>
					</Badge>
				</div>
				{#if chosen.facts.length || factOf(chosen)}
					<dl class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
						{#if factOf(chosen)}
							<div class="flex gap-1">
								<dt class="sr-only">Facts</dt>
								<dd class="text-surface-700-300">
									{factOf(chosen)}
								</dd>
							</div>
						{/if}
						{#each chosen.facts as fact (fact.label)}
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
				{#if chosen.chips.length}
					<ul
						class="flex flex-wrap gap-1.5"
						aria-label="What it does natively"
					>
						{#each chosen.chips as chip (chip)}
							<li
								class="preset-tonal-tertiary rounded-full px-2 py-0.5 text-xs"
							>
								{chip}
							</li>
						{/each}
					</ul>
				{/if}
				{#if chosen.consequences.length}
					<p
						class="text-surface-700-300 flex items-start gap-1.5 text-xs"
					>
						<Icons.Info
							size={14}
							class="mt-px shrink-0"
							aria-hidden="true"
						/>
						<span>
							Runs with {chosen.consequences.join(" · ")}
						</span>
					</p>
				{/if}
			</div>
		{:else}
			<p
				class="text-primary-ink flex items-start gap-2 text-sm"
				data-chosen-model
			>
				<span
					class="bg-primary-500 mt-1.5 size-2 shrink-0 rounded-full"
					aria-hidden="true"
				></span>
				<span>{unfilledModelLine(fallbackName)}</span>
			</p>
		{/if}

		{#if finds}
			<div class="flex flex-col gap-2">
				<div class="flex items-center gap-2">
					<div class="min-w-0 flex-1">
						<PanelFilterInput
							bind:value={query}
							placeholder="models"
							singular="model"
							count={options.length}
							{disabled}
						/>
					</div>
					<Popover
						open={filterOpen}
						onOpenChange={(e) => (filterOpen = e.open)}
						positioning={{ placement: "bottom-end", fitViewport: true }}
					>
						<Popover.Trigger
							class={toolbarButtonClass(filtersActive(filters))}
							title="Model filters"
							aria-label="Model filters"
							aria-pressed={filtersActive(filters)}
							{disabled}
						>
							<Icons.SlidersHorizontal size={16} aria-hidden="true" />
						</Popover.Trigger>
						<Portal>
							<Popover.Positioner class="z-[1000]!">
								<Popover.Content
									class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,300px)] border p-2 shadow-xl"
								>
									<div
										class="flex max-h-[min(calc(var(--available-height,70vh)-1rem),560px)] flex-col gap-3 overflow-y-auto"
									>
										{#each groups as group (group.key)}
											{@render radioGroup(group)}
										{/each}
									</div>
								</Popover.Content>
							</Popover.Positioner>
						</Portal>
					</Popover>
				</div>
				{#if chips.length || narrowed}
					<div
						class="flex min-w-0 flex-wrap items-center gap-2"
						data-model-filter-chips
					>
						{#each chips as chip (chip.key)}
							<Badge size="md" class="text-surface-800-200 flex min-w-0 items-center gap-1">
								<span class="min-w-0 truncate">{chip.label}</span>
								<button
									type="button"
									class="hover:text-surface-950-50 shrink-0 pointer-coarse:-m-2 pointer-coarse:p-2"
									title="Clear"
									aria-label="Clear {chip.label}"
									onclick={() =>
										(filters = pickFilter(filters, chip.key, ""))}
								>
									<Icons.X size={12} aria-hidden="true" />
								</button>
							</Badge>
						{/each}
						<span
							class="text-surface-600-400 ml-auto text-xs"
							aria-live="polite"
						>
							{shown.length} of {options.length}
						</span>
					</div>
				{/if}
			</div>
		{/if}

		<div
			bind:this={listEl}
			class="-mx-1 flex max-h-96 flex-col gap-1 overflow-y-auto px-1 py-0.5"
			role="radiogroup"
			aria-labelledby="{uid}-h"
		>
			{#each shown as option, index (option.key)}
				{@const checked = option.key === chosenKey}
				{@const RowIcon = connectionTypeIcon(
					option.connectionType,
					Icons.Cable
				)}
				<button
					type="button"
					role="radio"
					aria-checked={checked}
					data-key={option.key}
					tabindex={option.key === stopKey ? 0 : -1}
					disabled={disabled || (!option.usable && !checked)}
					class="focus-visible:outline-primary-500 flex min-h-11 w-full min-w-0 shrink-0 items-center gap-3 rounded-base px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed {checked
						? 'sidebar-row-active'
						: option.usable
							? 'hover:bg-surface-200-800'
							: 'opacity-60'}"
					onclick={() => onPick(option)}
					onkeydown={(e) => onKey(e, index)}
				>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-lead font-medium">
							{option.modelName}
						</span>
						{#if factOf(option)}
							<span
								class="text-surface-600-400 block truncate text-xs"
							>
								{factOf(option)}
							</span>
						{/if}
						{#if option.answers.length || option.consequences.length}
							<span
								class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
							>
								{#each option.answers as answer (answer)}
									<span
										class="preset-tonal-tertiary rounded-full px-2 py-px"
									>
										{answer}
									</span>
								{/each}
								{#if option.consequences.length}
									<span class="text-surface-600-400">
										{option.consequences.join(" · ")}
									</span>
								{/if}
							</span>
						{/if}
					</span>
					<Badge size="md" class="text-surface-700-300 inline-flex max-w-[40%] shrink-0 items-center gap-1">
						<RowIcon size={12} aria-hidden="true" />
						<span class="truncate">
							{option.connectionTitle}
						</span>
					</Badge>
				</button>
			{:else}
				<div
					class="text-surface-600-400 flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
				>
					<span>{noMatchLine(query, chips.length > 0)}</span>
					<button
						type="button"
						class="underline underline-offset-2 pointer-coarse:min-h-11"
						onclick={() => {
							query = ""
							filters = { ...NO_MODEL_FILTERS }
						}}
					>
						Show every model
					</button>
				</div>
			{/each}
		</div>
	{/if}
</section>

{#snippet radioGroup(group: FilterGroup)}
	<div
		class="flex flex-col gap-0.5"
		role="radiogroup"
		aria-label={group.label}
	>
		<span
			class="text-surface-600-400 px-2.5 pt-1 pb-0.5 text-xs font-medium"
		>
			{group.label}
		</span>
		{#each group.choices as choice (choice.value)}
			{@const checked = group.current === choice.value}
			<button
				type="button"
				role="radio"
				aria-checked={checked}
				class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm {checked
					? 'sidebar-row-active'
					: 'hover:bg-surface-200-800'}"
				onclick={() =>
					(filters = pickFilter(filters, group.key, choice.value))}
			>
				<span class="min-w-0 flex-1 truncate">{choice.label}</span>
				{#if choice.count != null}
					<span class="text-surface-600-400 shrink-0 text-meta">
						{choice.count}
					</span>
				{/if}
			</button>
		{/each}
	</div>
{/snippet}
