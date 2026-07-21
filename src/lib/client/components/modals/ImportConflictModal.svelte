<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		entityLabel: "Lorebook" | "Character" | "Persona"
		existingName: string
		onOverwrite: () => void
		onImportAsNew: () => void
		onCancel: () => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		entityLabel,
		existingName,
		onOverwrite,
		onImportAsNew,
		onCancel
	}: Props = $props()
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-md">
				<header class="flex justify-between">
					<h2 class="h2">{entityLabel} Already Imported</h2>
				</header>
				<article>
					<p class="opacity-60">
						You already have a {entityLabel.toLowerCase()} called "<span
							class="font-semibold">{existingName}</span
						>" that was imported from this same source, but its content has
						changed since then. What would you like to do?
					</p>
				</article>
				<footer class="flex flex-wrap justify-end gap-2">
					<button class="btn preset-filled-surface-500" onclick={onCancel}>
						Cancel
					</button>
					<button class="btn preset-filled-primary-500" onclick={onImportAsNew}>
						Import as New
					</button>
					<button class="btn preset-filled-warning-500" onclick={onOverwrite}>
						Overwrite Existing
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
