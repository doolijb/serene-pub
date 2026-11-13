<script module lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	import { formatBytes } from "./modelManagement"
	import { fitBar, quantFit, type QuantFile } from "./finder"
	import type { MemoryTier } from "./memoryTier"

	const TONE: Record<string, string> = {
		good: "text-success-500",
		warn: "text-warning-500",
		bad: "text-error-600-400",
		muted: "text-surface-600-400"
	}
	const BAR: Record<string, string> = {
		good: "bg-success-500",
		warn: "bg-warning-500",
		bad: "bg-error-500",
		muted: "bg-surface-500"
	}

	export { quantRows }
</script>

<script lang="ts">
	/**
	 * Which FILE of a repo to fetch — asked once, inline, for both managers.
	 *
	 * It expands UNDER the row (or the Download button) that opened it, in the
	 * detail pane's one scroller — never a dialog over the view (owner,
	 * 2026-11-04: "quant picker and Add by name inline"). Focus moves to the
	 * checked radio when it opens; Cancel and Escape close it and the host
	 * returns focus to the button that opened it.
	 *
	 * A GGUF repo publishes the same weights a dozen times at different
	 * precisions, and until the 2026-09-17 concept ruling (R3) there were two
	 * dialogs for choosing between them: KoboldCPP's "Select Quantization" and
	 * Ollama's `HuggingFaceQuantizationModal`, each with its own badge rule,
	 * its own prose and its own idea of whether a size was worth printing.
	 * This is the one the finder opens, whichever destination is selected.
	 *
	 * ## The question it answers is "will this run", not "what is Q4_K_M"
	 *
	 * Both old dialogs led with a paragraph about quantization naming, which
	 * is the answer to a question nobody standing here is asking. What decides
	 * the press is whether the file fits the machine, so the fit is the second
	 * line of every row and the memory tier is named in the subtitle — the
	 * arithmetic lives in `finder.quantFit`, and it says NOTHING at all when
	 * the tier is "Not sure" or the list quoted no size (⚠ every Ollama Hub
	 * row, whose search answers with no byte count).
	 *
	 * ⚠ `Recommended` is the list's own claim about Q4_K_M and is never
	 * inferred from position or size. An image checkpoint's rows are whole
	 * models rather than precisions of one, so none of them carries it —
	 * `quantsFromKcpp` decides that, not this template.
	 */
	import * as Icons from "@lucide/svelte"
	import { tick } from "svelte"
	import { preselectedQuantIndex } from "./finder"
	import { tierLabel } from "./memoryTier"

	interface Props {
		/** The repo these files belong to, e.g. `TheBloke/Mistral-7B-GGUF`. */
		repo: string
		quants: readonly QuantFile[]
		tier: MemoryTier
		/**
		 * What is being chosen: GGUF files are **sizes**; an ONNX dtype or an
		 * audio package variant is a **precision** (the user-facing word).
		 */
		noun?: "size" | "precision"
		onCancel: () => void
		onDownload: (quant: QuantFile) => void
	}
	let {
		repo,
		quants,
		tier,
		noun = "size",
		onCancel,
		onDownload
	}: Props = $props()

	/**
	 * What is selected when the picker opens: the list's own recommendation,
	 * else the largest file that still fits, else the first.
	 *
	 * Seeded per repo, so a DIFFERENT repo never opens on the previous one's
	 * index.
	 */
	let selected = $state(0)
	let seededFor = $state<string | null>(null)
	$effect(() => {
		if (seededFor === repo) return
		selected = Math.max(0, preselectedQuantIndex(quants, tier))
		seededFor = repo
	})

	const headingId = $props.id()
	let section = $state<HTMLElement>()
	// Opening moves focus to the checked radio (the first control when the
	// list is empty is Cancel).
	$effect(() => {
		if (!section) return
		const el = section
		void tick().then(() =>
			el
				.querySelector<HTMLElement>(
					'[role="radio"][aria-checked="true"]'
				)
				?.focus()
		)
	})

	const title = $derived(
		noun === "precision" ? "Choose a precision" : "Pick a size"
	)
	const chosen = $derived(quants[selected] ?? null)
	/** "Download 4.0 GB" when a size is known; the file's name when it is not. */
	const downloadLabel = $derived(
		chosen
			? `Download ${formatBytes(chosen.bytes) ?? chosen.name}`
			: "Download"
	)
</script>

{#snippet quantRows(
	quants: readonly QuantFile[],
	tier: MemoryTier,
	selected: number,
	onSelect: (index: number) => void,
	label: string,
	bars: boolean
)}
	<div class="flex flex-col gap-0.5" role="radiogroup" aria-label={label}>
		{#each quants as quant, index (quant.name + index)}
			{@const fit = quantFit(quant, tier)}
			{@const bar = bars ? fitBar(quant, tier) : null}
			<button
				type="button"
				role="radio"
				aria-checked={selected === index}
				class="rounded-base flex min-h-11 w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left {selected ===
				index
					? 'sidebar-row-active'
					: 'hover:preset-tonal-primary'}"
				onclick={() => onSelect(index)}
			>
				<span class="min-w-0 flex-1">
					<span class="flex min-w-0 items-center gap-1.5">
						<span class="text-lead min-w-0 truncate font-medium">
							{quant.name}
						</span>
						{#if quant.recommended}
							<Badge tone="primary" size="sm" class="shrink-0">
								Recommended
							</Badge>
						{/if}
					</span>
					<span class="text-surface-600-400 block truncate text-xs">
						{formatBytes(quant.bytes) ?? "Size not listed"}{#if fit}
							· <span class={TONE[fit.tone]}>
								{fit.sentence}
							</span>
						{/if}
					</span>
					{#if bar}
						<span
							class="bg-surface-300-700 mt-1 block h-1 w-full overflow-hidden rounded-full"
							aria-hidden="true"
						>
							<span
								class="block h-full rounded-full {BAR[
									bar.tone
								]}"
								style={`width: ${bar.percent}%`}
							></span>
						</span>
					{/if}
				</span>
			</button>
		{/each}
	</div>
{/snippet}

<section
	data-quant-picker
	bind:this={section}
	class="panel-card flex flex-col gap-3"
	aria-labelledby={headingId}
	onkeydown={(e) => {
		if (e.key !== "Escape") return
		e.stopPropagation()
		onCancel()
	}}
>
	<header class="min-w-0">
		<h3
			id={headingId}
			class="[font-family:var(--typo-heading--font-family)] text-base font-semibold"
		>
			{title}
		</h3>
		<p class="text-surface-600-400 mt-0.5 block truncate text-xs">
			{repo} · {tierLabel(tier)} tier
		</p>
	</header>

	{#if !quants.length}
		<p class="text-surface-600-400 text-sm">
			{noun === "precision"
				? "This model lists no precisions to choose between."
				: "This repo publishes no GGUF files to choose between."}
		</p>
	{:else}
		{@render quantRows(
			quants,
			tier,
			selected,
			(i) => (selected = i),
			title,
			false
		)}
	{/if}

	<footer class="flex shrink-0 items-center justify-end gap-2">
		<button
			type="button"
			class="btn btn-sm hover:preset-tonal-surface text-surface-600-400"
			onclick={onCancel}
		>
			Cancel
		</button>
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			disabled={!chosen}
			onclick={() => chosen && onDownload(chosen)}
		>
			<Icons.Download size={14} aria-hidden="true" />
			{downloadLabel}
		</button>
	</footer>
</section>
