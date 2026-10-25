<script lang="ts">
	/**
	 * 🚧 The reading line when no session that reads this book is open (DC
	 * walk 6: a book made from a session said "Not read by a session" while
	 * the session read it): the asker's own sessions that read it, off the
	 * list row's `readBy`, newest first — named and linked, nothing more;
	 * where a session stands is the open session's to say.
	 */
	interface Props {
		readers: { id: number; name: string | null }[]
	}
	let { readers }: Props = $props()
	const first = $derived(readers[0] ?? null)
	const others = $derived(Math.max(0, readers.length - 1))
	const nameOf = (r: { name: string | null }) => r.name?.trim() || "Untitled session"
</script>

{#if first}
	Read by <a
		href="/sessions/{first.id}"
		class="text-primary-ink font-medium underline-offset-2 hover:underline"
		title="Open {nameOf(first)}"
		data-lore-read-by
	>
		{nameOf(first)}
	</a>{#if others}
		{" "}and {others} {others === 1 ? "other session" : "other sessions"}{/if}
{:else}
	Not read by a session
{/if}
