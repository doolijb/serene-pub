<script lang="ts">
	/**
	 * The line under a seat that fell in the story and sits on the bench: what
	 * bringing it back does, with a link to its cast member in the lorebook
	 * when it has one.
	 */
	interface Props {
		/** The seat's saved row. */
		saved: object | undefined
		/** The seat's name, for the link. */
		label: string
		castMemberHref: (saved: object | undefined) => string | null
	}

	let { saved, label, castMemberHref }: Props = $props()

	const href = $derived(castMemberHref(saved))
</script>

<p class="text-surface-600-400 basis-full text-xs">
	They come back as they are; their story still says
	deceased until you change it.
	{#if href}
		<a class="anchor" {href}>
			Open {label} in the lorebook
		</a>
	{/if}
</p>
