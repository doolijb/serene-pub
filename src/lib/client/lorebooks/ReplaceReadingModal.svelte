<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { READ_INTO_SESSION, replaceReadingSentence } from "./scopes"

	/**
	 * Asks before a book replaces the one the open session reads.
	 *
	 * A session reads one book at a time, so reading this one stops reading
	 * that one. Nothing in either book is changed — the question is only
	 * which book the next turn reads from.
	 */
	interface Props {
		open: boolean
		sessionName: string
		/** The book the session reads now. */
		currentBook: string
		/** The book that would replace it. */
		nextBook: string
		onConfirm: () => void
		onCancel: () => void
	}

	let { open, sessionName, currentBook, nextBook, onConfirm, onCancel }: Props =
		$props()
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
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
				class="card bg-surface-100-900 max-w-md space-y-6 p-6 shadow-xl"
			>
				<header>
					<Dialog.Title class="h2">Read {nextBook} instead?</Dialog.Title>
				</header>
				<Dialog.Description class="text-surface-700-300">
					{replaceReadingSentence(sessionName, currentBook, nextBook)}
				</Dialog.Description>
				<footer class="flex justify-end gap-4">
					<button
						type="button"
						class="btn preset-filled-surface-500"
						onclick={onCancel}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={onConfirm}
					>
						{READ_INTO_SESSION}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
