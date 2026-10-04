<script lang="ts">
	/**
	 * What lore would fire if you sent this — asked in the composer, where the
	 * question is actually asked (ruling 2026-09-08, 4.4).
	 *
	 * The trail behind every lore decision has only ever been readable from the
	 * admin workspace, on a turn that already happened. The question an author
	 * has, standing in front of a half-typed message, is the other one: *is my
	 * lore going to come in?* Nothing answered that without sending, reading
	 * the reply, going to the workspace and opening the receipt.
	 *
	 * ⚠ **A button, never a keystroke.** `EntryFireTest` rules this for the
	 * single-entry version of the same question and the reason is the same
	 * here: a turn is a real run with a real embedding call behind it, so a
	 * debounce on the composer would fire one every time somebody paused
	 * typing. Asked for, or not asked at all.
	 *
	 * The answer is the same `RetrievalExplanation` the workspace reads, fed by
	 * a real preview run rather than by a re-derivation of the gather rules —
	 * so "would" and "did" cannot disagree.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { v4 as uuid } from "uuid"
	import RetrievalExplanation from "./RetrievalExplanation.svelte"

	interface Props {
		/** The conversation to compile a turn against. */
		sessionId: number | null | undefined
		/** The unsent draft, so the answer is about the message being written. */
		content?: string
		/** Whose draft it is — a persona switch changes the answer. */
		personaId?: number | null
		/**
		 * Why this cannot be asked, in one line — or null when it can.
		 *
		 * A disabled control with no account of itself is the failure this
		 * whole surface exists to remove, so the reason renders beside the
		 * button rather than only as a `title`.
		 */
		disabledReason?: string | null
	}

	let {
		sessionId,
		content = "",
		personaId = null,
		disabledReason = null
	}: Props = $props()

	const socket = useTypedSocket()

	type Explanation = NonNullable<
		Sockets.Pipelines.RunExplain.Response["explanation"]
	>

	let explanation = $state<Explanation | null>(null)
	let loading = $state(false)
	/** The server's own sentence when it refused, shown in place. */
	let refusal = $state<string | null>(null)
	/** The draft the answer on screen is about — see `stale` below. */
	let answeredFor = $state<string | null>(null)
	/** The last press's id; only its answer is this panel's (plan B8). */
	let askedId: string | null = null

	const onPreview = (res: Sockets.Pipelines.PreviewRetrieval.Response) => {
		// Only this panel's own press: the entry's Test asks the same event
		// in this tab, and the answer goes to every tab (plan B8).
		if (res.requestId !== askedId) return
		loading = false
		if (res.error) {
			refusal = res.error
			explanation = null
			return
		}
		// A shared channel: an answer for a conversation this panel is no
		// longer showing is dropped rather than rendered under another one's
		// heading.
		if (res.sessionId !== sessionId) return
		refusal = null
		explanation = res.explanation ?? null
	}

	/** The read failed in a way the handler did not compose a sentence for. */
	const showRefusal = (res: { error?: string; requestId?: string }) => {
		if (res?.requestId !== askedId) return
		loading = false
		if (res?.error) refusal = res.error
	}

	/**
	 * Both keys BARE and STANDING: the request is a button press (`ask` below),
	 * not a mount, so the interest is held for the panel's life and the emit
	 * stays where the press is. Neither event is in `SCOPED_EVENTS`; the
	 * filter is the press's own `requestId` (echoed on the answer and the
	 * refusal), with `res.sessionId !== sessionId` still guarding a switch.
	 */
	useInterest<"pipelines:previewRetrieval">(
		"pipelines:previewRetrieval",
		onPreview
	)
	// Never gated (plan ruling 2 — an error is not an output to skip), but the
	// registry is the only listener path, so it is declared like the reply.
	useInterest<"pipelines:previewRetrieval:error">(
		"pipelines:previewRetrieval:error",
		showRefusal
	)

	// A different conversation is a different question. Nothing on screen is
	// true of it, and an answer left standing under a new heading would be a
	// confident lie.
	//
	// Keyed on a `$derived` copy of the id, not the prop: the session page
	// replaces its whole `session` object per streamed chunk, and a prop
	// handed down as `{session.id}` is a getter over it — reading that here
	// would wipe the answer on every token of a reply (B8).
	const askedAbout = $derived(sessionId)
	$effect(() => {
		void askedAbout
		explanation = null
		refusal = null
		answeredFor = null
	})

	/**
	 * The draft has moved on since the answer was given.
	 *
	 * Said rather than silently corrected: re-running on every edit is exactly
	 * what the button exists to prevent, so the honest alternative is to admit
	 * the answer is about text that is no longer in the box.
	 */
	const stale = $derived(
		answeredFor !== null && answeredFor !== (content ?? "")
	)

	function ask() {
		if (!sessionId || disabledReason) return
		loading = true
		refusal = null
		answeredFor = content ?? ""
		askedId = uuid()
		socket.emit("pipelines:previewRetrieval", {
			sessionId,
			content: content ?? "",
			personaId: personaId ?? null,
			requestId: askedId
		})
	}
</script>

<section class="flex flex-col gap-2" aria-label="What would fire now">
	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			onclick={ask}
			disabled={loading || !!disabledReason || !sessionId}
			title={disabledReason ?? "Compile the next turn and show what lore it pulls in"}
		>
			<Icons.Sparkles size={14} aria-hidden="true" />
			{loading ? "Checking…" : "What would fire now"}
		</button>
		{#if disabledReason}
			<span class="text-surface-600-400 text-xs">{disabledReason}</span>
		{:else if stale && !loading}
			<span class="text-surface-600-400 text-xs">
				Your draft has changed since you asked — check again for the
				message as it stands.
			</span>
		{/if}
	</div>

	{#if refusal}
		<p class="preset-tonal-warning flex items-start gap-2 rounded p-2 text-xs">
			<Icons.TriangleAlert size={14} class="mt-0.5 shrink-0" />
			<span>{refusal}</span>
		</p>
	{/if}

	<RetrievalExplanation
		{explanation}
		{loading}
		title="What would fire now"
		caption="The lore this message would pull in if you sent it, and what you can do about it."
	/>
</section>
