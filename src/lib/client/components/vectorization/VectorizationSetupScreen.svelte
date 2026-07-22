<script lang="ts">
	import * as Icons from "@lucide/svelte"

	interface Props {
		/** Local ONNX models can't load under Android's Bionic userspace — see android/README.md */
		isAndroidWrapper: boolean
		onChooseLocal: () => void
		onChooseApi: () => void
	}

	let { isAndroidWrapper, onChooseLocal, onChooseApi }: Props = $props()
</script>

<div class="flex flex-col items-center gap-6 px-4 py-8">
	<div class="text-center">
		<p class="text-surface-600-400 text-sm">
			Choose how Serene Pub should generate embeddings for RAG.
		</p>
	</div>

	<div class="flex w-full max-w-lg flex-col gap-4">
		{#if !isAndroidWrapper}
			<!-- Local option -->
			<button
				class="bg-surface-100-900 hover:bg-surface-200-800 border-surface-300-700 hover:border-primary-500 flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition"
				onclick={onChooseLocal}
			>
				<div
					class="bg-primary-100-900 text-primary-600-400 rounded-lg p-2.5"
				>
					<Icons.Cpu size={22} />
				</div>
				<div>
					<p class="text-sm font-semibold">Local Model</p>
					<p
						class="text-surface-700-300 mt-1 text-xs leading-relaxed"
					>
						Runs a small embedding model on this device — one-time
						download, then works fully offline with no per-request
						cost.
					</p>
				</div>
				<span
					class="bg-primary-500 mt-auto rounded px-2 py-0.5 text-xs font-medium text-white"
				>
					Recommended
				</span>
			</button>
		{/if}

		<!-- External API option -->
		<button
			class="bg-surface-100-900 hover:bg-surface-200-800 border-surface-300-700 hover:border-secondary-500 flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition"
			onclick={onChooseApi}
		>
			<div
				class="bg-secondary-100-900 text-secondary-600-400 rounded-lg p-2.5"
			>
				<Icons.Globe size={22} />
			</div>
			<div>
				<p class="text-sm font-semibold">External API</p>
				<p class="text-surface-700-300 mt-1 text-xs leading-relaxed">
					Use any OpenAI-compatible /embeddings endpoint — OpenAI
					itself, or a self-hosted Ollama/LM Studio/llama.cpp server
					elsewhere on your network.
				</p>
			</div>
			{#if isAndroidWrapper}
				<span
					class="bg-secondary-500 mt-auto rounded px-2 py-0.5 text-xs font-medium text-white"
				>
					Only option on Android
				</span>
			{:else}
				<span class="text-surface-700-300 mt-auto text-xs">
					Works everywhere, including Android
				</span>
			{/if}
		</button>
	</div>
</div>
