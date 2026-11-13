<script lang="ts">
	/**
	 * A variable layout's preview, written against the variable's example
	 * value: mono 12px, two lines until **Show all** (Admin › Variable
	 * layouts, W2; a preset's fieldset reuses it, W6). A failed preview says
	 * so in words; with neither text nor error it says there is none.
	 */
	interface Props {
		preview: string | null
		error?: string | null
	}
	let { preview, error = null }: Props = $props()

	const uid = $props.id()
	let expanded = $state(false)

	const long = $derived(
		!!preview && (preview.split("\n").length > 2 || preview.length > 160)
	)
</script>

{#if error}
	<p class="text-error-600-400 text-xs">
		The preview could not be written: {error}
	</p>
{:else if preview == null}
	<p class="text-surface-600-400 text-xs">No preview.</p>
{:else}
	<div class="flex min-w-0 flex-col items-start gap-1">
		<p
			id="{uid}-text"
			class="text-surface-950-50 max-w-full font-mono text-xs break-words whitespace-pre-wrap {expanded
				? ''
				: 'line-clamp-2'}"
		>
			{preview}
		</p>
		{#if long}
			<button
				type="button"
				class="anchor text-xs"
				aria-expanded={expanded}
				aria-controls="{uid}-text"
				onclick={() => (expanded = !expanded)}
			>
				{expanded ? "Show less" : "Show all"}
			</button>
		{/if}
	</div>
{/if}
