<!--
	@component
	The confirm a message's Delete opens. Says yes or no through `onConfirm`
	and `onCancel`; the message is the caller's. `revision` is the server's
	sentence for what the delete does to the timeline (On revision), shown
	when the delete is one.
-->
<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		onOpenChange: (details: OpenChangeDetails) => void
		onConfirm: () => void
		onCancel: () => void
		/** The server's On revision sentence, shown INSTEAD of the plain delete's ("This will branch here; …"). */
		revision?: string | null
	}

	let { open, onOpenChange, onConfirm, onCancel, revision = null }: Props = $props()
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
				class="card bg-surface-100-900 border-surface-200-800 max-w-[95vw] space-y-4 border p-4 shadow-xl"
			>
				<header class="flex justify-between">
					<h2 class="h2">Delete this message?</h2>
				</header>
				<article>
					<!-- One sentence per mode: a revision's is the server's
					     (Overwrite or Branch), never beside the plain delete's. -->
					{#if revision}
						<p data-revision-sentence>{revision}</p>
					{:else}
						<p class="opacity-60">
							The message and every alternate reply it holds are
							deleted. There is no undo.
						</p>
					{/if}
				</article>
				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-tonal-surface"
						onclick={onCancel}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={onConfirm}
					>
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
