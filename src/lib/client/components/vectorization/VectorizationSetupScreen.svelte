<script lang="ts">
	import * as Icons from "@lucide/svelte"

	interface Props {
		/** False when this platform can't load onnxruntime-node's native
		 * binary — Android's Bionic userspace, Intel Macs (onnxruntime-node
		 * dropped darwin/x64 as of 1.24.3), or any future platform gap. See
		 * embedding/index.ts's getLocalEmbeddingUnsupportedReason(). */
		localEmbeddingsSupported: boolean
		onChooseLocal: () => void
		onChooseApi: () => void
	}

	let { localEmbeddingsSupported, onChooseLocal, onChooseApi }: Props =
		$props()
</script>

<div class="flex flex-col items-center gap-6 px-4 py-8">
	<div class="text-center">
		<p class="text-surface-600-400 text-sm">
			Choose how Serene Pub should generate embeddings for RAG.
		</p>
	</div>

	<div class="flex w-full max-w-lg flex-col gap-4">
		<!-- Local option — always shown; ghosted/disabled with an explanatory
		     badge when this platform can't load onnxruntime-node's native
		     binary, rather than disappearing (so it's obvious the choice
		     exists and why it's unavailable, not silently absent). -->
		<button
			class="border-surface-300-700 flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition {localEmbeddingsSupported
				? 'bg-surface-100-900 hover:bg-surface-200-800 hover:border-primary-500'
				: 'bg-surface-100-900/50 cursor-not-allowed opacity-50'}"
			onclick={localEmbeddingsSupported ? onChooseLocal : undefined}
			disabled={!localEmbeddingsSupported}
			aria-disabled={!localEmbeddingsSupported}
		>
			<div
				class="bg-primary-100-900 text-primary-600-400 rounded-lg p-2.5"
			>
				<Icons.Cpu size={22} />
			</div>
			<div>
				<p class="text-sm font-semibold">Local Model</p>
				<p class="text-surface-700-300 mt-1 text-xs leading-relaxed">
					Runs a small embedding model on this device — one-time
					download, then works fully offline with no per-request
					cost.
				</p>
			</div>
			{#if localEmbeddingsSupported}
				<span
					class="bg-primary-500 mt-auto rounded px-2 py-0.5 text-xs font-medium text-white"
				>
					Recommended
				</span>
			{:else}
				<span
					class="bg-surface-400-600 mt-auto rounded px-2 py-0.5 text-xs font-medium text-white"
				>
					Not supported on this platform
				</span>
			{/if}
		</button>

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
			{#if !localEmbeddingsSupported}
				<span
					class="bg-secondary-500 mt-auto rounded px-2 py-0.5 text-xs font-medium text-white"
				>
					Only option on this platform
				</span>
			{:else}
				<span class="text-surface-700-300 mt-auto text-xs">
					Works everywhere
				</span>
			{/if}
		</button>
	</div>
</div>
