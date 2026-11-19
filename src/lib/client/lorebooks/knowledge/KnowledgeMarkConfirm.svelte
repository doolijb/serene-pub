<script lang="ts">
	/**
	 * 🚧 The one confirmation before entries are marked not common knowledge
	 * (bulk edit's bar). The shape of the bulk delete's confirm.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		title: string
		message: string
		onConfirm: () => void
		onCancel: () => void
		onOpenChange: (e: OpenChangeDetails) => void
	}

	let { open, title, message, onConfirm, onCancel, onOpenChange }: Props =
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
					<Dialog.Title class="h2">{title}</Dialog.Title>
				</header>
				<article>
					<Dialog.Description class="opacity-60">
						{message}
					</Dialog.Description>
				</article>
				<footer class="flex justify-end gap-4">
					<button class="btn preset-tonal-surface" onclick={onCancel}>
						Cancel
					</button>
					<button
						class="btn preset-filled-primary-500"
						onclick={onConfirm}
					>
						Mark not common knowledge
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
