<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import {
		splitIntoStrokes,
		type Stroke,
		type StrokeKind,
		type StrokeSplitBy
	} from "@serene-pub/sdk"

	/**
	 * 🚧 **Split into strokes** (DESIGN-card-strokes §A.3): one field's text
	 * cut into strokes, previewed row by row before anything changes. Split
	 * puts the rows into the form's draft — nothing is saved until the
	 * character's Save, and Cancel on the form undoes it.
	 */
	interface Props {
		open: boolean
		kind: StrokeKind
		/** The field's name as the form shows it ("Description"). */
		label: string
		/** The field's text, as it stands in the form. */
		text: string
		onSplit: (strokes: Stroke[]) => void
	}

	let { open = $bindable(), kind, label, text, onSplit }: Props = $props()

	const uid = $props.id()

	// Personality is often written PList-style; Description in paragraphs.
	let by = $state<StrokeSplitBy>(untrack(() => (kind === "personality" ? "plist" : "paragraph")))
	let preview = $derived(splitIntoStrokes(text, kind, by))

	const CHOICES: Array<{ value: StrokeSplitBy; label: string; hint: string }> = [
		{ value: "paragraph", label: "Paragraphs", hint: "At every blank line." },
		{ value: "sentence", label: "Sentences", hint: "At every sentence end and line break." },
		{ value: "plist", label: "PList", hint: "Key: value; segments, the key becomes the label." }
	]

	function split() {
		if (!preview.length) return
		onSplit(preview)
		open = false
	}
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-xl flex-col gap-4 p-5 shadow-xl"
				data-split-dialog
			>
				<header class="flex items-start justify-between gap-3">
					<div>
						<Dialog.Title class="text-lg font-semibold">Split {label.toLowerCase()} into strokes</Dialog.Title>
						<Dialog.Description class="text-surface-600-400 text-sm">
							Each piece becomes a stroke you can label, reorder or switch off. Nothing is
							saved until you save the character.
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger class="btn-icon btn-icon-sm hover:preset-tonal" aria-label="Close">
						<Icons.X size={16} />
					</Dialog.CloseTrigger>
				</header>

				<fieldset class="flex flex-col gap-1.5">
					<legend class="text-surface-600-400 mb-1 text-xs">Split by</legend>
					<div class="flex flex-wrap gap-2">
						{#each CHOICES as c (c.value)}
							<label
								class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm {by ===
								c.value
									? 'border-primary-500 preset-tonal-primary'
									: 'border-surface-200-800'}"
								title={c.hint}
							>
								<input
									type="radio"
									class="radio"
									name="{uid}-by"
									value={c.value}
									checked={by === c.value}
									onchange={() => (by = c.value)}
									data-split-by={c.value}
								/>
								<span>{c.label}</span>
							</label>
						{/each}
					</div>
					<p class="text-surface-600-400 text-xs">
						{CHOICES.find((c) => c.value === by)?.hint}
					</p>
				</fieldset>

				<div class="flex min-h-0 flex-col gap-1.5">
					<p class="text-surface-600-400 text-xs" aria-live="polite" data-split-count>
						{preview.length}
						{preview.length === 1 ? "stroke" : "strokes"}
					</p>
					<ol
						class="bg-surface-50-950 border-surface-200-800 flex max-h-[45vh] min-h-0 flex-col gap-1 overflow-y-auto rounded-lg border p-2"
						aria-label="Preview"
					>
						{#each preview as s, i (i)}
							<li class="flex gap-2 text-sm" data-split-row>
								<span class="text-surface-600-400 w-6 shrink-0 text-right text-xs leading-5">{i + 1}</span>
								<span class="min-w-0 whitespace-pre-wrap">
									{#if s.label}<span class="font-medium">{s.label}:</span>{/if}
									{s.text}
								</span>
							</li>
						{:else}
							<li class="text-surface-600-400 text-sm">There is no text to split.</li>
						{/each}
					</ol>
				</div>

				<footer class="flex justify-end gap-2">
					<button type="button" class="btn preset-tonal-surface" onclick={() => (open = false)}>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						disabled={!preview.length}
						onclick={split}
						data-split-apply
					>
						<Icons.Scissors size={16} aria-hidden="true" />
						<span>Split</span>
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
