<script lang="ts">
	/**
	 * The Admin view's one unsaved-edits question, asked before a section is
	 * left (another section, closing the view, Back). Hosted by AdminView and
	 * reached through `adminRouter.confirmDiscard()`.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		onConfirm: () => void
		onCancel: () => void
	}

	let { open = $bindable(), onOpenChange, onConfirm, onCancel }: Props =
		$props()
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
					<Dialog.Title class="h2">Discard unsaved changes?</Dialog.Title>
				</header>
				<article>
					<Dialog.Description class="opacity-60">
						You have changes you haven't saved. If you go on, they
						are lost.
					</Dialog.Description>
				</article>
				<footer class="flex justify-end gap-4">
					<button class="btn preset-filled-surface-500" onclick={onCancel}>
						Keep editing
					</button>
					<button class="btn preset-filled-error-500" onclick={onConfirm}>
						Discard
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
