<script lang="ts">
	import type { Snippet } from "svelte"

	interface Props {
		id?: number
		content: Snippet
		extraContent?: Snippet
		controls?: Snippet
		onclick: (e: MouseEvent) => void
		contentTitle: string
		classes?: string
	}

	let {
		id,
		content,
		extraContent,
		controls,
		onclick,
		contentTitle,
		classes = ""
	}: Props = $props()
</script>

<div
	class="card preset-tonal hover:preset-filled-surface-300-700 relative flex w-full gap-2 overflow-hidden rounded-lg py-2 pr-3 pl-2 {classes}"
>
	<div class="relative flex flex-1 gap-2 min-w-0">
		{#if id !== undefined}
			<button {onclick} class="flex gap-2 min-w-0" title={contentTitle}>
				<span
					class="text-muted-foreground my-auto h-fit w-8 flex-shrink-0 text-xs text-center"
				>
					{id}
				</span>
			</button>
		{/if}
		<div class="flex w-full flex-col min-w-0">
			<div class="flex min-w-0">
				<button
					{onclick}
					class="flex flex-1 gap-2 min-w-0"
					title={contentTitle}
				>
					{@render content()}
				</button>
			</div>
			{@render extraContent?.()}
		</div>
	</div>
	{@render controls?.()}
</div>
