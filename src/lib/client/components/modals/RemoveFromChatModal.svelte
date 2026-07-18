<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		onConfirm: () => void
		onCancel: () => void
		name?: string
		type?: "character" | "persona"
	}

	let {
		open = $bindable(),
		onOpenChange,
		onConfirm,
		onCancel,
		name = "",
		type = "character"
	}: Props = $props()
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-md">
		<header class="flex justify-between">
			<h2 class="h2">
				Remove {type === "persona" ? "Persona" : "Character"}?
			</h2>
		</header>
		<article>
			<p class="opacity-60">
				Are you sure you want to remove {type === "persona"
					? "this persona"
					: "this character"}{name ? ` (${name})` : ""} from the chat?
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button class="btn preset-filled-surface-500" onclick={onCancel}>
				Cancel
			</button>
			<button class="btn preset-filled-error-500" onclick={onConfirm}>
				Remove
			</button>
		</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
