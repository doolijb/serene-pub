<script lang="ts">
	import type { RetrievalMarker } from "../markers"
	import { readInLine } from "./readIn"
	import { retrievalReadout } from "./retrievalReadout.svelte"

	/**
	 * What the attached session's newest run did with this entry, in one line.
	 *
	 * The decision is the mark's own fact and the figures are the run's, so a
	 * run whose account has not arrived still says the true half rather than
	 * waiting: "Read in" stands on its own and the rank joins it when it lands.
	 */
	interface Props {
		lorebookId: number
		/** The conversation reading this book, or null when none does. */
		sessionId: number | null
		sessionName: string | null
		entryId: number
		decision: RetrievalMarker | null
		/** The docked and phone sheets stop the line at the match. */
		short?: boolean
	}

	let {
		lorebookId,
		sessionId,
		sessionName,
		entryId,
		decision,
		short = false
	}: Props = $props()

	let line = $derived(
		readInLine(
			{
				sessionName,
				decision,
				...retrievalReadout.factsFor(lorebookId, sessionId, entryId)
			},
			{ short }
		)
	)
</script>

<p class="text-surface-700-300 text-xs" data-lore-read-in>{line}</p>
