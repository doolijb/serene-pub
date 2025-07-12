<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		modelName: string
		onClose: () => void
		onContinue: () => void
	}

	let {
		open = $bindable(),
		modelName,
		onClose,
		onContinue
	}: Props = $props()

	// Generate the Ollama library URL for the model
	let ollamaUrl = $derived(() => {
		if (!modelName) return ""
		
		// Extract the base model name (remove any version/tag info)
		const baseModelName = modelName.split(":")[0]
		return `https://ollama.com/library/${baseModelName}/tags`
	})
</script>

<Modal
	{open}
	onOpenChange={(e) => (open = e.open)}
	contentBase="card bg-surface-100-900 p-6 space-y-4 shadow-xl w-[40em] max-w-dvw-lg border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center justify-between">
			<h2 class="h2">Select Model Version</h2>
			<button onclick={onClose} class="btn-icon btn-icon-sm">
				<Icons.X size={16} />
			</button>
		</header>
		
		<article class="space-y-4">
			<div class="bg-primary-100 dark:bg-primary-900 border-primary-300 dark:border-primary-700 rounded-lg border p-4">
				<div class="flex items-start gap-3">
					<Icons.Info size={20} class="text-primary-600 mt-0.5 flex-shrink-0" />
					<div class="flex-1">
						<h3 class="font-semibold text-primary-800 dark:text-primary-200 mb-2">
							Choose Your Model Version
						</h3>
						<p class="text-primary-700-300 text-sm mb-3">
							To download <strong>{modelName}</strong>, you'll need to select a specific version from the Ollama library.
						</p>
						
						<div class="space-y-2 text-sm">
							<p class="text-primary-700-300">
								<strong>Step 1:</strong> Click the button below to open the model's page on Ollama.com
							</p>
							<p class="text-primary-700-300">
								<strong>Step 2:</strong> Browse the available versions and copy the full name of the one you want
							</p>
							<p class="text-primary-700-300">
								<strong>Step 3:</strong> Come back here and paste the name in the next screen
							</p>
                            <p class="text-primary-700-300"><em>(Q4_K_M is generally recommended for a balance between performance and resource usage)</em></p>
						</div>

						<div class="mt-4">
							<a
								href={ollamaUrl()}
								target="_blank"
								rel="noopener noreferrer"
								class="btn preset-filled-primary-500 inline-flex items-center gap-2"
							>
								<Icons.ExternalLink size={16} />
								View {modelName} on Ollama.com
							</a>
						</div>
					</div>
				</div>
			</div>
		</article>
		
		<footer class="flex justify-end gap-3">
			<button class="btn preset-tonal" onclick={onClose}>
				Cancel
			</button>
			<button class="btn preset-filled-primary-500" onclick={onContinue}>
				<Icons.ArrowRight size={16} />
				Continue to Download
			</button>
		</footer>
	{/snippet}
</Modal>
