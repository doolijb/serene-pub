<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { v4 as uuid } from "uuid"
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
	/** A press in flight; the button stands down until it is answered. */
	let pressing = $state(false)

	/**
	 * Only this button's own press is toasted (plan B8): the reply goes to
	 * every tab of the user, and the session page's "Start new history entry"
	 * answers on the same event. The asker's `requestId` comes back on the
	 * reply and on its refusal (which Layout toasts); the new row reaches the
	 * list through the book's own entry list, which the server re-sends.
	 */
	async function nextDate() {
		if (pressing) return
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
		const requestId = uuid()
		pressing = true
		try {
			await awaitReply({
				socket,
				event: "entries:iterateNext",
				params: {
					id: latest.id,
					typeId: HISTORY_TYPE_ID,
					// The line being read: "next" lands where the reader is, as
					// a new entry does, never on main from a fork.
					branchId: loreRoute.route.branch ?? null,
					requestId
				} satisfies Sockets.Entries.IterateNext.Params,
				// Scoped on `payload.entry.lorebookId`; the rows this button
				// iterates are the open book's own.
				replyKey: interestKey(
					"entries:iterateNext",
					latest.lorebookId as number | undefined
				),
				errorEvent: "entries:iterateNext:error",
				matchError: (data) =>
					(data as { requestId?: string })?.requestId === requestId,
				fallbackError: "The next entry could not be made.",
				match: (data) => data.requestId === requestId
			})
		} catch (err) {
			if (isReplyTimeout(err))
				toaster.error({
					title: "The story's date did not move",
					description: "The server did not answer in time."
				})
			return
		} finally {
			pressing = false
		}
		toaster.success({ title: "The story's date has moved forward" })
	}
</script>

<button
	class="btn btn-sm preset-filled-primary-500 shrink-0"
	type="button"
	disabled={pressing}
	onclick={nextDate}
	title="Add the next date in sequence"
	aria-label="Add the next date in sequence"
>
	<Icons.CalendarPlus size={14} />
</button>
