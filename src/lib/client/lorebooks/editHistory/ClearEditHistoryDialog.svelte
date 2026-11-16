<script lang="ts">
	/**
	 * 🚧 The question before an Edit history is cleared — one entry's, one
	 * lorebook's, or every lorebook's (Admin › Data). STYLE-GUIDE §6.6: an
	 * `alertdialog` in a `Portal`, answered and never dismissed by a click
	 * outside; its confirm is filled `error`, since clearing only takes away.
	 * The caller words the question and names the count (`editHistoryCopy.ts`)
	 * and says a refusal through `error`, under the buttons.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { CLEAR_CONFIRM_LABEL } from "./editHistoryCopy"

	interface Props {
		open: boolean
		question: string
		/** What goes and what stays, with the count; null while the count is asked. */
		sentence: string | null
		busy?: boolean
		error?: string
		onConfirm: () => void
		onCancel: () => void
	}

	let {
		open,
		question,
		sentence,
		busy = false,
		error = "",
		onConfirm,
		onCancel
	}: Props = $props()
</script>

<Dialog
	{open}
	role="alertdialog"
	closeOnInteractOutside={false}
	onOpenChange={(e: OpenChangeDetails) => {
		if (!e.open) onCancel()
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
				data-testid="clear-edit-history-dialog"
			>
				<Dialog.Title class="h4">{question}</Dialog.Title>
				<Dialog.Description class="text-sm" data-clear-sentence>
					{sentence ?? "…"}
				</Dialog.Description>
				{#if error}
					<p class="text-error-600-400 text-sm" role="alert">
						{error}
					</p>
				{/if}
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal"
						onclick={onCancel}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-error-500"
						disabled={busy || sentence === null}
						onclick={onConfirm}
					>
						{CLEAR_CONFIRM_LABEL}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
