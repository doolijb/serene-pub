<script lang="ts">
	/**
	 * The Admin view's one unsaved-edits question, asked before a section's
	 * edits are lost (another section, closing the view, Back) or before the
	 * view steps down with Escape. Hosted by AdminView and reached through
	 * `adminRouter.confirmDiscard()`.
	 *
	 * 🚧 RF fix 2, item 5 (2026-10-23): **Stay** · **Discard**, and **Save**
	 * where the section on screen offers its own (`adminUnsavedEdits(…,
	 * save)`) — it saves, and only then goes on.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		onConfirm: () => void
		onCancel: () => void
		/** 🚧 The section offers its Save: the question has three answers. */
		onSave?: () => void
		saving?: boolean
	}

	let {
		open = $bindable(),
		onOpenChange,
		onConfirm,
		onCancel,
		onSave,
		saving = false
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
				data-unsaved-changes
			>
				<header class="flex justify-between">
					<Dialog.Title class="h2">You have unsaved changes</Dialog.Title>
				</header>
				<article>
					<Dialog.Description class="opacity-60">
						{onSave
							? "Save them before you go, or discard them. Stay keeps you here with them."
							: "If you go on, they are lost. Stay keeps you here with them."}
					</Dialog.Description>
				</article>
				<footer class="flex flex-wrap justify-end gap-3">
					<button
						class="btn preset-tonal-surface"
						onclick={onCancel}
						disabled={saving}
						data-unsaved-stay
					>
						Stay
					</button>
					<button
						class="btn {onSave
							? 'preset-tonal-error'
							: 'preset-filled-error-500'}"
						onclick={onConfirm}
						disabled={saving}
						data-unsaved-discard
					>
						Discard
					</button>
					{#if onSave}
						<button
							class="btn preset-filled-primary-500"
							onclick={onSave}
							disabled={saving}
							data-unsaved-save
						>
							{#if saving}
								<Icons.LoaderCircle
									size={16}
									class="animate-spin"
									aria-hidden="true"
								/>
								Saving…
							{:else}
								Save
							{/if}
						</button>
					{/if}
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
