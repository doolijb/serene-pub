<script lang="ts">
	/**
	 * Delete a character? — the confirm before `characters:delete`
	 * (less-confusing plan F2, 2026-10-11; modelled on SpritesTab's sprite
	 * delete).
	 *
	 * Names the character and says what goes with it. The delete is soft
	 * (`charactersDelete`): the card, its gallery and its sprites leave the
	 * Characters list and cannot be opened again, but every session that
	 * already has it keeps it in the cast, messages, name and picture
	 * included. So the dialog says the sessions keep it, never that it
	 * leaves them. Skeleton `Dialog` in a `Portal` (STYLE-GUIDE §6.6).
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		open: boolean
		/** The character's name; absent reads "this character". */
		name?: string | null
		onConfirm: () => void
		onCancel: () => void
	}

	let { open, name, onConfirm, onCancel }: Props = $props()

	const who = $derived(name?.trim() || "")
	const title = $derived(who ? `Delete ${who}?` : "Delete this character?")
	const goes = $derived(
		who
			? `${who} leaves your characters for good, along with the gallery and sprites on the card.`
			: "It leaves your characters for good, along with the gallery and sprites on the card."
	)
	const stays = $derived(
		who
			? `Sessions that already have ${who} keep ${who} in their cast, with every message.`
			: "Sessions that already have it keep it in their cast, with every message."
	)
</script>

<Dialog
	{open}
	role="alertdialog"
	onOpenChange={(e: OpenChangeDetails) => {
		if (!e.open) onCancel()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
			>
				<header class="flex items-center gap-3">
					<Icons.Trash2
						class="text-error-600-400 h-5 w-5 shrink-0"
						aria-hidden="true"
					/>
					<Dialog.Title class="text-lg font-bold">{title}</Dialog.Title>
				</header>
				<Dialog.Description
					class="text-surface-600-400 space-y-2 text-sm"
					data-delete-character-what
				>
					<span class="block">{goes}</span>
					<span class="block">{stays}</span>
				</Dialog.Description>
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={onCancel}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-error-500"
						onclick={onConfirm}
					>
						<Icons.Trash2 class="h-4 w-4" aria-hidden="true" />
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
