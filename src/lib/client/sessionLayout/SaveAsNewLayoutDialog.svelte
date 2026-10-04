<script lang="ts">
	/**
	 * **Save as new layout** (owner L3): a name and an optional description for
	 * a new layout made from this session's layout, which every session of the
	 * genre can then start from — and which this session now counts as having
	 * started from. Its own button in both editors, never folded into Done
	 * (Done saves to this session only). Skeleton `Dialog` in a `Portal`
	 * (STYLE-GUIDE §6.6); Save is its one filled primary.
	 *
	 * The fields outlive a refused save (the editor refuses to commit a
	 * layout with nothing in the middle, and says why): the person closes
	 * this, fixes the middle, and finds the name still typed. A save that
	 * lands clears them.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		/**
		 * Save it. Resolves whether the save was sent — false when the editor
		 * refused to commit the arrangement first.
		 */
		onSave: (name: string, description: string) => boolean
		/**
		 * Where focus goes once it closes, when the control it was opened from
		 * may be gone (the phone sheet closes on a save). Null or absent: back
		 * to where it was.
		 */
		finalFocus?: () => HTMLElement | null
	}

	let { open = $bindable(), onSave, finalFocus }: Props = $props()

	let name = $state("")
	let description = $state("")

	function save() {
		const n = name.trim()
		if (!n) return
		const sent = onSave(n, description.trim())
		if (sent) {
			name = ""
			description = ""
		}
		open = false
	}
</script>

<Dialog
	{open}
	finalFocusEl={finalFocus}
	onOpenChange={(e: OpenChangeDetails) => (open = e.open)}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
				data-save-as
			>
				<Dialog.Title class="h4">Save as new layout</Dialog.Title>
				<Dialog.Description class="text-surface-600-400 text-sm">
					Keeps this session's layout, and the settings and styles you've
					changed on the widgets it shows, as a layout any session of this
					genre can start from.
				</Dialog.Description>
				<form
					class="space-y-3"
					onsubmit={(e) => {
						e.preventDefault()
						save()
					}}
				>
					<label class="label">
						<span class="label-text">Name</span>
						<input
							class="input"
							type="text"
							maxlength="80"
							required
							autocomplete="off"
							bind:value={name}
							data-save-as-name
						/>
					</label>
					<label class="label">
						<span class="label-text">
							Description <span class="text-surface-600-400">(optional)</span>
						</span>
						<textarea
							class="textarea"
							rows="2"
							maxlength="400"
							bind:value={description}
							data-save-as-description
						></textarea>
					</label>
					<footer class="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal"
							onclick={() => (open = false)}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="btn preset-filled-primary-500"
							disabled={!name.trim()}
							data-save-as-save
						>
							Save
						</button>
					</footer>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
