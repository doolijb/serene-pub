<script lang="ts">
	/**
	 * Every model on one connection, as a TABLE — desk width only.
	 *
	 * ## Why this only exists at full page
	 *
	 * Context length and price are the two facts an expert coming from
	 * OpenRouter, LM Studio or Open WebUI reaches for first, and neither fits
	 * beside a name in a 400px column. So they had nowhere to go, and full page
	 * — which had 1,150px spare — showed one sentence in it.
	 *
	 * The same rows are `ModelRow`s in the dock. This is not a different set of
	 * models or a different set of actions; it is the same list with the room to
	 * put four numbers in columns, where the eye can compare them down a column
	 * instead of re-reading them across a line.
	 *
	 * ## Sparse cells are the design, not a gap
	 *
	 * A local GGUF has a quantisation and a size and no price. A cloud model has
	 * a price and a context and no quantisation. One table shows both, and a
	 * cell the host said nothing about is `—`. The alternative — a column set
	 * per connection type — is nine layouts to keep in step, and it would still
	 * have to answer what to do about the OpenAI-compatible host that happens to
	 * send pricing.
	 *
	 * ⚠ `—` means the host did not say, never "zero" and never "no". A price of
	 * zero is a claim and reads **Free**; a missing price reads `—`. Those are
	 * different answers and conflating them would misprice somebody's month.
	 *
	 * ## Hiding, not deleting
	 *
	 * OpenRouter lists 327 models and a person uses four. **Hide** writes
	 * `enabled = false`, which every picker already honours, and the row stays
	 * with its overrides and any selection naming it intact. Nothing is deleted;
	 * a hidden model comes back with one press.
	 */
	import * as Icons from "@lucide/svelte"
	import {
		formatContext,
		formatPrice
	} from "$lib/shared/connections/modelFacts"
	import { formatSize, modelDisplay } from "./modelDisplay"

	type ModelOf = Sockets.Connections.Models.ModelRow

	interface Props {
		models: readonly ModelOf[]
		/** capability labels, keyed by model id. */
		defaultsByModel: Record<number, string[]>
		/** Show the disk column instead of the price columns. */
		local?: boolean
		onOpen: (modelId: number) => void
		onUse: (modelId: number) => void
		onToggleEnabled: (modelId: number, enabled: boolean) => void
	}
	let {
		models,
		defaultsByModel,
		local = false,
		onOpen,
		onUse,
		onToggleEnabled
	}: Props = $props()

	let query = $state("")
	let showHidden = $state(false)

	const rows = $derived.by(() => {
		const q = query.trim().toLowerCase()
		return models.filter((m) => {
			if (!showHidden && m.enabled === false) return false
			if (!q) return true
			return (
				m.model.toLowerCase().includes(q) ||
				(m.name ?? "").toLowerCase().includes(q)
			)
		})
	})
	const hiddenCount = $derived(
		models.filter((m) => m.enabled === false).length
	)

	const dash = "—"

	/**
	 * ⚠ The cells and the column headers are `surface-700-300`, one step
	 * brighter than the muted text everywhere else, because they sit on
	 * `surface-200-800` — the header band and the default row's tint. Muted on
	 * that ground measures 3.77:1 and fails AA; the same token on the 900/950
	 * grounds the rest of the panel uses is fine. The ground decides, not the
	 * role (§2.5: "when you add a colour pairing, measure it").
	 */
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-2">
		<div class="w-[280px] max-w-full">
			<label class="sr-only" for="model-table-filter">
				Filter models
			</label>
			<input
				id="model-table-filter"
				class="input"
				type="text"
				bind:value={query}
				placeholder={models.length === 1
					? "1 model"
					: `${models.length} models`}
			/>
		</div>
		<div class="flex-1"></div>
		<span class="text-surface-600-400 text-xs">
			{rows.length} of {models.length} shown
		</span>
		{#if hiddenCount}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={() => (showHidden = !showHidden)}
			>
				{showHidden
					? `Hide the ${hiddenCount} hidden`
					: `Show ${hiddenCount} hidden`}
			</button>
		{/if}
	</div>

	<div
		class="border-surface-300-700 overflow-hidden rounded-[12px] border"
		role="table"
		aria-label="Models"
	>
		<div
			class="bg-surface-200-800 text-surface-700-300 grid items-center gap-3 px-4 py-2.5 text-[11px] font-semibold"
			style="grid-template-columns: minmax(0,1fr) 92px {local
				? '110px 110px'
				: '104px 104px'} 150px 40px"
			role="row"
		>
			<span role="columnheader">Model</span>
			<span role="columnheader" class="text-right">Context</span>
			{#if local}
				<span role="columnheader" class="text-right">Quant</span>
				<span role="columnheader" class="text-right">Size</span>
			{:else}
				<span role="columnheader" class="text-right">In / 1M</span>
				<span role="columnheader" class="text-right">Out / 1M</span>
			{/if}
			<span role="columnheader">Can do</span>
			<span role="columnheader">
				<span class="sr-only">Actions</span>
			</span>
		</div>

		{#each rows as model (model.id)}
			{@const display = modelDisplay(model)}
			{@const defaults = defaultsByModel[model.id] ?? []}
			{@const hidden = model.enabled === false}
			{@const missing = !!model.missingSince}
			<div
				class="border-surface-300-700 grid items-center gap-3 border-t px-4 py-2.5 {defaults.length
					? 'bg-surface-200-800'
					: ''} {hidden || missing ? 'opacity-55' : ''}"
				style="grid-template-columns: minmax(0,1fr) 92px {local
					? '110px 110px'
					: '104px 104px'} 150px 40px"
				role="row"
			>
				<span role="cell" class="flex min-w-0 items-center gap-2">
					<button
						type="button"
						class="hover:text-primary-500 min-w-0 truncate text-left text-sm font-medium"
						title={display.identifier}
						onclick={() => onOpen(model.id)}
					>
						{display.name}
					</button>
					{#each defaults as capability (capability)}
						<span
							class="preset-tonal-primary text-primary-900 dark:text-primary-300 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold"
						>
							<Icons.Star
								size={9}
								fill="currentColor"
								aria-hidden="true"
							/>
							{capability}
						</span>
					{/each}
					{#if missing}
						<span
							class="border-surface-300-700 text-surface-600-400 shrink-0 rounded border px-1.5 py-0.5 text-[11px]"
						>
							No longer listed
						</span>
					{/if}
				</span>

				<!-- The admin's override wins over the host's claim, here as
				     everywhere: it is the number the resolver will use. -->
				<span
					role="cell"
					class="text-surface-700-300 truncate text-right text-[13px]"
				>
					{formatContext(
						model.contextWindow ?? model.facts?.contextWindow
					) ?? dash}
				</span>

				{#if local}
					<span
						role="cell"
						class="text-surface-700-300 truncate text-right text-[13px]"
					>
						{display.quantization ?? dash}
					</span>
					<span
						role="cell"
						class="text-surface-700-300 truncate text-right text-[13px]"
					>
						{formatSize(model.facts?.sizeBytes) ?? dash}
					</span>
				{:else}
					<span
						role="cell"
						class="text-surface-700-300 truncate text-right text-[13px]"
					>
						{formatPrice(
							model.facts?.pricing?.inPerMTok,
							model.facts?.pricing?.currency
						) ?? dash}
					</span>
					<span
						role="cell"
						class="text-surface-700-300 truncate text-right text-[13px]"
					>
						{formatPrice(
							model.facts?.pricing?.outPerMTok,
							model.facts?.pricing?.currency
						) ?? dash}
					</span>
				{/if}

				<span role="cell" class="flex min-w-0 items-center gap-1.5">
					{#if model.facts?.inputModalities?.includes("image")}
						<span
							class="preset-tonal-surface text-surface-700-300 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold"
						>
							Vision
						</span>
					{/if}
					{#if display.parameters}
						<span
							class="preset-tonal-surface text-surface-700-300 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold"
						>
							{display.parameters}
						</span>
					{/if}
					<span class="flex-1"></span>
					{#if !defaults.length && !missing && !hidden}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface shrink-0 text-[11px] font-semibold"
							onclick={() => onUse(model.id)}
						>
							Use
						</button>
					{/if}
				</span>

				<span role="cell" class="flex justify-end">
					<button
						type="button"
						class="text-surface-600-400 hover:text-surface-950-50 grid size-7 place-items-center rounded-lg"
						onclick={() => onToggleEnabled(model.id, hidden)}
						aria-label={hidden
							? `Show ${display.name}`
							: `Hide ${display.name}`}
						title={hidden
							? "Show in pickers"
							: "Hide from pickers — nothing is deleted"}
					>
						{#if hidden}
							<Icons.Eye size={15} aria-hidden="true" />
						{:else}
							<Icons.EyeOff size={15} aria-hidden="true" />
						{/if}
					</button>
				</span>
			</div>
		{/each}

		{#if !rows.length}
			<p
				class="border-surface-300-700 text-surface-600-400 border-t px-4 py-6 text-center text-sm"
			>
				{query ? "Nothing matches." : "No models listed yet."}
			</p>
		{/if}
	</div>
</div>
