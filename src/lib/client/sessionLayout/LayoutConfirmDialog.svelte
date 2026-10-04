<script lang="ts">
	/**
	 * The layout editor's one confirmation: every verb that REPLACES this
	 * session's layout (a card, Start again from, Reset to genre default
	 * layout, Start from scratch) and deleting one of your layouts. The words
	 * are `./startFrom`'s, so both editors say the same thing; this only draws
	 * them. Skeleton `Dialog` in a `Portal` (STYLE-GUIDE §6.6), as an
	 * `alertdialog`: it covers the phone's layouts sheet as well as the
	 * desktop pane (z-50, §5.4).
	 *
	 * A copy's confirm is the primary: the session gets a working layout back,
	 * as a retake gets its turn back. What only takes away — a delete, Start
	 * from scratch clearing every widget's settings and style, Save changes to
	 * over changes saved elsewhere — is drawn in error. An alertdialog is
	 * answered, never dismissed by a click outside: only its buttons and
	 * Escape close it.
	 *
	 * A question may name a second way out (`alternative`, brief 6b): a
	 * tonal button between Cancel and the confirm — Save changes to over an
	 * Updated layout offers **Start again from "X"** there.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import type { LayoutConfirm } from "./startFrom"

	interface Props {
		/** What is being asked; null when nothing is. */
		confirm: LayoutConfirm | null
		onConfirm: () => void
		onCancel: () => void
		/** The question's `alternative`, chosen. */
		onAlternative?: () => void
		/**
		 * Where focus goes once the question closes, when the control it was
		 * asked from may be gone (the phone sheet closes on a yes). Null or
		 * absent: back to where it was.
		 */
		finalFocus?: () => HTMLElement | null
	}

	let { confirm, onConfirm, onCancel, onAlternative, finalFocus }: Props =
		$props()

	/**
	 * What the content draws: the question, and after it is answered the
	 * last one, while the dialog closes. Emptying the content on close
	 * would detach the button that was pressed — and a listener further
	 * down the same key press (the phone sheet's Escape) could then no
	 * longer tell that the key came from inside this dialog.
	 */
	let last: LayoutConfirm | null = null
	let shown = $derived.by(() => {
		if (confirm) last = confirm
		return confirm ?? last
	})
</script>

<Dialog
	open={confirm !== null}
	role="alertdialog"
	closeOnInteractOutside={false}
	finalFocusEl={finalFocus}
	onOpenChange={(e: OpenChangeDetails) => {
		if (!e.open) onCancel()
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<!-- A question with a second way out gets the room to keep its
			     three buttons on one line. -->
			<Dialog.Content
				class="card bg-surface-100-900 w-full {shown?.alternative
					? 'max-w-lg'
					: 'max-w-md'} space-y-4 p-6 shadow-xl"
				data-layout-confirm
			>
				{#if shown}
					<Dialog.Title class="h4">{shown.title}</Dialog.Title>
					<Dialog.Description class="space-y-2 text-sm">
						{#each shown.lines as line, i (i)}
							<p class:text-surface-600-400={i > 0}>{line}</p>
						{/each}
					</Dialog.Description>
					<footer class="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal"
							data-confirm-no
							onclick={onCancel}
						>
							Cancel
						</button>
						{#if shown.alternative}
							<button
								type="button"
								class="btn preset-tonal"
								data-confirm-alternative
								disabled={!confirm}
								onclick={() => onAlternative?.()}
							>
								{shown.alternative}
							</button>
						{/if}
						<button
							type="button"
							class="btn {shown.tone === 'danger'
								? 'preset-filled-error-500'
								: 'preset-filled-primary-500'}"
							data-confirm-yes
							disabled={shown.pending || !confirm}
							onclick={onConfirm}
						>
							{shown.confirmLabel}
						</button>
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
