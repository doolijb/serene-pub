<script lang="ts">
	/**
	 * One run's retrieval, explained — the workspace's binding of
	 * `RetrievalExplanation`.
	 *
	 * All that is left here is the *addressing*: which turn, and how to fetch
	 * it. The reader itself moved to `RetrievalExplanation` when the same
	 * explanation had to appear at two other places — the composer, about a
	 * turn that has not happened, and a message, about one that has. Three
	 * surfaces asking one question deserve one answer, so what varies between
	 * them is a prop rather than three panels free to drift.
	 *
	 * The props and the name are unchanged, so the receipt reader that mounts
	 * this is untouched.
	 */
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import RetrievalExplanation from "./RetrievalExplanation.svelte"

	interface Props {
		/** The open receipt's run. Nothing is asked for without one. */
		runId: string | null | undefined
	}

	let { runId }: Props = $props()

	type Explanation = NonNullable<
		Sockets.Pipelines.RunExplain.Response["explanation"]
	>

	let explanation = $state<Explanation | null>(null)
	let loading = $state(false)

	const onExplain = (res: Sockets.Pipelines.RunExplain.Response) => {
		loading = false
		if (res.error) {
			toaster.error({ title: res.error })
			return
		}
		// A shared channel and the receipt above can move: an answer for the
		// run the reader just closed is dropped rather than shown under
		// another one's heading.
		if (res.runId !== runId) return
		explanation = res.explanation ?? null
	}

	/** The read failed: stop waiting, and show the sentence the server wrote. */
	const showExplainRefusal = (res: { error?: string }) => {
		loading = false
		if (res?.error) toaster.error({ title: res.error })
	}

	// Never gated (plan ruling 2 — an error is not an output to skip), but the
	// registry is the only listener path, so it is declared like the reply.
	useInterest<"pipelines:runExplain:error">(
		"pipelines:runExplain:error",
		showExplainRefusal
	)

	/**
	 * The explanation, asked for and listened for in one: the interest sync
	 * naming `pipelines:runExplain` leaves ahead of the request (ruling 3).
	 *
	 * BARE — the event has no entry in `SCOPED_EVENTS`, so a `#<runId>` key
	 * would match nothing; `onExplain`'s own `res.runId !== runId` check stays
	 * the filter. The release is the effect's teardown, so a reader moved to
	 * another receipt drops the old interest as it takes the new one.
	 */
	$effect(() => {
		const id = runId
		explanation = null
		if (!id) return
		loading = true
		return requestWithInterest(
			"pipelines:runExplain",
			{ runId: id },
			onExplain
		)
	})
</script>

<RetrievalExplanation {explanation} {loading} />
