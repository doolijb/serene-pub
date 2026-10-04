<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { exitsLineOf } from "$lib/shared/lorebooks/exitsLine"
	import { rowsReadingOnLine } from "$lib/shared/lorebooks/lineReading"
	import type { RelationshipEndRef } from "$lib/shared/lorebooks/linkVocabulary"
	import type { PoolItem } from "../poolFilter"
	import type { BookRelationships } from "../relationships.svelte"
	import RelationshipFields from "../graphs/RelationshipFields.svelte"
	import {
		createLinkParams,
		flipLink,
		linkEnds,
		NEW_PLACE_OPTION,
		relationshipFieldsProblem,
		updateLinkParams,
		whenAtMoment,
		whenOptions,
		type LinkDraft,
		type RelationshipFieldsValue,
		type WhenEntryLike
	} from "../graphs/linkDraft"
	import { formatDate } from "../sections/historyDates"
	import ExitsLineLinks from "./ExitsLineLinks.svelte"
	import { exitsLineNote, type ExitsLineTally } from "./exitsLineLinks"
	import { momentDate } from "../time/moment"
	import {
		newPlaceLink,
		placeChoices,
		linkFieldsDiffer,
		placeLinkChanged,
		placeLinkFields,
		placeLinkRows,
		placeLinkStands,
		withOtherPlace,
		type PlaceLinkReading,
		type PlaceLinkRow
	} from "./placeLinks"

	/**
	 * A place's Links list (plan places-graph §10.3, B5): the other half of
	 * "relations are editable from the entry editor AND the graph designer"
	 * (owner ruling 6).
	 *
	 * Each row is the relationship said from this place, and opens into the
	 * same `RelationshipFields` the canvas edits with. **Link a place** draws a
	 * new one from here. Every write goes through the one store, at once — a
	 * link is not an entry column, so it is never part of the entry's Save —
	 * and the store's rows are what both surfaces draw, so a link written on
	 * the canvas is listed here the moment the server's push lands.
	 *
	 * A row another line owns is read-only, naming the line to open, as on the
	 * canvas; the server refuses the same write (plan B0).
	 *
	 * **Read links from the Exits line** (B7), shown only when the body holds
	 * an `Exits:` line and the store has read the place's links (before then
	 * every way would read as not yet linked), reads that prose line on
	 * request and offers the links it names for the person to confirm
	 * (`ExitsLineLinks`). Once its view closes, the list says what it wrote.
	 */
	interface Props {
		/** The place whose links these are, as the line reads it. */
		place: { id: number; name: string }
		lorebookId: number
		/** The book's relationships — the one store (plan §10.1). */
		relationships: BookRelationships
		/** The book's rows on the line being read: names, and the places a link can reach. */
		pool: readonly PoolItem[]
		/**
		 * The line, the moment and the history entries a link is read by.
		 * `datedBy` is every history entry in the book, on every line.
		 */
		reading: Omit<PlaceLinkReading, "placeId" | "nameOf" | "datedBy"> & {
			datedBy: readonly (WhenEntryLike & { branchId?: number | null })[]
		}
		/** Writes a new place for **New place…**; absent, the choice is not offered. */
		createPlace?: (name: string) => Promise<{ id: number; name: string }>
		/**
		 * The place's body as the editor holds it — where an `Exits:` line is
		 * read. Absent or without that line, the action is not offered.
		 */
		content?: string
	}

	let {
		place,
		lorebookId,
		relationships,
		pool,
		reading,
		createPlace,
		content = ""
	}: Props = $props()

	const uid = $props.id()
	/**
	 * The picker's choice that asks for a new place instead of an existing
	 * one — the canvas's own, so the two pickers cannot drift apart.
	 */
	const NEW_PLACE = NEW_PLACE_OPTION

	let poolNames = $derived(
		new Map(pool.map((item) => [item.key, item.name.trim()]))
	)
	/** Rows archived as of the moment: a link to one does not stand. */
	let poolArchived = $derived(
		new Set(pool.filter((item) => item.archived).map((item) => item.key))
	)
	let castNames = $derived(
		new Map(relationships.nodes.map((node) => [node.id, node.name]))
	)
	/** The pool's reading of an entry (its amended name); a cast member's name. */
	const nameOf = (end: RelationshipEndRef): string | undefined =>
		end.kind === "cast"
			? castNames.get(end.id)
			: poolNames.get(`entry#${end.id}`) || undefined

	let rows = $derived(
		placeLinkRows(relationships.all, {
			...reading,
			placeId: place.id,
			nameOf,
			isArchived: (end) =>
				end.kind === "entry" && poolArchived.has(`entry#${end.id}`)
		})
	)
	/**
	 * The links that stand at the moment — what the canvas draws and the
	 * prompt says. The heading counts these; the rest follow, each badged.
	 */
	let standing = $derived(rows.filter(placeLinkStands).length)

	/** The history entries on this line — what a link written here is dated by. */
	let lineHistory = $derived(
		rowsReadingOnLine(reading.datedBy, reading.line, (row) => ({
			year: row.year,
			month: row.month ?? null,
			day: row.day ?? null
		}))
	)
	let when = $derived(whenOptions(lineHistory, (d) => formatDate(d)))
	let choices = $derived(placeChoices(pool, place.id))
	let pickerOptions = $derived([
		...choices.map((item) => ({ value: String(item.id), label: item.name })),
		...(createPlace ? [{ value: NEW_PLACE, label: "New place…" }] : [])
	])

	// ── One open row at a time ────────────────────────────────────────────

	let openId = $state<number | null>(null)
	let editing = $state<(RelationshipFieldsValue & { id: number }) | null>(
		null
	)
	/**
	 * The stored fields the open row was opened on. An edit made elsewhere
	 * (the canvas, another tab) moves the store's row away from them: with
	 * nothing typed here the form follows it; with something typed it says
	 * so, rather than a Save quietly putting the old values back.
	 */
	let editingFrom = $state<(RelationshipFieldsValue & { id: number }) | null>(
		null
	)
	let saving = $state(false)
	let rowError = $state<string | null>(null)
	let confirmingUnlink = $state(false)
	/** Bumped on every close, so a save still in flight cannot reopen a row. */
	let rowAttempt = 0

	/** The open row as the store holds it now; gone when a push deleted it. */
	let openRow = $derived(rows.find((row) => row.id === openId) ?? null)
	let rowProblem = $derived(editing ? relationshipFieldsProblem(editing) : null)
	let rowChanged = $derived(
		!!openRow && !!editing && placeLinkChanged(openRow.rel, editing)
	)
	/** The stored row moved since it was opened here. */
	let changedElsewhere = $derived(
		!!openRow && !!editingFrom && placeLinkChanged(openRow.rel, editingFrom)
	)
	/** Something typed here since the row was opened (or last followed). */
	let typedHere = $derived(
		!!editing && !!editingFrom && linkFieldsDiffer(editingFrom, editing)
	)
	let staleNote = $state(false)

	$effect(() => {
		if (!changedElsewhere || !openRow) return
		const rel = openRow.rel
		untrack(() => {
			if (typedHere) {
				staleNote = true
				return
			}
			editing = placeLinkFields(rel)
			editingFrom = placeLinkFields(rel)
			staleNote = false
		})
	})

	function closeRow() {
		openId = null
		editing = null
		editingFrom = null
		staleNote = false
		saving = false
		rowError = null
		confirmingUnlink = false
		rowAttempt++
	}

	function toggle(row: PlaceLinkRow) {
		if (openId === row.id) {
			closeRow()
			return
		}
		closeRow()
		openId = row.id
		editing = row.locked ? null : placeLinkFields(row.rel)
		editingFrom = editing && placeLinkFields(row.rel)
	}

	const failure = (err: unknown, fallback: string) =>
		isReplyTimeout(err)
			? "The server did not answer. Nothing was saved; try again."
			: err instanceof Error
				? err.message
				: fallback

	/** Saves the open row through the store, now — never with the entry. */
	async function saveRow() {
		if (!editing || !openRow || saving || rowProblem) return
		const attempt = ++rowAttempt
		saving = true
		rowError = null
		try {
			const { relationship, branchId } = updateLinkParams(
				$state.snapshot(editing),
				reading.branchId
			)
			await relationships.update(relationship, branchId)
			if (attempt !== rowAttempt) return
			closeRow()
		} catch (err) {
			if (attempt !== rowAttempt) return
			rowError = failure(err, "The link could not be saved.")
			saving = false
		}
	}

	/**
	 * Unlink, and wait for the server: a refusal (another line's row) or
	 * silence is said in the row, and a second press while it is on its way
	 * sends nothing. The push takes the row away.
	 */
	async function unlink() {
		if (!openRow || saving) return
		const attempt = ++rowAttempt
		saving = true
		rowError = null
		try {
			await relationships.remove(openRow.id, reading.branchId)
			if (attempt !== rowAttempt) return
			closeRow()
		} catch (err) {
			if (attempt !== rowAttempt) return
			rowError = failure(err, "The link could not be unlinked.")
			saving = false
			confirmingUnlink = false
		}
	}

	// ── Link a place ──────────────────────────────────────────────────────

	let adding = $state(false)
	/** The picker's value: a place id, `NEW_PLACE`, or null before a pick. */
	let picked = $state<string | null>(null)
	let draft = $state<LinkDraft | null>(null)
	/** The new place's name while **New place…** is picked; null otherwise. */
	let newPlaceName = $state<string | null>(null)
	let linking = $state(false)
	let linkError = $state<string | null>(null)
	let linkAttempt = 0

	let linkProblem = $derived(
		!draft
			? "Pick the place it links to."
			: newPlaceName !== null && !newPlaceName.trim()
				? "Name the new place."
				: relationshipFieldsProblem(draft)
	)
	/** The link said out loud, the far end as the reader has named it so far. */
	let linkTitle = $derived.by(() => {
		if (!draft) return `From ${place.name} to…`
		const [from, to] = linkEnds(draft)
		const named = (node: { id: number; name: string }) =>
			node.id === place.id
				? place.name
				: newPlaceName !== null
					? newPlaceName.trim() || "the new place"
					: node.name
		return `${named(from)} → ${named(to)}`
	})

	function startNew() {
		closeRow()
		// Closing the view stops what it had not sent yet; its note says what
		// it wrote.
		closeExits()
		adding = true
		picked = null
		draft = null
		newPlaceName = null
		linkError = null
		linkAttempt++
	}

	function closeNew() {
		adding = false
		picked = null
		draft = null
		newPlaceName = null
		linking = false
		linkError = null
		linkAttempt++
	}

	/** A link drawn here starts dated by the entry dated the moment being read. */
	const startsWhen = () =>
		whenAtMoment(lineHistory, momentDate(reading.moment))

	function pick(value: string) {
		picked = value || null
		linkError = null
		if (!value) {
			draft = null
			newPlaceName = null
			return
		}
		const other =
			value === NEW_PLACE
				? { id: 0, name: "" }
				: choices.find((item) => String(item.id) === value)
		if (!other) return
		newPlaceName = value === NEW_PLACE ? (newPlaceName ?? "") : null
		// The fields the reader has already set survive a change of mind
		// about the far end; only the far end moves.
		draft = draft
			? withOtherPlace(draft, other)
			: newPlaceLink(place, other, startsWhen())
	}

	async function submitNew() {
		if (!draft || linking || linkProblem) return
		const attempt = ++linkAttempt
		linking = true
		linkError = null
		try {
			let next = $state.snapshot(draft) as LinkDraft
			if (newPlaceName !== null) {
				if (!createPlace) return
				const made = await createPlace(newPlaceName.trim())
				if (attempt !== linkAttempt) return
				// The place exists now: a retry links it rather than making
				// a second one.
				picked = String(made.id)
				newPlaceName = null
				next = withOtherPlace(next, made)
				draft = next
			}
			await relationships.create(
				createLinkParams(lorebookId, next, reading.branchId)
			)
			if (attempt !== linkAttempt) return
			closeNew()
		} catch (err) {
			if (attempt !== linkAttempt) return
			linkError = failure(err, "The link could not be saved.")
			linking = false
		}
	}

	// ── Read links from the Exits line ────────────────────────────────────

	/**
	 * The action is offered: the body holds an `Exits:` line, and the store
	 * has read this place's links — judged before that, every way would read
	 * as not yet linked, ticked, and written again.
	 */
	let exitsReadable = $derived(
		exitsLineOf(content) !== null &&
			relationships.loaded &&
			!relationships.error
	)
	let readingExits = $state(false)
	/** What the view's last opening wrote (`ExitsLineLinks`' `onTally`). */
	let exitsTally = $state<ExitsLineTally | null>(null)
	/** Said once the view closes: what it wrote, and what a close stopped. */
	let exitsNote = $derived(
		!readingExits && exitsTally ? exitsLineNote(exitsTally) : null
	)

	function startExits() {
		closeRow()
		closeNew()
		exitsTally = null
		readingExits = true
	}

	function closeExits() {
		readingExits = false
	}

	const STATUS_BADGE: Record<string, string> = {
		resolved: "preset-tonal-success",
		broken: "preset-tonal-error",
		evolved: "preset-tonal-warning"
	}
</script>

<section
	class="flex flex-col gap-2"
	aria-labelledby="{uid}-heading"
	data-place-links
>
	<!-- The heading never gives way to its actions: when the two do not fit
	     beside it, they wrap onto a row of their own. -->
	<div class="flex flex-wrap items-center gap-2">
		<h4
			id="{uid}-heading"
			class="shrink-0 grow text-sm font-semibold whitespace-nowrap"
		>
			Links
			{#if standing}
				<span class="text-surface-600-400 font-normal">{standing}</span>
			{/if}
		</h4>
		<div class="flex flex-wrap items-center gap-2">
			<button
				class="btn btn-sm preset-tonal-surface shrink-0"
				type="button"
				aria-expanded={adding}
				aria-controls="{uid}-new"
				disabled={adding}
				onclick={startNew}
				data-place-link-add
			>
				<Icons.Link size={14} aria-hidden="true" />
				<span>Link a place</span>
			</button>
			{#if exitsReadable}
				<button
					class="btn btn-sm preset-tonal-surface shrink-0"
					type="button"
					aria-expanded={readingExits}
					aria-controls="{uid}-exits"
					disabled={readingExits}
					onclick={startExits}
					data-exits-read
				>
					<Icons.TextSearch size={14} aria-hidden="true" />
					<span>Read links from the Exits line</span>
				</button>
			{/if}
		</div>
	</div>

	{#if exitsNote}
		<p class="text-surface-600-400 text-xs" role="status" data-exits-note>
			{exitsNote}
		</p>
	{/if}

	{#if readingExits}
		<div id="{uid}-exits">
			<ExitsLineLinks
				{place}
				{lorebookId}
				{relationships}
				{content}
				{pool}
				{rows}
				branchId={reading.branchId}
				historyEntryId={startsWhen()}
				{createPlace}
				onClose={closeExits}
				onTally={(tally) => (exitsTally = tally)}
			/>
		</div>
	{/if}

	{#if adding}
		<div
			id="{uid}-new"
			class="bg-surface-100-900 border-surface-200-800 flex flex-col gap-2 rounded-lg border p-3 text-sm"
			data-place-link-new
		>
			<div class="flex items-center gap-2">
				<p class="min-w-0 flex-1 truncate font-semibold">{linkTitle}</p>
				{#if draft}
					<button
						class="btn btn-sm preset-tonal-surface shrink-0 p-1.5"
						type="button"
						title="Turn the direction round"
						aria-label="Turn the direction round"
						onclick={() => (draft = draft && flipLink(draft))}
					>
						<Icons.ArrowLeftRight size={13} aria-hidden="true" />
					</button>
				{/if}
			</div>
			<Select
				label="The other place"
				class="text-sm"
				options={pickerOptions}
				value={picked}
				placeholder="Pick a place"
				emptyMessage="No other places on this line yet."
				onValueChange={pick}
			/>
			{#if newPlaceName !== null}
				<label class="flex flex-col gap-1 text-xs" for="{uid}-new-name">
					<span class="text-surface-600-400">Name of the new place</span>
					<input
						id="{uid}-new-name"
						class="input text-sm"
						type="text"
						placeholder="The Drowned Hall"
						bind:value={newPlaceName}
						data-place-link-new-name
					/>
				</label>
			{/if}
			{#if draft}
				<RelationshipFields
					value={draft}
					pairing="entry-entry"
					whenOptions={when}
					onChange={(next) => (draft = next)}
				/>
			{/if}
			{#if linkError}
				<p class="text-error-600-400 text-xs" role="alert" data-place-link-error>
					{linkError}
				</p>
			{/if}
			<div class="flex justify-end gap-2">
				<button
					class="btn btn-sm preset-tonal-surface"
					type="button"
					onclick={closeNew}
				>
					Cancel
				</button>
				<button
					class="btn btn-sm preset-tonal-primary"
					type="button"
					disabled={linking || linkProblem !== null}
					title={linkProblem ?? undefined}
					onclick={submitNew}
					data-place-link-submit
				>
					<Icons.Link size={13} aria-hidden="true" />
					<span>{newPlaceName !== null ? "Create and link" : "Link"}</span>
				</button>
			</div>
		</div>
	{/if}

	{#if relationships.error}
		<p class="text-error-600-400 text-xs" role="alert">{relationships.error}</p>
	{:else if !relationships.loaded}
		<p class="text-surface-600-400 text-xs">Reading this place's links…</p>
	{:else if rows.length === 0 && !adding}
		<p class="text-surface-600-400 text-xs" data-place-links-empty>
			Nothing links this place to anywhere yet. Link a place here, or
			Alt-drag (⌥ on a Mac) from it on the Places canvas.
		</p>
	{/if}

	{#if rows.length}
		<ul class="flex flex-col gap-1.5">
			{#each rows as row (row.id)}
				{@const open = openId === row.id}
				<li
					class="bg-surface-100-900 border-surface-200-800 flex flex-col gap-2 rounded-lg border p-2.5 {row.later ||
					row.archived
						? 'opacity-70'
						: ''}"
					data-place-link={row.id}
					data-link-way={row.way}
					data-link-archived={row.archived ? "" : undefined}
				>
					<button
						type="button"
						class="flex w-full min-w-0 items-start gap-1.5 text-left text-sm"
						aria-expanded={open}
						aria-controls="{uid}-row-{row.id}"
						onclick={() => toggle(row)}
					>
						<Icons.ChevronRight
							size={14}
							class="text-surface-600-400 mt-0.5 shrink-0 transition-transform {open
								? 'rotate-90'
								: ''}"
							aria-hidden="true"
						/>
						<span class="min-w-0 flex-1" data-place-link-sentence>
							{row.sentence}
						</span>
						{#if row.rel.visibility === "secret"}
							<span class="badge preset-tonal-surface shrink-0 text-[11px]">
								secret
							</span>
						{/if}
						{#if row.rel.status !== "active"}
							<span
								class="badge {STATUS_BADGE[row.rel.status] ??
									'preset-tonal-surface'} shrink-0 text-[11px]"
							>
								{row.rel.status}
							</span>
						{/if}
						{#if row.later}
							<span class="badge preset-tonal-surface shrink-0 text-[11px]">
								{row.later}
							</span>
						{/if}
						{#if row.archived}
							<span
								class="badge preset-tonal-surface shrink-0 text-[11px]"
								title="{row.otherName} is archived at this moment: the map and the prompt leave this link out."
							>
								archived
							</span>
						{/if}
						{#if row.locked}
							<Icons.Lock
								size={12}
								class="text-surface-600-400 mt-1 shrink-0"
								aria-label="Read-only on this line"
							/>
						{/if}
					</button>

					{#if !open && row.rel.description}
						<p class="text-surface-600-400 line-clamp-2 pl-5 text-xs">
							{row.rel.description}
						</p>
					{/if}

					{#if open}
						<div id="{uid}-row-{row.id}" class="flex flex-col gap-2 pl-5">
							{#if row.locked}
								<p class="text-surface-600-400 text-xs" data-link-locked>
									{row.locked}
								</p>
								{#if row.rel.description}
									<p class="text-xs">{row.rel.description}</p>
								{/if}
							{:else if editing}
								<RelationshipFields
									value={editing}
									pairing={row.pairing}
									whenOptions={when}
									withReason
									onChange={(next) => (editing = next)}
								/>
								{#if staleNote}
									<p
										class="text-warning-600-400 text-xs"
										role="status"
										data-place-link-stale
									>
										This link was changed elsewhere while you were
										editing it. Save puts yours in its place; Cancel
										keeps the other.
									</p>
								{/if}
								{#if rowError}
									<p
										class="text-error-600-400 text-xs"
										role="alert"
										data-place-link-error
									>
										{rowError}
									</p>
								{/if}
								<div class="flex flex-wrap items-center justify-end gap-2">
									{#if confirmingUnlink}
										<span class="text-error-600-400 mr-auto text-xs">
											Unlink {row.otherName}?
										</span>
										<button
											class="btn btn-sm preset-filled-error-500 text-xs"
											type="button"
											disabled={saving}
											onclick={unlink}
											data-place-link-confirm-unlink
										>
											Unlink
										</button>
										<button
											class="btn btn-sm preset-tonal-surface text-xs"
											type="button"
											onclick={() => (confirmingUnlink = false)}
										>
											Keep
										</button>
									{:else}
										<button
											class="btn btn-sm preset-tonal-error mr-auto text-xs"
											type="button"
											onclick={() => (confirmingUnlink = true)}
											data-place-link-unlink
										>
											<Icons.Unlink size={13} aria-hidden="true" />
											<span>Unlink</span>
										</button>
										<button
											class="btn btn-sm preset-tonal-surface text-xs"
											type="button"
											onclick={closeRow}
										>
											Cancel
										</button>
										<button
											class="btn btn-sm preset-tonal-primary text-xs"
											type="button"
											disabled={saving || !rowChanged || rowProblem !== null}
											title={rowProblem ?? undefined}
											onclick={saveRow}
											data-place-link-save
										>
											<Icons.Save size={13} aria-hidden="true" />
											<span>Save</span>
										</button>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
