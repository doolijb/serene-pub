<script lang="ts">
	/**
	 * 🚧 The body of a delete confirm that can't go ahead (D50): the sentence,
	 * the asker's own sessions that play on the book as links, how many more,
	 * and the way out. The words are `bookDeleteWords`' — drawn here, never
	 * retyped.
	 */
	import {
		readerName,
		type bookDeleteWords
	} from "$lib/shared/lorebooks/sessionNotes"

	interface Props {
		words: ReturnType<typeof bookDeleteWords>
		/** So the dialog closes as the session opens. */
		onOpen?: () => void
	}
	let { words, onOpen }: Props = $props()
</script>

<div class="flex max-w-prose flex-col gap-2" data-book-delete-refusal>
	<p>{words.lead}</p>
	{#if words.shown.length}
		<ul class="flex flex-col gap-1">
			{#each words.shown as r (r.id)}
				<li>
					<a
						href="/sessions/{r.id}"
						class="text-primary-ink font-medium underline-offset-2 hover:underline"
						data-book-delete-reader
						onclick={() => onOpen?.()}
					>
						{readerName(r)}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
	{#if words.more > 0}
		<p>and {words.more} more</p>
	{/if}
	{#if words.wayOut}
		<p>{words.wayOut}</p>
	{/if}
</div>
