<script lang="ts">
	/**
	 * 🚧 The question an action asks before it fires (`ActionDecl.confirm`,
	 * 2026-10-18; the 100-turn walk: _Reveal the planning notes_ went off on
	 * one press, for good). Every press of such an action — a chip, the
	 * palette, a widget's invoke — lands here first (`pressRouting`); Cancel
	 * fires nothing. A STYLE-GUIDE §6.6 `alertdialog`: answered, never
	 * dismissed by a click outside; its words are the declaration's.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		/** The question, its sentence and the confirm button's words; null when nothing is asked. */
		asking: { question: string; description?: string; confirmLabel: string } | null
		onConfirm: () => void
		onCancel: () => void
	}

	let { asking, onConfirm, onCancel }: Props = $props()
</script>

<Dialog
	open={asking !== null}
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
				data-action-confirm
			>
				<Dialog.Title class="h4">{asking?.question ?? ""}</Dialog.Title>
				{#if asking?.description}
					<Dialog.Description class="text-sm">
						{asking.description}
					</Dialog.Description>
				{/if}
				<footer class="flex justify-end gap-2">
					<button type="button" class="btn preset-tonal" onclick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={onConfirm}
					>
						{asking?.confirmLabel ?? "Continue"}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
