<script lang="ts">
	/**
	 * Regenerate the last turn? — the confirm before a retake (`core#retake`,
	 * lair pass R2, owner 2026-09-28).
	 *
	 * Names what goes: every row of the last turn, from the server's preview
	 * (`sessions:retakeTurn` with `preview`, which writes nothing). The
	 * checkbox is "Don't ask again for this session", saved to the annex by
	 * the caller (`core:annex#retake-quietly`). Skeleton `Dialog` in a
	 * `Portal`, the STYLE-GUIDE §6.6 modal; Regenerate is the primary, not a
	 * destructive red — the turn comes back, rewritten.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { retakeSentence, type RetakeRow } from "./retake"

	interface Props {
		open: boolean
		/** The last turn's rows, as the preview named them. */
		rows: RetakeRow[]
		onConfirm: (quietly: boolean) => void
		onCancel: () => void
	}

	let { open, rows, onConfirm, onCancel }: Props = $props()

	let quietly = $state(false)
	// A fresh ask starts unticked.
	$effect(() => {
		if (open) quietly = false
	})

	const sentence = $derived(retakeSentence(rows))
</script>

<Dialog
	{open}
	role="alertdialog"
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
			>
				<Dialog.Title class="h4">Regenerate the last turn?</Dialog.Title>
				<Dialog.Description data-retake-rows>
					{sentence}
				</Dialog.Description>
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						class="checkbox"
						bind:checked={quietly}
						data-retake-quietly
					/>
					Don't ask again for this session
				</label>
				<footer class="flex justify-end gap-2">
					<button type="button" class="btn preset-tonal" onclick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={() => onConfirm(quietly)}
					>
						Regenerate
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
