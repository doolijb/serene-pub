<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		onConfirm: () => void
		onCancel: () => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		onConfirm,
		onCancel
	}: Props = $props()
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
					<h2 class="h2">Confirm</h2>
				</header>
				<article>
					<p class="opacity-60">
						Your Ollama connection settings have unsaved changes.
						Are you sure you want to discard them?
					</p>
				</article>
				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-filled-surface-500"
						onclick={onCancel}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={onConfirm}
					>
						Discard
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
