<script lang="ts">
	/**
	 * The confirmation in front of moving the entity star off one model onto
	 * another — the one dialog, the one set of words, wherever the star moves
	 * (`useStarConfirm`).
	 *
	 * The number is how many entries and messages are re-scanned for names.
	 * No time estimate — nothing in the lane measures throughput.
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		/** Annotated entries and messages; null while they are being counted. */
		rows: number | null
		/** What runs now, by name — the cancel button keeps it. */
		currentName: string | null
		/** What the confirm installs, by name. */
		nextName: string | null
		/** The current model's files are this install's own (a local model). */
		currentIsLocal: boolean
		onConfirm: () => void
		onCancel: () => void
	}
	let {
		open,
		rows,
		currentName,
		nextName,
		currentIsLocal,
		onConfirm,
		onCancel
	}: Props = $props()
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
				class="card bg-surface-100-900 w-full max-w-lg space-y-5 p-6 shadow-xl"
			>
				<div
					role="alertdialog"
					aria-labelledby="reannotate-title"
					aria-describedby="reannotate-desc"
				>
					<header>
						<h2 id="reannotate-title" class="h2 text-lg font-bold">
							{nextName
								? `Switch entity extraction to ${nextName}?`
								: "Switch the entity model?"}
						</h2>
						<p class="text-surface-600-400 mt-1 text-sm">
							{#if currentName}
								Replaces {currentName} as the one entity model for
								this pub.
							{:else if nextName}
								Sets {nextName} as the entity model for this pub.
							{:else}
								One entity model runs for this whole install.
							{/if}
						</p>
					</header>
					<article
						id="reannotate-desc"
						class="preset-tonal-surface mt-4 space-y-2 rounded-lg p-3 text-sm"
					>
						<p class="flex items-start gap-2">
							<Icons.AlertTriangle
								class="text-warning-500 mt-0.5 h-4 w-4 shrink-0"
								aria-hidden="true"
							/>
							<span>
								{#if rows === null}
									<span class="text-surface-600-400">
										Counting what is annotated…
									</span>
								{:else}
									<strong class="font-semibold">
										{rows.toLocaleString()}
										{rows === 1
											? "entry or message is"
											: "entries and messages are"} re-scanned
										for names
									</strong>
									<span>
										Names one model finds are not the names
										another finds.
									</span>
								{/if}
							</span>
						</p>
						<p class="text-surface-600-400">
							Names your lorebook declares keep matching
							throughout.
						</p>
						{#if currentIsLocal && currentName}
							<p class="text-surface-600-400">
								{currentName} stays on disk. Switching back later
								re-scans again.
							</p>
						{/if}
					</article>
					<footer class="mt-5 flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-filled-surface-500"
							onclick={onCancel}
						>
							{currentName ? `Keep ${currentName}` : "Cancel"}
						</button>
						<button
							type="button"
							class="btn preset-filled-primary-500"
							onclick={onConfirm}
						>
							<Icons.RefreshCw size={16} aria-hidden="true" />
							Switch and re-scan
						</button>
					</footer>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
