<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		entityLabel: "Lorebook" | "Character"
		existingName: string
		onOverwrite: () => void
		onImportAsNew: () => void
		onCancel: () => void
		/**
		 * What Overwrite would also delete that the file cannot bring back
		 * (a lorebook's dated changes, branches…), as one sentence. Shown as a
		 * warning above the choice; omitted when there is nothing to lose.
		 */
		losses?: string | null
	}

	let {
		open = $bindable(),
		onOpenChange,
		entityLabel,
		existingName,
		onOverwrite,
		onImportAsNew,
		onCancel,
		losses = null
	}: Props = $props()

	const noun = $derived(entityLabel.toLowerCase())
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
					<h2 class="h2">{entityLabel} already exists</h2>
				</header>
				<article class="space-y-3">
					<p class="opacity-60">
						You already have a {noun} called "<span
							class="font-semibold">{existingName}</span
						>" that came from this same file or an earlier copy of
						it, and its content differs. Overwrite replaces the
						existing {noun}'s contents with the file's.
					</p>
					{#if losses}
						<p
							class="text-error-600-400 bg-error-500/10 rounded-[8px] p-2 text-sm"
						>
							{losses}
						</p>
					{/if}
					<p class="opacity-60">What would you like to do?</p>
				</article>
				<footer class="flex flex-wrap justify-end gap-2">
					<button
						class="btn preset-filled-surface-500"
						onclick={onCancel}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-primary-500"
						onclick={onImportAsNew}
					>
						Import as new
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={onOverwrite}
					>
						Overwrite existing
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
