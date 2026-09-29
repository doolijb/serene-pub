<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
	import type { PoolSource } from "./types"
	import { compareDates, dateValue } from "./historyDates"
	import { loreRoute } from "../loreRoute.svelte"

	/**
	 * Move the story's clock forward.
	 *
	 * The server dates a new entry one step after the latest — the next day,
	 * rolled over by the book's calendar when it declares one and not at all
	 * when it is free-form — so the client only has to say which entry is the
	 * latest.
	 */
	interface Props {
		sources: PoolSource[]
	}

	let { sources }: Props = $props()

	const socket = useTypedSocket()

	function handleIterateNext(_msg: Sockets.Entries.IterateNext.Response) {
		toaster.success({ title: "The story's date has moved forward" })
	}

	function nextDate() {
		if (sources.length === 0) {
			toaster.error({
				title: "No entries found",
				description: "Create at least one entry before adding the next date."
			})
			return
		}
		const latest = sources.reduce((max, entry) =>
			compareDates(entry as any, max as any) > 0 ? entry : max
		)
		socket.emit("entries:iterateNext", {
			id: latest.id,
			typeId: HISTORY_TYPE_ID,
			// The line being read: "next" lands where the reader is, as a
			// new entry does, never on main from a fork.
			branchId: loreRoute.route.branch ?? null
		} satisfies Sockets.Entries.IterateNext.Params)
	}

	/**
	 * `entries:iterateNext` is scoped on `payload.entry.lorebookId`, and the
	 * rows this button iterates are the open book's own, so the key names that
	 * book. A `PoolSource` is the wire row untyped, hence the `find` rather
	 * than a field read: with no row carrying one — an empty list — the key is
	 * BARE, which is the wider match and costs nothing, since `nextDate`
	 * refuses to send anything at all in that state.
	 */
	let scopeLorebookId = $derived(
		(sources.find((row) => row.lorebookId != null)?.lorebookId as
			| number
			| undefined) ?? null
	)

	$effect(() =>
		declareInterest<"entries:iterateNext">(
			interestKey("entries:iterateNext", scopeLorebookId),
			handleIterateNext
		)
	)
</script>

<button
	class="btn btn-sm preset-filled-primary-500 shrink-0"
	type="button"
	onclick={nextDate}
	title="Add the next date in sequence"
	aria-label="Add the next date in sequence"
>
	<Icons.CalendarPlus size={14} />
</button>
