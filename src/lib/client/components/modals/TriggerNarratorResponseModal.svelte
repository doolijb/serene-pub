<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		onTrigger: (instructions: string) => void
		onCancel: () => void
		narratorName?: string
	}

	let {
		open = $bindable(),
		onOpenChange,
		onTrigger,
		onCancel,
		narratorName = "Narrator"
	}: Props = $props()

	let instructions = $state("")

	$effect(() => {
		// Clear the field each time the modal is (re)opened, so leftover text
		// from a previous Narrator response doesn't silently carry over.
		if (open) instructions = ""
	})
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
				class="card bg-surface-100-900 w-[min(95vw,520px)] space-y-6 p-6 shadow-xl"
				role="dialog"
				aria-labelledby="trigger-narrator-response-title"
			>
				<header class="flex items-center gap-2">
					<Icons.CloudSun size={20} class="text-primary-500" />
					<h2 id="trigger-narrator-response-title" class="h2">
						Trigger {narratorName}
					</h2>
				</header>
				<article class="space-y-2">
					<p class="text-muted-foreground text-sm">
						Let {narratorName} narrate — describe the environment, atmosphere,
						or any side characters and encounters, instead of a chat
						character.
					</p>
					<label
						class="text-sm font-semibold"
						for="narrator-instructions"
					>
						Extra instructions (optional)
					</label>
					<textarea
						id="narrator-instructions"
						bind:value={instructions}
						class="textarea w-full"
						rows="4"
						placeholder="e.g. Focus on the weather turning stormy, or have the shopkeeper notice the party..."
					></textarea>
				</article>
				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-filled-surface-500"
						onclick={onCancel}
						type="button"
						aria-label="Cancel"
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-primary-500"
						onclick={() => onTrigger(instructions.trim())}
						type="button"
						aria-label="Trigger {narratorName}"
					>
						<Icons.CloudSun size={14} /> Trigger
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
