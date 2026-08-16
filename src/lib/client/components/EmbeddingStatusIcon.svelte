<script lang="ts">
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		embeddingModel: string | null | undefined
		size?: number
	}

	let { embeddingModel, size = 12 }: Props = $props()

	const systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	let activeModel = $derived(
		systemSettingsCtx?.settings?.embeddingModelName ?? null
	)
	let vectorizationEnabled = $derived(
		!!systemSettingsCtx?.settings?.vectorizationEnabled
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
