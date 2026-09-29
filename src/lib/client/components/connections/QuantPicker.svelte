<script lang="ts">
	/**
	 * Which FILE of a repo to fetch — asked once, in one dialog, for both
	 * managers.
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
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { formatBytes } from "./modelManagement"
	import { quantFit, type QuantFile } from "./finder"
	import { tierLabel, type MemoryTier } from "./memoryTier"

	interface Props {
		open: boolean
		/** The repo these files belong to, e.g. `TheBloke/Mistral-7B-GGUF`. */
		repo: string
		quants: readonly QuantFile[]
		tier: MemoryTier
		onCancel: () => void
		onDownload: (quant: QuantFile) => void
	}
	let {
		open = $bindable(),
		repo,
		quants,
		tier,
		onCancel,
		onDownload
	}: Props = $props()

	/**
	 * What is selected when the dialog opens: the list's own recommendation,
	 * else the largest file that still fits, else the first.
	 *
	 * Reset by repo rather than by `open`, so a person who scrolled to Q5 and
	 * pressed Cancel does not come back to a dialog that forgot — and a
	 * DIFFERENT repo never opens on the previous one's index.
	 */
	let selected = $state(0)
	let seededFor = $state<string | null>(null)
	$effect(() => {
		if (!open || seededFor === repo) return
		const recommended = quants.findIndex((q) => q.recommended)
		if (recommended >= 0) selected = recommended
		else {
			let best = -1
			for (let i = 0; i < quants.length; i++)
				if (quantFit(quants[i], tier)?.tone === "good") best = i
			selected = best >= 0 ? best : 0
		}
		seededFor = repo
	})
	$effect(() => {
		if (!open) seededFor = null
	})

	const chosen = $derived(quants[selected] ?? null)
	/** "Download 4.0 GB" when a size is known; the file's name when it is not. */
	const downloadLabel = $derived(
		chosen
			? `Download ${formatBytes(chosen.bytes) ?? chosen.name}`
			: "Download"
	)

	const TONE: Record<string, string> = {
		good: "text-success-500",
		warn: "text-warning-500",
		bad: "text-error-500",
		muted: "text-surface-600-400"
	}
</script>

<Dialog {open} onOpenChange={(e) => !e.open && onCancel()}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-300-700 flex max-h-[80vh] w-[min(92vw,440px)] flex-col gap-3 border p-4 shadow-xl"
			>
				<header class="flex min-w-0 items-start gap-2">
					<div class="min-w-0 flex-1">
						<Dialog.Title
							class="[font-family:var(--typo-heading--font-family)] text-base font-semibold"
						>
							Pick a size
						</Dialog.Title>
						<Dialog.Description
							class="text-surface-600-400 mt-0.5 block truncate text-xs"
						>
							{repo} · {tierLabel(tier)} tier
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger
						class="btn btn-sm hover:preset-tonal-surface shrink-0 p-2"
						aria-label="Close"
					>
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>

				{#if !quants.length}
					<p class="text-surface-600-400 text-sm">
						This repo publishes no GGUF files to choose between.
					</p>
				{:else}
					<div
						class="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1"
						role="radiogroup"
						aria-label="Pick a size"
					>
						{#each quants as quant, index (quant.name + index)}
							{@const fit = quantFit(quant, tier)}
							<button
								type="button"
								role="radio"
								aria-checked={selected === index}
								class="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left {selected ===
								index
									? 'sidebar-row-active'
									: 'hover:preset-tonal-primary'}"
								onclick={() => (selected = index)}
							>
								<span class="min-w-0 flex-1">
									<span
										class="flex min-w-0 items-center gap-1.5"
									>
										<span
											class="min-w-0 truncate text-[15px] font-medium"
										>
											{quant.name}
										</span>
										{#if quant.recommended}
											<span
												class="preset-tonal-primary shrink-0 rounded-full px-1.5 py-0.5 text-[11px]"
											>
												Recommended
											</span>
										{/if}
									</span>
									<span
										class="text-surface-600-400 block truncate text-xs"
									>
										{formatBytes(quant.bytes) ??
											"Size not listed"}{#if fit}
											· <span class={TONE[fit.tone]}>
												{fit.sentence}
											</span>
										{/if}
									</span>
								</span>
							</button>
						{/each}
					</div>
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
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
