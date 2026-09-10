<script lang="ts">
	/**
	 * Why *this reply* said what it said — the per-message half of the ruling
	 * (2026-09-08, 4.4).
	 *
	 * The prompt report has always carried a Retrieval section, and what it
	 * held was the thin `blocks[]` list the compiled prompt happens to carry:
	 * "in / out", a source, a token count. That is a reading rather than a
	 * finding — it says *that* an entry was left out and never *why*, which is
	 * the only part anybody opens the report to learn.
	 *
	 * This asks the server for the same explanation the workspace reads,
	 * addressed the way the reader has it: by the message. The thin list stays
	 * as the fallback, because a reply generated before the run behind it was
	 * recorded still deserves the account that does exist.
	 */
	import type { Snippet } from "svelte"
	import { onDestroy, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import RetrievalExplanation from "./RetrievalExplanation.svelte"

	interface Props {
		/** The reply being explained. Nothing is asked for without one. */
		messageId: number | null | undefined
		/**
		 * What to render when there is no recorded run to explain — the thin
		 * list the compiled prompt carries.
		 */
		fallback?: Snippet
	}

	let { messageId, fallback }: Props = $props()

	const socket = useTypedSocket()

	type Explanation = NonNullable<
		Sockets.Pipelines.RunExplain.Response["explanation"]
	>

	let explanation = $state<Explanation | null>(null)
	let loading = $state(false)
	/** The server's own sentence when there is nothing recorded to read. */
	let refusal = $state<string | null>(null)
	/**
	 * Waiting from the first frame, not from the first effect.
	 *
	 * The request goes out in an effect, which runs *after* the first render —
	 * so reading `loading` alone paints the thin fallback for one frame and
	 * then replaces it, which reads as the report changing its mind about what
	 * it knows. A message with neither an answer nor a refusal yet is a
	 * message still being asked about.
	 */
	const waiting = $derived(
		loading || (!!messageId && !explanation && !refusal)
	)

	const onExplain = (res: Sockets.Pipelines.MessageExplain.Response) => {
		// A shared channel and the report can move to another message: an
		// answer for a reply the reader has closed is dropped rather than
		// shown under this one's heading.
		if (res.messageId !== messageId) return
		loading = false
		if (res.error) {
			refusal = res.error
			explanation = null
			return
		}
		refusal = null
		explanation = res.explanation ?? null
	}

	const showRefusal = (res: { error?: string }) => {
		loading = false
		if (res?.error) refusal = res.error
	}

	onMount(() => {
		socket.on("pipelines:messageExplain", onExplain)
		socket.on("pipelines:messageExplain:error", showRefusal)
	})
	onDestroy(() => {
		socket.off("pipelines:messageExplain", onExplain)
		socket.off("pipelines:messageExplain:error", showRefusal)
	})

	$effect(() => {
		const id = messageId
		explanation = null
		refusal = null
		if (!id) return
		loading = true
		socket.emit("pipelines:messageExplain", { messageId: id })
	})
</script>

{#if explanation || waiting}
	<RetrievalExplanation
		{explanation}
		loading={waiting}
		title="What actually fired"
		caption="The lore this reply was given, why each entry was in or out, and what you can do about it."
	/>
{:else}
	{@render fallback?.()}
	{#if refusal}
		<!-- Said once, quietly, under whatever the thin list could show: the
		     reader is owed the reason the fuller account is missing, not a
		     warning about a reply that is perfectly fine. -->
		<p class="text-surface-600-400 text-xs">{refusal}</p>
	{/if}
{/if}
