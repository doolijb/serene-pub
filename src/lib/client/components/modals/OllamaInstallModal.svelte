<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		modelName: string
		onclose: () => void
		onconfirm: (modelName: string) => void
	}

	let { open = $bindable(), modelName, onclose, onconfirm }: Props = $props()

	let inputValue = $state(modelName)
	let isLoading = $state(false)

	// Function to clean the model name
	function cleanModelName(input: string): string {
		let cleaned = input.trim()
		
		// Remove "ollama pull " prefix if present
		if (cleaned.toLowerCase().startsWith("ollama pull ")) {
			cleaned = cleaned.substring(12).trim()
		}
		
		// Remove "ollama run " prefix if present
		if (cleaned.toLowerCase().startsWith("ollama run ")) {
			cleaned = cleaned.substring(11).trim()
		}
		
		return cleaned
	}

	function handleConfirm() {
		const cleanedName = cleanModelName(inputValue)
		if (cleanedName) {
			isLoading = true
			onconfirm(cleanedName)
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			handleConfirm()
		}
	}

	// Reset input when modal opens
	$effect(() => {
		if (open) {
			inputValue = modelName
			isLoading = false
		}
	})
</script>

<Modal
	{open}
	onOpenChange={(e) => {
		if (!e.open) {
			onclose()
		}
	}}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl w-[30em] max-w-dvw-lg border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<div class="mb-6">
			<div class="mb-2 flex items-center gap-3">
				<div class="bg-primary-500/10 rounded-full p-2">
					<Icons.Download size={20} class="text-primary-500" />
				</div>
				<h3 class="text-foreground text-lg font-bold">Install Model</h3>
			</div>
			<p class="text-muted-foreground text-sm">
				Enter the model name to download. You can use formats like "ollama pull model", "ollama run model", or just "model".
			</p>
		</div>

		<div class="mb-6 space-y-3">
			<div>
				<label
					class="text-foreground mb-1 block text-sm font-medium"
					for="modelNameInput"
				>
					Model Name
				</label>
				<input
					id="modelNameInput"
					type="text"
					bind:value={inputValue}
					onkeydown={handleKeydown}
					placeholder="e.g., llama2, ollama pull llama2, ollama run llama2"
					class="input w-full"
					disabled={isLoading}
				/>
			</div>
			
			{#if inputValue.trim()}
				<div class="bg-surface-100-900 rounded border p-3">
					<div class="text-muted-foreground text-xs font-medium mb-1">
						Will install:
					</div>
					<div class="text-foreground font-mono text-sm">
						{cleanModelName(inputValue)}
					</div>
				</div>
			{/if}
		</div>

		<div class="flex gap-3">
			<button
				class="btn btn-secondary flex-1"
				onclick={onclose}
				disabled={isLoading}
			>
				Cancel
			</button>
			<button
				class="btn btn-primary flex-1"
				onclick={handleConfirm}
				disabled={isLoading || !inputValue.trim()}
			>
				{#if isLoading}
					<Icons.Loader2 size={14} class="animate-spin" />
					Installing...
				{:else}
					<Icons.Download size={14} />
					Install
				{/if}
			</button>
		</div>
	{/snippet}
</Modal>
