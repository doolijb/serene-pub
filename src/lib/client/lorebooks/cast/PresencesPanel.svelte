<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import {
		appearancesOf,
		holdsAt,
		presencesOnLine
	} from "$lib/shared/lorebooks/presence"
	import { lineOf, type Line } from "$lib/shared/lorebooks/lineReading"
	import { presenceRemovalSentence } from "./castSave"
	import { compareDates, formatDate } from "../sections/historyDates"
	import { openBookTime } from "../time/bookTime.svelte"
	import { parseMoment } from "../time/moment"
	import {
		draftNotice,
		emptyDraft,
		readDraft,
		type PresenceDraft
	} from "./presenceDraft"

	/**
	 * When this member is in the world, and at what point of their own life.
	 *
	 * A member with **no presences** is here always, at no particular age —
	 * which is every member in every book that has not thought about it, and
	 * must stay the cheapest thing to be. So this panel opens closed: a line
	 * saying they are simply here, and a way to say more.
	 *
	 * ⚠ **Placing them once also says where they are NOT.** Declaring nothing
	 * means always present; declaring one run means present during it and
	 * absent outside it. The panel says that out loud the first time, because
	 * it is the one genuinely surprising consequence of the shape.
	 *
	 * ⚠ **Two overlapping presences are two of them in the room** — a younger
	 * self arriving before the older one leaves. That is the feature, not a
	 * conflict, so an overlap is announced and allowed. Only an exact repeat is
	 * refused, and only because it is a slip.
	 *
	 * ⚠ A presence belongs to the LINE it was made on, like an amendment. The
	 * panel shows the ones the line being read can see — `presencesOnLine`,
	 * the World bar's own filter — says which line a new one will be written
	 * to, and, before a removal, every line it comes off.
	 */
	interface Props {
		lorebookId: number
		/** The `lorebook_bindings` row these are presences of. */
		castId: number
		/** Who they are, for the sentences. */
		memberName: string
		/** The book's presences, on every line; the line rule picks. */
		presences: readonly Sockets.Amendments.Presence[]
		/** The line being read, with its ancestor chain (`lineOf`). */
		line: Line
		/** That line's name, for the sentence. Absent is main. */
		branchName?: string | null
		/** The moment being read, as the route spells it. Absent is now. */
		moment?: string
	}

	let {
		lorebookId,
		castId,
		memberName,
		presences,
		line,
		branchName = null,
		moment
	}: Props = $props()

	const socket = useTypedSocket()

	let adding = $state(false)
	let draft = $state<PresenceDraft>(emptyDraft())
	let confirmingRemove = $state<number | null>(null)
	/** An overlap the author has been told about and has not yet accepted. */
	let acknowledged = $state(false)

	let cut = $derived(parseMoment(moment))
	let branchId = $derived(line.branchId)
	let lineName = $derived(branchName ?? "main")

	/**
	 * The presences this line can see, earliest first: its own, and each
	 * ancestor line's that began by that line's fork cut (`presencesOnLine`).
	 */
	let mine = $derived(
		presencesOnLine(
			presences.filter((p) => p.castId === castId),
			line
		).sort(
			(a, b) =>
				compareDates(
					{ year: a.fromYear, month: a.fromMonth, day: a.fromDay },
					{ year: b.fromYear, month: b.fromMonth, day: b.fromDay }
				) ||
				a.personalPosition - b.personalPosition ||
				a.id - b.id
		)
	)

	/**
	 * Which of them are standing here at the moment being read:
	 * `appearancesOf`, the World bar's answer, word for word.
	 *
	 * ⚠ By personal position, NOT by arrival date — the order `appearancesOf`
	 * puts appearances in. The list below is chronological because that is how
	 * a life reads; this sentence is the same fact the World bar and the Lives
	 * lens state, and one screen must not give it in two orders.
	 */
	let hereNow = $derived(
		appearancesOf(castId, presences as any, { line, moment: cut })
			.map((a) => mine.find((p) => p.id === a.presenceId))
			.filter((p): p is (typeof mine)[number] => p != null)
	)

	const COUNT_WORDS = ["Two", "Three", "Four", "Five", "Six"]

	/** "Two of them are here at once, at 34 and 50." — a list of any length. */
	function hereTogether(): string {
		const at = hereNow.map((p) => String(p.personalPosition))
		return `${at.slice(0, -1).join(", ")} and ${at.at(-1)}`
	}

	/** Where a presence is from, said beside it when it is not main's. */
	function whereFrom(p: Sockets.Amendments.Presence): string | null {
		if (p.branchId == null) return null
		return p.branchId === branchId
			? `${lineName} only`
			: `from ${openBookTime.lineName(p.branchId)}`
	}

	/**
	 * What removing a presence asks: the line it comes off, and every other
	 * line that reads it (`presencesOnLine` on each of the book's lines) —
	 * one read from main or an ancestor line is removed THERE, so it comes
	 * off each of them, this one included.
	 */
	function removalQuestion(p: Sockets.Amendments.Presence): string {
		const branches = openBookTime.branches
		const ids: (number | null)[] = [null, ...branches.map((b) => b.id)]
		if (!ids.includes(branchId)) ids.push(branchId)
		const nameOf = (id: number | null) =>
			id === branchId ? lineName : openBookTime.lineName(id)
		const readBy = ids
			.filter(
				(id) =>
					presencesOnLine(
						[p],
						id === branchId ? line : lineOf(id, branches)
					).length > 0
			)
			.map(nameOf)
		return presenceRemovalSentence({
			placedOn: nameOf(p.branchId ?? null),
			readingOn: lineName,
			readBy
		})
	}

	let parsed = $derived(readDraft(draft))
	let notice = $derived(
		parsed.ok ? draftNotice(parsed.fields, mine as any) : null
	)
	/** An overlap must be seen before it is accepted; a repeat never is. */
	let blocked = $derived(
		!parsed.ok ||
			notice?.kind === "refuse" ||
			(notice?.kind === "warn" && !acknowledged)
	)

	/** The span one presence covers, in the author's words. */
	function spanLabel(p: Sockets.Amendments.Presence): string {
		const from = formatDate({
			year: p.fromYear,
			month: p.fromMonth,
			day: p.fromDay
		})
		if (p.untilYear == null) return `from ${from} on`
		const until = formatDate({
			year: p.untilYear,
			month: p.untilMonth,
			day: p.untilDay
		})
		return `${from} until ${until}`
	}

	function reset() {
		adding = false
		draft = emptyDraft()
		acknowledged = false
	}

	function place() {
		if (!parsed.ok) return
		socket.emit("amendments:place", {
			lorebookId,
			castId,
			branchId,
			...parsed.fields
		} satisfies Sockets.Amendments.Place.Params)
		toaster.success({
			title: `${memberName} placed at ${parsed.fields.personalPosition}`
		})
		reset()
	}

	function unplace(id: number) {
		socket.emit("amendments:unplace", {
			lorebookId,
			id
		} satisfies Sockets.Amendments.Unplace.Params)
		confirmingRemove = null
	}
</script>

<div
	class="panel-inset flex flex-col gap-3"
	data-lore-presences={castId}
>
	<div class="flex items-start gap-2">
		<div class="min-w-0 flex-1">
			<p class="text-sm font-semibold">When they are here</p>
			<p class="text-surface-700-300 text-xs leading-relaxed">
				{#if mine.length === 0}
					{memberName} is in the world always, at no particular point of
					their life. Place them to say when they arrive, when they leave,
					and how old they are while they are here.
				{:else if hereNow.length === 0}
					{memberName} is
					<strong>not in the world</strong>
					at {moment ? formatDate(cut!) : "now"} — every presence below
					is elsewhere in time.
				{:else if hereNow.length === 1}
					Here at {hereNow[0].personalPosition}.
				{:else}
					<strong>{COUNT_WORDS[hereNow.length - 2] ?? hereNow.length} of them are here</strong>
					at once, at {hereTogether()}.
				{/if}
			</p>
		</div>
		{#if !adding}
			<button
				class="btn btn-sm preset-tonal-surface shrink-0"
				type="button"
				onclick={() => (adding = true)}
			>
				<Icons.MapPin size={14} aria-hidden="true" /> Place them
			</button>
		{/if}
	</div>

	{#if mine.length > 0}
		<ul class="flex flex-col gap-1">
			{#each mine as p (p.id)}
				{@const here = holdsAt(p as any, cut)}
				<li
					class="bg-surface-100-900 flex flex-col gap-1 rounded p-2 {here
						? ''
						: 'opacity-60'}"
				>
					<div class="flex items-center gap-2">
						<span
							class="badge shrink-0 {here
								? 'preset-tonal-primary'
								: 'preset-tonal-surface'} text-[11px]"
						>
							at {p.personalPosition}
						</span>
						<span class="min-w-0 flex-1 truncate text-xs">
							{spanLabel(p)}
						</span>
						{#if whereFrom(p)}
							<span
								class="badge preset-tonal-primary shrink-0 text-[11px]"
							>
								{whereFrom(p)}
							</span>
						{/if}
						{#if confirmingRemove === p.id}
							<button
								class="btn btn-sm preset-tonal-error shrink-0 py-0.5 text-xs"
								type="button"
								onclick={() => unplace(p.id)}
							>
								Remove
							</button>
							<button
								class="btn btn-sm preset-filled-surface-400-600 shrink-0 py-0.5 text-xs"
								type="button"
								onclick={() => (confirmingRemove = null)}
							>
								Keep
							</button>
						{:else}
							<button
								class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1"
								type="button"
								title="Remove this presence"
								aria-label="Remove the presence at {p.personalPosition}"
								onclick={() => (confirmingRemove = p.id)}
							>
								<Icons.X size={12} aria-hidden="true" />
							</button>
						{/if}
					</div>
					{#if confirmingRemove === p.id}
						<p class="text-surface-700-300 text-xs" data-presence-removal>
							{removalQuestion(p)}
						</p>
					{/if}
					{#if p.note}
						<p class="text-surface-600-400 text-[11px] italic">
							{p.note}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if adding}
		<div class="bg-surface-100-900 flex flex-col gap-3 rounded p-3">
			<div class="flex flex-col gap-1">
				<label
					class="text-xs font-semibold"
					for="presencePosition-{castId}"
				>
					Where in their life
				</label>
				<input
					id="presencePosition-{castId}"
					class="input input-sm text-sm"
					type="number"
					placeholder="34"
					bind:value={draft.personalPosition}
				/>
				<p class="text-surface-700-300 text-xs">
					An age, a chapter, an ordinal — whatever you count in. It needs
					no calendar; it only has to increase as they grow.
				</p>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<fieldset class="flex flex-col gap-1">
					<legend
						class="text-surface-600-400 text-xs font-semibold"
					>
						They arrive
					</legend>
					<div class="flex gap-1">
						<input
							class="input input-sm w-full text-sm"
							type="number"
							placeholder="Year"
							aria-label="Arrival year"
							bind:value={draft.fromYear}
						/>
						<input
							class="input input-sm w-full text-sm"
							type="number"
							placeholder="Mo."
							aria-label="Arrival month"
							bind:value={draft.fromMonth}
						/>
						<input
							class="input input-sm w-full text-sm"
							type="number"
							placeholder="Day"
							aria-label="Arrival day"
							bind:value={draft.fromDay}
						/>
					</div>
				</fieldset>
				<fieldset class="flex flex-col gap-1">
					<legend
						class="text-surface-600-400 text-xs font-semibold"
					>
						They leave
					</legend>
					<div class="flex gap-1">
						<input
							class="input input-sm w-full text-sm"
							type="number"
							placeholder="Year"
							aria-label="Departure year"
							bind:value={draft.untilYear}
						/>
						<input
							class="input input-sm w-full text-sm"
							type="number"
							placeholder="Mo."
							aria-label="Departure month"
							bind:value={draft.untilMonth}
						/>
						<input
							class="input input-sm w-full text-sm"
							type="number"
							placeholder="Day"
							aria-label="Departure day"
							bind:value={draft.untilDay}
						/>
					</div>
				</fieldset>
			</div>
			<p class="text-surface-700-300 text-xs">
				Leave the departure blank and they never leave. A departure date
				is the moment they are gone, not their last day here.
			</p>

			<div class="flex flex-col gap-1">
				<label class="text-xs font-semibold" for="presenceNote-{castId}">
					Why this one
				</label>
				<input
					id="presenceNote-{castId}"
					class="input input-sm text-sm"
					type="text"
					placeholder="came back to stop herself"
					bind:value={draft.note}
				/>
			</div>

			{#if mine.length === 0}
				<!-- The one genuinely surprising consequence, said once, at the
				     moment it becomes true rather than in a manual. -->
				<p
					class="preset-tonal-warning rounded p-2 text-xs leading-relaxed"
				>
					This is their first presence. Until now {memberName} was in the
					world at every moment; from here on they are here during their
					presences and <strong>nowhere else</strong>.
				</p>
			{/if}

			{#if !parsed.ok}
				<p class="text-error-600-400 text-xs">{parsed.problem}</p>
			{:else if notice}
				<div
					class="{notice.kind === 'refuse'
						? 'preset-tonal-error'
						: 'preset-tonal-primary'} flex flex-col gap-2 rounded p-2"
				>
					<p class="text-xs leading-relaxed">{notice.message}</p>
					{#if notice.kind === "warn"}
						<label class="flex items-center gap-2 text-xs">
							<input
								class="checkbox"
								type="checkbox"
								bind:checked={acknowledged}
							/>
							Yes, both of them
						</label>
					{/if}
				</div>
			{/if}

			<div class="flex items-center gap-2">
				<p class="text-surface-600-400 min-w-0 flex-1 text-[11px]">
					Written to <strong>{lineName}</strong>{#if branchId != null}, so
						it is not a presence on main.{/if}
				</p>
				<button
					class="btn btn-sm preset-filled-primary-500"
					type="button"
					disabled={blocked}
					onclick={place}
				>
					<Icons.MapPin size={14} aria-hidden="true" /> Place them
				</button>
				<button
					class="btn btn-sm preset-filled-surface-400-600"
					type="button"
					onclick={reset}
				>
					Cancel
				</button>
			</div>
		</div>
	{/if}
</div>
