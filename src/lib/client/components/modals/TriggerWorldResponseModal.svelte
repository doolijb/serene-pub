<script lang="ts">
	import { Modal } from "@skeletonlabs/skeleton-svelte"
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
		narratorName = "The World"
	}: Props = $props()

	let instructions = $state("")

	$effect(() => {
		// Clear the field each time the modal is (re)opened, so leftover text
		// from a previous World Response doesn't silently carry over.
		if (open) instructions = ""
	})
</script>

<Modal
	{open}
	{onOpenChange}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl w-[min(95vw,520px)]"
	backdropClasses="backdrop-blur-sm"
	role="dialog"
	aria-labelledby="trigger-world-response-title"
>
	{#snippet content()}
		<header class="flex items-center gap-2">
			<Icons.CloudSun size={20} class="text-primary-500" />
			<h2 id="trigger-world-response-title" class="h2">
				Trigger {narratorName}
			</h2>
		</header>
		<article class="space-y-2">
			<p class="text-muted-foreground text-sm">
				Let {narratorName} narrate — describe the environment, atmosphere,
				or any side characters and encounters, instead of a chat character.
			</p>
			<label class="text-sm font-semibold" for="world-instructions">
				Extra instructions (optional)
			</label>
			<textarea
				id="world-instructions"
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
	{/snippet}
</Modal>
