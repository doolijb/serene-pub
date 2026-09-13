<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onDestroy, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
	import type { PoolSource } from "./types"
	import { dateValue } from "./historyDates"

	/**
	 * Move the story's clock forward.
	 *
	 * The server clones the latest entry's date forward by one day, rolling
	 * month and year over, so the client only has to say which entry is the
	 * latest — the calendar arithmetic belongs where the calendar is declared.
	 */
	interface Props {
		sources: PoolSource[]
	}

	let { sources }: Props = $props()

	const socket = useTypedSocket()

	// Named so `off` can name it too: a bare off() removes every listener for
	// the event, including any other open lorebooks UI.
	function handleIterateNext(_msg: Sockets.Entries.IterateNext.Response) {
		toaster.success({ title: "The story's date has moved forward" })
	}

	function nextDate() {
		if (sources.length === 0) {
			toaster.error({
				title: "No entries found",
				description: "Create at least one entry before using Next Date."
			})
			return
		}
		const latest = sources.reduce((max, entry) =>
			dateValue(entry as any) > dateValue(max as any) ? entry : max
		)
		socket.emit("entries:iterateNext", {
			id: latest.id,
			typeId: HISTORY_TYPE_ID
		} satisfies Sockets.Entries.IterateNext.Params)
	}

	onMount(() => {
		socket.on("entries:iterateNext", handleIterateNext)
	})

	onDestroy(() => {
		socket.off("entries:iterateNext", handleIterateNext)
	})
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
