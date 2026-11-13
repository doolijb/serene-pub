<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import {
		versionLabelText,
		type CardVersionOption
	} from "../characterForms/cardVersionWords"

	/**
	 * A card file that differs from the card you already have: add it as a new
	 * card version (the default) or keep it as a card of its own. There is no
	 * overwrite — the older card version stays.
	 */
	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		existingName: string
		/** The card's current card version. */
		currentVersion: CardVersionOption
		/** The label the file's card version is offered under. */
		suggestedLabel: string | null
		/** `label` is trimmed; empty: null, and the server suggests one. */
		onAddVersion: (label: string | null) => void
		onSaveAsNewCard: () => void
		onCancel: () => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		existingName,
		currentVersion,
		suggestedLabel,
		onAddVersion,
		onSaveAsNewCard,
		onCancel
	}: Props = $props()

	const currentWords = $derived(
		versionLabelText(currentVersion.label, currentVersion.number)
	)
	let label = $state("")
	// Prefilled each time the dialog opens for a conflict.
	$effect(() => {
		if (open) label = suggestedLabel ?? ""
	})
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-w-md space-y-6 p-6 shadow-xl"
			>
				<header class="flex justify-between">
					<h2 class="h2">Character already exists</h2>
				</header>
				<form
					class="space-y-6"
					onsubmit={(e) => {
						e.preventDefault()
						onAddVersion(label.trim() || null)
					}}
				>
					<article class="space-y-3">
						<p class="opacity-60">
							You already have {`"${existingName}"`}, from this
							file or an earlier copy of it, and the file differs
							from its current version, {currentWords}.
						</p>
						<div class="flex flex-col">
							<label
								class="text-surface-600-400 mb-1.5 text-xs"
								for="cardImportVersionLabel"
							>
								Version label
							</label>
							<input
								id="cardImportVersionLabel"
								type="text"
								class="input rounded-base"
								bind:value={label}
							/>
						</div>
					</article>
					<footer class="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={onCancel}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={onSaveAsNewCard}
						>
							Save as a new card
						</button>
						<button
							type="submit"
							class="btn preset-filled-primary-500"
						>
							Add as a new version
						</button>
					</footer>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
