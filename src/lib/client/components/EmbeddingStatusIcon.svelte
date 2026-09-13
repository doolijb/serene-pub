<script lang="ts">
	import { getContext } from "svelte"
	import { embeddingsStarred } from "$lib/shared/constants/embeddings"
	import * as Icons from "@lucide/svelte"

	interface Props {
		embeddingModel: string | null | undefined
		size?: number
	}

	let { embeddingModel, size = 12 }: Props = $props()

	const systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	// The identity the star resolves to, sent beside the settings row rather
	// than on it. Null means nothing is starred, which the status below reads as
	// "hidden" — the same thing the old enabled flag did.
	let activeModel = $derived(
		systemSettingsCtx?.settings?.activeEmbeddingModel ?? null
	)
	// The star is the switch: embeddings are on when something is registered
	// for `text->embedding`.
	let vectorizationEnabled = $derived(
		embeddingsStarred(systemSettingsCtx?.capabilityDefaults)
	)

	let status = $derived.by(() => {
		if (!vectorizationEnabled || !activeModel) return "hidden"
		if (embeddingModel === activeModel) return "current"
		if (embeddingModel) return "stale"
		return "none"
	})
</script>

{#if status === "current"}
	<span
		class="text-success-500 inline-flex shrink-0 items-center"
		title="Vectors up to date"
		aria-label="Vectors up to date"
	>
		<Icons.Zap {size} aria-hidden="true" />
	</span>
{:else if status === "stale"}
	<span
		class="text-warning-500 inline-flex shrink-0 items-center"
		title="Vectors stale — model changed"
		aria-label="Vectors stale — model changed"
	>
		<Icons.RefreshCw {size} aria-hidden="true" />
	</span>
{/if}
