<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	import PanelNavHeader from "../panels/PanelNavHeader.svelte"
	import DetailHero from "../panels/DetailHero.svelte"
	import { quantRows } from "./QuantPicker.svelte"
	import {
		preselectedQuantIndex,
		repoOwner,
		repoTitle,
		type FinderTier,
		type QuantFile
	} from "./finder"
	import type { MemoryTier } from "./memoryTier"

	/**
	 * A model's own page inside the Get a model pane (the finder model page).
	 * Presentational: it knows nothing about sockets. The finder view passes
	 * everything in and hears `onDownload` / `onCancel` / `onBack`.
	 */
	interface Props {
		/** The row's name: "owner/repo", or a list's own name. */
		name: string
		/** Which group the row came from: drives the hero's source word and icon. */
		source: "recommended" | "hub"
		tier: MemoryTier
		/** The row's tier chip, when the list graded it. */
		tierChip?: FinderTier | null
		description?: string | null
		/** From `modelPageFacts` — only the facts known. */
		facts: readonly { label: string; value: string }[]
		/** The presence sentence (D3), e.g. "You have this on KoboldCPP". */
		presenceText?: string | null
		/** The files, sizes already merged from the Hub's answer. */
		quants: readonly QuantFile[]
		/** Why there are no files (Ollama's `quantsNote`). */
		quantsNote?: string | null
		noun?: "size" | "precision"
		/** True while the Hub card is being asked. */
		cardLoading?: boolean
		/** The Hub card's failure, as a sentence. */
		cardError?: string | null
		/** The destination's label ("KoboldCPP", "Home · Ollama"), or null. */
		destinationLabel: string | null
		/** Where the files land (`landingNote`), or null. */
		landingNote: string | null
		/** Set when nothing can be downloaded to this destination. */
		disabledReason?: string | null
		/** The destination already holds it. */
		held?: "on_disk" | "pulled" | null
		/** This model is arriving right now. */
		busy?: { percent: number | null; progress: string } | null
		onDownload: (quant: QuantFile | null) => void
		onCancel: () => void
		onBack: () => void
	}
	let {
		name,
		source,
		tier,
		tierChip = null,
		description = null,
		facts,
		presenceText = null,
		quants,
		quantsNote = null,
		noun = "size",
		cardLoading = false,
		cardError = null,
		destinationLabel,
		landingNote,
		disabledReason = null,
		held = null,
		busy = null,
		onDownload,
		onCancel,
		onBack
	}: Props = $props()

	// Seeded once per model, so a different model never opens on the previous
	// one's index (the same seeding the inline quant picker does).
	let selected = $state(0)
	let seededFor = $state<string | null>(null)
	$effect(() => {
		if (seededFor === name) return
		selected = Math.max(0, preselectedQuantIndex(quants, tier))
		seededFor = name
	})

	const headingId = $props.id()
	const filesTitle = $derived(
		noun === "precision" ? "Choose a precision" : "Pick a size"
	)
	const chosen = $derived(quants[selected] ?? null)
	const downloadLabel = $derived(
		chosen ? `Download ${chosen.name}` : "Download"
	)
	const subtitle = $derived(
		[repoOwner(name), source === "hub" ? "Hugging Face" : "Recommended"]
			.filter(Boolean)
			.join(" · ")
	)
	const footerNote = $derived(
		[destinationLabel ? `To ${destinationLabel}` : "", landingNote ?? ""]
			.filter(Boolean)
			.join(" · ")
	)
	const percent = $derived(
		busy?.percent == null ? null : Math.min(100, Math.max(0, busy.percent))
	)

	let root = $state<HTMLElement>()
	// Opening the page moves focus to its heading.
	$effect(() => {
		if (!root) return
		const heading = root.querySelector<HTMLElement>("[data-panel-title]")
		heading?.setAttribute("tabindex", "-1")
		heading?.focus()
	})

	/** Escape is Back — only while focus is inside and not in a text box. */
	function onKeydown(e: KeyboardEvent) {
		if (e.key !== "Escape" || e.defaultPrevented) return
		const el = e.target
		if (
			el instanceof HTMLElement &&
			(el.closest("input, textarea, select") || el.isContentEditable)
		)
			return
		e.preventDefault()
		onBack()
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	bind:this={root}
	class="flex min-h-0 flex-1 flex-col gap-3"
	aria-label={repoTitle(name)}
	onkeydown={onKeydown}
>
	<PanelNavHeader title={repoTitle(name)} {onBack} backLabel="Back" />

	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
		<DetailHero
			title={repoTitle(name)}
			{subtitle}
			icon={source === "hub" ? Icons.Globe : Icons.Package}
		>
			{#snippet chips()}
				{#if tierChip}
					<span
						class="text-meta rounded-full px-2 py-0.5 {tierChip.matches
							? 'preset-tonal-primary'
							: 'preset-tonal-surface'}"
					>
						{tierChip.label}
					</span>
				{/if}
			{/snippet}
		</DetailHero>

		{#if description}
			<p class="text-surface-700-300 text-sm leading-relaxed">
				{description}
			</p>
		{/if}

		{#if facts.length}
			<dl class="flex flex-wrap gap-x-4 gap-y-1.5">
				{#each facts as fact (fact.label)}
					<div>
						<dt class="text-surface-600-400 text-xs">
							{fact.label}
						</dt>
						<dd class="text-sm">{fact.value}</dd>
					</div>
				{/each}
			</dl>
		{/if}

		{#if presenceText}
			<p class="text-surface-600-400 text-xs">{presenceText}</p>
		{/if}

		{#if cardLoading}
			<p class="text-surface-600-400 text-xs">
				Reading the repo from Hugging Face…
			</p>
		{:else if cardError}
			<p class="text-surface-600-400 text-xs" role="status">
				{cardError}
			</p>
		{/if}

		<section class="flex flex-col gap-1" aria-labelledby={headingId}>
			<h3
				id={headingId}
				class="[font-family:var(--typo-heading--font-family)] text-base font-semibold"
			>
				{filesTitle}
			</h3>
			{#if quants.length}
				{@render quantRows(
					quants,
					tier,
					selected,
					(i) => (selected = i),
					filesTitle,
					true
				)}
			{:else}
				<p class="text-surface-600-400 text-sm">
					{quantsNote ??
						(noun === "precision"
							? "This model lists no precisions to choose between."
							: "This repo publishes no GGUF files to choose between.")}
				</p>
			{/if}
		</section>
	</div>

	<footer
		class="border-surface-200-800 flex shrink-0 flex-wrap items-center gap-2 border-t pt-3"
	>
		<span
			class="text-surface-600-400 min-w-0 flex-1 truncate text-xs"
			title={footerNote}
		>
			{footerNote}
		</span>
		{#if busy}
			<div class="flex min-w-0 items-center gap-2">
				<span
					class="bg-surface-300-700 h-1.5 w-32 min-w-0 overflow-hidden rounded-full"
					role="progressbar"
					aria-label={`Downloading ${name}`}
					aria-valuenow={percent ?? undefined}
					aria-valuemin={0}
					aria-valuemax={100}
				>
					<span
						class="bg-warning-500 block h-full rounded-full transition-[width]"
						style={`width: ${Math.round(percent ?? 0)}%`}
					></span>
				</span>
				<span class="text-surface-600-400 text-meta shrink-0">
					{busy.progress}
				</span>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error shrink-0"
					onclick={onCancel}
				>
					Cancel
				</button>
			</div>
		{:else if held}
			<Badge tone="success" size="sm" class="shrink-0">
				{held === "on_disk" ? "On disk" : "Pulled"}
			</Badge>
		{:else}
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 max-w-full min-w-0"
				disabled={!!disabledReason}
				title={disabledReason ?? downloadLabel}
				onclick={() => onDownload(chosen)}
			>
				<Icons.Download size={14} aria-hidden="true" class="shrink-0" />
				<span class="min-w-0 truncate">
					{downloadLabel}
				</span>
			</button>
		{/if}
	</footer>
</section>
