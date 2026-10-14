<script lang="ts">
	/**
	 * The loadout editor's questions — *Discard unsaved changes?* and
	 * *Delete this loadout?* — as an `alertdialog` (STYLE-GUIDE §6.6):
	 * answered, never dismissed by a click outside; the confirm is filled
	 * error because it only takes away.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		title: string
		body: string
		keepLabel: string
		confirmLabel: string
		busy?: boolean
		onKeep: () => void
		onConfirm: () => void
	}
	let {
		open,
		title,
		body,
		keepLabel,
		confirmLabel,
		busy = false,
		onKeep,
		onConfirm
	}: Props = $props()
</script>

<Dialog
	{open}
	role="alertdialog"
	closeOnInteractOutside={false}
	onOpenChange={(e) => {
		if (!e.open) onKeep()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
			>
				<Dialog.Title
					class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
				>
					{title}
				</Dialog.Title>
				<Dialog.Description class="text-surface-600-400 text-sm">
					{body}
				</Dialog.Description>
				<div class="flex flex-wrap justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={onKeep}
					>
						{keepLabel}
					</button>
					<button
						type="button"
						class="btn preset-filled-error-500"
						disabled={busy}
						onclick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
