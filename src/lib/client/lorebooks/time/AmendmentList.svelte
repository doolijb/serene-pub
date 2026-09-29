<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		amendmentsAheadOnLine,
		amendmentsOnLine,
		isOnLine
	} from "$lib/shared/lorebooks/lineReading"
	import { compareDates, formatDate } from "../sections/historyDates"
	import { loreRoute } from "../loreRoute.svelte"
	import { openBookTime } from "./bookTime.svelte"
	import { amendmentsAheadSentence, parseMoment } from "./moment"

	/**
	 * What this entry says differently, and from when.
	 *
	 * The entry's own account of its dated overlays. It answers the question
	 * the Moment bar creates — "is what I am reading the whole of it?" — and it
	 * is the only place an amendment can be looked at or removed, because an
	 * amendment is otherwise invisible: it shows up as the entry simply reading
	 * differently at one date and not another.
	 *
	 * ⚠ Drawn only when there is at least one. An entry with no amendments has
	 * nothing to say about them, and a heading over an empty list would teach
	 * every reader of every ordinary entry a word they do not need.
	 *
	 * ⚠ Every line's amendments are listed — this is the only place another
	 * line's can be removed — but each says which line it is on, the ones
	 * this line reads come first, and "not yet" is counted only over those
	 * (the line rule, `lineReading.ts`: the line's own, and its ancestors'
	 * up to each fork cut).
	 */
	interface Props {
		lorebookId: number
		/** Every overlay on this subject, on every line. */
		amendments: readonly (
			| Sockets.Amendments.EntryRow
			| Sockets.Amendments.CastRow
		)[]
		/** The moment being read, as the route spells it. Absent is now. */
		moment?: string
		/**
		 * Which table the rows came from, for the delete.
		 *
		 * The list is identical for both — a date, what it changes, and a way
		 * to remove it — so the component is one, and this is the only place
		 * the two differ.
		 */
		subject?: "entry" | "cast"
	}

	let { lorebookId, amendments, moment, subject = "entry" }: Props = $props()

	const socket = useTypedSocket()

	/** The moment being read, or null at now — where nothing is still ahead. */
	let cut = $derived(parseMoment(moment))

	/** The line being read, with its ancestor chain. */
	let branchId = $derived(loreRoute.route.branch ?? null)
	let line = $derived(openBookTime.lineOf(branchId))

	const byDate = (
		a: Sockets.Amendments.EntryRow,
		b: Sockets.Amendments.EntryRow
	) => compareDates(a, b) || a.id - b.id

	/** Every overlay, soonest first, as a history of itself. */
	let all = $derived(
		[...(amendments as Sockets.Amendments.EntryRow[])].sort(byDate)
	)
	/** The ones this line can ever read (at the head), by id. */
	let readsHere = $derived(
		new Set(amendmentsOnLine(all, line).map((a) => a.id))
	)
	/** This line's first, then the rest — the list's two groups. */
	let rows = $derived(all.filter((r) => readsHere.has(r.id)))
	let elsewhere = $derived(all.filter((r) => !readsHere.has(r.id)))

	/**
	 * The ones still ahead of the moment ON THIS LINE.
	 *
	 * ⚠ At now this is always empty — everything dated has happened — which
	 * is why the sentence below is drawn only while a moment is set. Another
	 * line's amendment is never "not yet" here: it never happens here.
	 */
	let aheadIds = $derived(
		new Set(amendmentsAheadOnLine(all, line, cut).map((a) => a.id))
	)
	let notYet = $derived(aheadIds.size)

	/** Where a row is, said beside it when it is not simply this line's. */
	function whereItIs(row: Sockets.Amendments.EntryRow): string | null {
		if (readsHere.has(row.id))
			return row.branchId === branchId
				? null
				: `from ${openBookTime.lineName(row.branchId)}`
		if (isOnLine(row, line))
			// On an ancestor, dated past the fork: that line's story, not this one's.
			return `on ${openBookTime.lineName(row.branchId)}, after the fork`
		return `on ${openBookTime.lineName(row.branchId)}`
	}

	/** The columns an overlay names, in the reader's words. */
	const FIELD_LABELS: Record<string, string> = {
		name: "name",
		content: "content",
		keys: "triggers",
		secondaryKeys: "secondary keys",
		enabled: "on or off",
		constant: "always on",
		priority: "priority",
		state: "state",
		summary: "summary",
		// A cast member's columns. `characterId` is the card they are drawn
		// with, which is a thing that changes over a life (ruled 2026-09-23).
		nodeState: "state",
		nodeVisibility: "who can see them",
		aliases: "aliases",
		characterId: "which card",
		// The sprites session's field (S4): a set NAME, resolved against
		// whichever card the member resolves to at that moment — so a card
		// swap and a sprite set stay independent.
		spriteSet: "sprite set"
	}

	function saysWhat(fields: Record<string, unknown>): string {
		const named = Object.keys(fields).map((k) => FIELD_LABELS[k] ?? k)
		return named.length ? named.join(", ") : "nothing"
	}

	/**
	 * Re-dating, because the date is the whole of what an amendment says.
	 *
	 * An amendment filed at the wrong moment is not a wrong value, it is a
	 * change that happens at the wrong time — and the only alternatives without
	 * this were to delete it and retype the fields, or to leave the story wrong.
	 *
	 * ⚠ The calendar narrows left to right: a day needs a month. The server
	 * refuses the pair too (`assertDate`); this is what stops the reader being
	 * told so by an error.
	 */
	let editing = $state<number | null>(null)
	let editYear = $state("")
	let editMonth = $state("")
	let editDay = $state("")

	function startEdit(row: Sockets.Amendments.EntryRow) {
		editing = row.id
		editYear = String(row.year)
		editMonth = row.month == null ? "" : String(row.month)
		editDay = row.day == null ? "" : String(row.day)
	}

	let editValid = $derived(
		Number.isInteger(Number(editYear)) &&
			editYear.trim() !== "" &&
			(editDay.trim() === "" || editMonth.trim() !== "")
	)

	function commitEdit(id: number) {
		if (!editValid) return
		socket.emit("amendments:update", {
			lorebookId,
			id,
			subject,
			year: Number(editYear),
			month: editMonth.trim() === "" ? null : Number(editMonth),
			day: editDay.trim() === "" ? null : Number(editDay)
		} satisfies Sockets.Amendments.Update.Params)
		editing = null
	}

	/** The row whose Delete is waiting on a yes. */
	let confirming = $state<number | null>(null)

	/**
	 * Delete, after the inline yes.
	 *
	 * ⚠ No success toast: the reply is the book's re-sent list, and the row
	 * leaving it IS the confirmation; a refusal is toasted by the shell's
	 * `:error` listener. A toast before the reply would announce a delete
	 * the server may yet refuse.
	 */
	function remove(id: number) {
		confirming = null
		socket.emit("amendments:delete", {
			lorebookId,
			id,
			subject
		} satisfies Sockets.Amendments.Delete.Params)
	}
</script>

{#snippet amendmentRow(row: Sockets.Amendments.EntryRow)}
	{@const ahead = aheadIds.has(row.id)}
	{@const where = whereItIs(row)}
	<li
		class="bg-surface-100-900 flex flex-wrap items-center gap-2 rounded-[10px] px-3 py-2"
		class:opacity-60={(ahead || !readsHere.has(row.id)) && editing !== row.id}
	>
		{#if editing === row.id}
			<Icons.CalendarClock
				size={14}
				aria-hidden="true"
				class="text-surface-600-400 shrink-0"
			/>
			<input
				class="input input-sm w-16 shrink-0"
				bind:value={editYear}
				aria-label="Year"
				placeholder="Year"
				onkeydown={(e) => e.key === "Enter" && commitEdit(row.id)}
			/>
			<input
				class="input input-sm w-14 shrink-0"
				bind:value={editMonth}
				aria-label="Month, optional"
				placeholder="Mo."
				onkeydown={(e) => e.key === "Enter" && commitEdit(row.id)}
			/>
			<input
				class="input input-sm w-14 shrink-0"
				bind:value={editDay}
				aria-label="Day, optional"
				placeholder="Day"
				disabled={editMonth.trim() === ""}
				title={editMonth.trim() === ""
					? "A day needs a month: the calendar narrows left to right"
					: "Day"}
				onkeydown={(e) => e.key === "Enter" && commitEdit(row.id)}
			/>
			<span class="flex-1"></span>
			<button
				class="btn btn-sm preset-filled-primary-500 shrink-0 p-1.5"
				type="button"
				onclick={() => commitEdit(row.id)}
				disabled={!editValid}
				aria-label="Save the new date"
			>
				<Icons.Check size={14} aria-hidden="true" />
			</button>
			<button
				class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1.5"
				type="button"
				onclick={() => (editing = null)}
				aria-label="Keep the date it has"
			>
				<Icons.X size={14} aria-hidden="true" />
			</button>
		{:else if confirming === row.id}
			<span class="text-surface-700-300 min-w-0 flex-1 text-xs">
				Delete the amendment dated {formatDate(row)}? The entry reads as
				it did without it{where ? ` (${where})` : ""}.
			</span>
			<button
				class="btn btn-sm preset-tonal-error shrink-0"
				type="button"
				onclick={() => remove(row.id)}
			>
				Delete
			</button>
			<button
				class="btn btn-sm preset-filled-surface-400-600 shrink-0"
				type="button"
				onclick={() => (confirming = null)}
			>
				Cancel
			</button>
		{:else}
			<Icons.CalendarClock
				size={14}
				aria-hidden="true"
				class="text-surface-600-400 shrink-0"
			/>
			<button
				class="hover:preset-tonal-surface shrink-0 rounded-[6px] px-1 text-xs font-semibold"
				type="button"
				onclick={() => startEdit(row)}
				title="Change the date this begins at"
			>
				{formatDate(row)}
			</button>
			<span class="text-surface-700-300 min-w-0 flex-1 truncate text-xs">
				changes {saysWhat(row.fields)}
			</span>
			{#if where}
				<span
					class="chip preset-tonal-surface shrink-0 text-[11px]"
					data-lore-amendment-line
				>
					{where}
				</span>
			{/if}
			{#if ahead}
				<span class="chip preset-tonal-surface shrink-0 text-[11px]">
					not yet
				</span>
			{/if}
			<button
				class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1.5"
				type="button"
				onclick={() => (confirming = row.id)}
				title="Delete this amendment"
				aria-label="Delete the amendment dated {formatDate(row)}"
			>
				<Icons.Trash2 size={14} aria-hidden="true" />
			</button>
		{/if}
	</li>
{/snippet}

{#if all.length}
	<section class="flex flex-col gap-2" data-lore-amendments>
		<div class="flex items-baseline gap-2">
			<h4 class="text-surface-600-400 text-xs">Amendments</h4>
			{#if notYet}
				<!-- The sentence the design names: the base carries a change
				     that has not arrived at the moment being read. -->
				<span class="text-surface-600-400 text-xs">
					{amendmentsAheadSentence(notYet, rows.length)}
				</span>
			{/if}
		</div>
		{#if rows.length}
			<ul class="flex flex-col gap-1">
				{#each rows as row (row.id)}
					{@render amendmentRow(row)}
				{/each}
			</ul>
		{/if}
		{#if elsewhere.length}
			<!-- Listed, not filtered: this is the only place another line's
			     amendment can be re-dated or deleted. -->
			<h5 class="text-surface-600-400 text-[11px]">
				Not read on {openBookTime.lineName(branchId)}
			</h5>
			<ul class="flex flex-col gap-1" data-lore-amendments-elsewhere>
				{#each elsewhere as row (row.id)}
					{@render amendmentRow(row)}
				{/each}
			</ul>
		{/if}
	</section>
{/if}
