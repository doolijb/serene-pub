<script lang="ts">
	/**
	 * The Time lens's mount. The line is its own drawing — the graph canvas
	 * draws relationships, and a timeline is not one — over the scope's rows,
	 * as every other lens draws (#88): its title names the scope, so its line
	 * must be the scope's too.
	 */
	import { SCOPE_LABELS } from "$lib/shared/lorebooks/loreRoute"
	import TimeLens from "../time/TimeLens.svelte"
	import type { TimeEntryRow, TimeSceneRow } from "../time/storyTime"
	import { getBookData } from "../bookData.svelte"
	import { timeLensEntries } from "../scopes"
	import type { LensProps } from "./types"

	let {
		lorebookId,
		bench,
		hasUnsavedChanges = $bindable(false)
	}: LensProps = $props()

	const book = getBookData()

	/** Every entry the book holds, whatever kind, as the line reads them. */
	let entries = $derived(
		timeLensEntries(
			Object.values(book.rows).flat() as TimeEntryRow[],
			bench.route.scope
		)
	)
</script>

<TimeLens
	{lorebookId}
	mode={bench.mode}
	scopeTitle={SCOPE_LABELS[bench.route.scope]}
	{entries}
	scenes={book.scenes as unknown as TimeSceneRow[]}
	session={bench.timeSession}
	decisions={bench.decisions}
	bind:hasUnsavedChanges
/>
