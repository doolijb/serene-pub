<script lang="ts">
	/**
	 * The confirmation in front of anything that re-embeds the index — the one
	 * dialog, the one set of words.
	 *
	 * Two things open it: moving the embedding star to a model the stored
	 * vectors were not made by, and saving an edit of the starred connection
	 * that makes it another model (another host, another model identifier).
	 * Both are priced by the server first (`vectorization:reindexCost`) and
	 * open this only when the answer is more than zero, so a re-star of the
	 * same model, or a respelled address, never shows it.
	 *
	 * The number is the whole point: how many stored vectors are re-embedded,
	 * and where they live. No time estimate — nothing in the queue measures
	 * throughput, so there is no honest rate to put here.
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		/** The server's price; null while it is being counted. */
		cost: Sockets.Vectorization.ReindexCost.Response | null
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
		cost,
		currentName,
		nextName,
		currentIsLocal,
		onConfirm,
		onCancel
	}: Props = $props()

	const rows = $derived(cost?.rows ?? null)
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
					aria-labelledby="reindex-title"
					aria-describedby="reindex-desc"
				>
					<header>
						<h2 id="reindex-title" class="h2 text-lg font-bold">
							{nextName
								? `Switch embeddings to ${nextName}?`
								: "Switch the embedding model?"}
						</h2>
						<p class="text-surface-600-400 mt-1 text-sm">
							{#if currentName}
								Replaces {currentName} as the one embedding model for
								this pub.
							{:else if nextName}
								Sets {nextName} as the embedding model for this pub.
							{:else}
								One embedding model runs for this whole install.
							{/if}
						</p>
					</header>
					<!-- What it costs, boxed: three consequences, each its own
					     line, most expensive first. -->
					<article
						id="reindex-desc"
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
										Counting what is stored…
									</span>
								{:else}
									<strong class="font-semibold">
										{rows.toLocaleString()}
										stored {rows === 1 ? "vector is" : "vectors are"} re-embedded
									</strong>
									{#if cost?.lorebooks || cost?.sessions}
										<span>
											— every entry in {(
												cost.lorebooks ?? 0
											).toLocaleString()}
											{(cost.lorebooks ?? 0) === 1
												? "lorebook"
												: "lorebooks"} and the history of {(
												cost.sessions ?? 0
											).toLocaleString()}
											{(cost.sessions ?? 0) === 1
												? "session"
												: "sessions"}.
										</span>
									{/if}
									<span>
										Vectors from the old model don't match the new
										one.
									</span>
								{/if}
							</span>
						</p>
						<p class="text-surface-600-400">
							Until it finishes, retrieval answers from keywords only.
						</p>
						{#if currentIsLocal && currentName}
							<p class="text-surface-600-400">
								{currentName} stays on disk. Switching back later re-embeds
								again.
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
							Switch and re-embed
						</button>
					</footer>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
