<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { isReplyTimeout } from "$lib/client/utils/awaitReply"
	import {
		countDraftFor,
		enumValues,
		listWithAdded,
		listWithout,
		listWithRefAdded,
		listWithRefStep,
		numberDraftFor,
		slotIsWhole,
		slotTakesLoreRefs,
		textDraftValue
	} from "@serene-pub/core-catalog/session-state"
	import type { SlotValue } from "@serene-pub/sdk"
	import type { PoolItem } from "../poolFilter"
	import { formatDate } from "../sections/historyDates"
	import { momentDate } from "../time/moment"
	import {
		placeStatPicks,
		placeStatRows,
		placeStatsDating,
		placeStatsReadParams,
		placeStatsWriteParams,
		type PlaceStatRow
	} from "./placeStats"
	import type { PlaceStatsApi } from "./placeStatsApi"

	/**
	 * 🚧 A place's **Stats** (plan places-graph L4; owner answer Q5,
	 * 2026-09-29): what the lorebook holds for this place before play — the
	 * key in the crypt — and what every session on the book starts from until
	 * it changes the value itself.
	 *
	 * Limited as ruled: the inventory, and the place stats the book already
	 * records. Read and written at the line and moment the editor reads. The
	 * SERVER dates a change: by the history entry dated the moment being read
	 * (`writeDatedBy`), as a Link drawn here is; else it keeps the date of the
	 * value it changes (`heldSince`, shown beside the stat).
	 *
	 * Every edit is written at once, never with the entry's Save, and what is
	 * drawn is the server's reply — never this section's guess. A write names
	 * the value it was made from, so a stale list never lands over a newer
	 * one; a refusal is said under the stat it came from, and the section
	 * reads again. Only the book's owner writes (B0); the server refuses
	 * anyone else.
	 */
	interface Props {
		place: { id: number; name: string }
		lorebookId: number
		/** The book's rows on the line being read: names, and what can be picked. */
		pool: readonly PoolItem[]
		/** The line and the moment the editor reads. */
		reading: {
			branchId: number | null
			moment: string | null | undefined
		}
		api: PlaceStatsApi
	}

	let { place, lorebookId, pool, reading, api }: Props = $props()

	const uid = $props.id()

	// ── The read ──────────────────────────────────────────────────────────

	let read = $state<Sockets.LorebookState.Get.Response | null>(null)
	let loadError = $state<string | null>(null)
	/** Which reading the shown read answers; a reply for another is dropped. */
	let readKey = $state("")
	let reads = 0

	let key = $derived(
		`${lorebookId}:${place.id}:${reading.branchId ?? "main"}:${reading.moment ?? "now"}`
	)

	const failure = (err: unknown, fallback: string) =>
		isReplyTimeout(err)
			? "The server did not answer. Nothing was saved; try again."
			: err instanceof Error && err.message
				? err.message
				: fallback

	/** Read the place at the reading `at` names; the newest read owns the section. */
	function load(at: string) {
		const attempt = ++reads
		if (readKey !== at) {
			read = null
			loadError = null
		}
		const params = placeStatsReadParams(lorebookId, place.id, {
			branchId: reading.branchId,
			moment: reading.moment
		})
		api.read(params).then(
			(res) => {
				if (attempt !== reads) return
				read = res
				readKey = at
				loadError = null
			},
			(err) => {
				if (attempt !== reads) return
				loadError = failure(err, "This place's stats could not be read.")
			}
		)
	}

	// Keyed on the reading's VALUE, never on the reading object: the editor
	// derives a new one on every navigation, and a read per navigation inside
	// one place is the B3 refresh defect again.
	$effect(() => {
		const at = key
		untrack(() => load(at))
	})

	let poolNames = $derived(new Map(pool.map((item) => [item.id, item.name.trim()])))
	let rows = $derived(
		read ? placeStatRows(read, (id) => poolNames.get(id) || undefined) : []
	)

	// ── Where a value stands ──────────────────────────────────────────────

	let moment = $derived(momentDate(reading.moment))
	let dating = $derived(
		read && readKey === key
			? placeStatsDating(
					moment ? formatDate(moment) : null,
					read.writeDatedBy ? formatDate(read.writeDatedBy.date) : null
				)
			: ""
	)

	// ── Writes ────────────────────────────────────────────────────────────

	let saving = $state<Record<string, boolean>>({})
	let errors = $state<Record<string, string | null>>({})
	/** What is typed in a number or text field, until it is written or put back. */
	let drafts = $state<Record<string, string>>({})
	/** A list's typed item, before Enter. */
	let words = $state<Record<string, string>>({})
	/** A list's picker: the entry chosen and how many. */
	let picked = $state<Record<string, string | null>>({})
	let pickCount = $state<Record<string, number | null>>({})

	/** Write one stat now; true once the server has it. */
	async function save(row: PlaceStatRow, value: SlotValue): Promise<boolean> {
		const slotId = row.slot.slotId
		if (saving[slotId]) return false
		const at = key
		saving[slotId] = true
		errors[slotId] = null
		try {
			const res = await api.write(
				placeStatsWriteParams(
					lorebookId,
					place.id,
					{ branchId: reading.branchId, moment: reading.moment },
					slotId,
					value,
					row.value
				)
			)
			if (at !== key) return true
			read = res
			readKey = at
			delete drafts[slotId]
			return true
		} catch (err) {
			errors[slotId] = failure(err, "The stat could not be saved.")
			// The server said no, so what it holds is the truth — possibly a
			// value another tab or a session wrote since this read.
			if (!isReplyTimeout(err) && at === key) load(at)
			return false
		} finally {
			saving[slotId] = false
		}
	}

	function refuse(row: PlaceStatRow, why: string) {
		errors[row.slot.slotId] = why
	}

	/** A refusal is said under its stat, below the fold of a long one: bring it into view. */
	function reveal(node: HTMLElement) {
		node.scrollIntoView?.({ block: "nearest" })
	}

	// A number or a line of text: Enter writes, Escape puts the book's back,
	// leaving writes only what changed.
	function commitField(row: PlaceStatRow) {
		const slotId = row.slot.slotId
		const draft = drafts[slotId]
		if (draft === undefined || draft === row.text) {
			delete drafts[slotId]
			return
		}
		if (row.kind === "number") {
			const next = numberDraftFor(draft, row.config, slotIsWhole(row.slot))
			if (next === undefined)
				return refuse(
					row,
					`${row.slot.label} is a ${slotIsWhole(row.slot) ? "whole number" : "number"}.`
				)
			return void save(row, next)
		}
		void save(row, textDraftValue(draft, row.config))
	}

	function fieldKeys(e: KeyboardEvent, row: PlaceStatRow) {
		if (e.key === "Enter") {
			e.preventDefault()
			commitField(row)
		} else if (e.key === "Escape") {
			e.preventDefault()
			delete drafts[row.slot.slotId]
			errors[row.slot.slotId] = null
			;(e.currentTarget as HTMLInputElement).value = row.text
		}
	}

	function addWords(e: KeyboardEvent, row: PlaceStatRow) {
		if (e.key !== "Enter") return
		e.preventDefault()
		const slotId = row.slot.slotId
		const edit = listWithAdded(row.value, words[slotId] ?? "", row.config)
		if (!edit) return
		if (edit.refusal) return refuse(row, edit.refusal)
		// Kept until the server has it: a refusal leaves the typing to fix.
		void save(row, edit.value).then((saved) => {
			if (saved) words[slotId] = ""
		})
	}

	function addPicked(row: PlaceStatRow) {
		const slotId = row.slot.slotId
		const entryId = Number(picked[slotId])
		const count = countDraftFor(pickCount[slotId] ?? 1)
		if (!Number.isInteger(entryId) || !entryId) return
		if (count === undefined) return refuse(row, "How many is a whole number, 1 or more.")
		const edit = listWithRefAdded(row.value, entryId, count, row.config)
		if (edit.refusal) return refuse(row, edit.refusal)
		void save(row, edit.value).then((saved) => {
			if (!saved) return
			picked[slotId] = null
			pickCount[slotId] = 1
		})
	}

	const choiceOptions = (row: PlaceStatRow) => [
		{ value: "", label: "Not set" },
		...enumValues(row.config).map((v) => ({ value: v, label: v }))
	]
</script>

<section class="flex flex-col gap-2" aria-labelledby="{uid}-heading" data-place-stats>
	<h4 id="{uid}-heading" class="text-sm font-semibold">Stats</h4>
	<p class="text-surface-600-400 text-xs" data-place-stats-dating>
		What the lorebook holds for this place. Every session on it starts from here until
		the session changes it. {dating}
	</p>

	{#if loadError}
		<p class="text-error-600-400 text-xs" role="alert">{loadError}</p>
	{:else if !read || readKey !== key}
		<p class="text-surface-600-400 text-xs">Reading this place's stats…</p>
	{:else if rows.length === 0}
		<p class="text-surface-600-400 text-xs">No stat applies to a place here yet.</p>
	{:else}
		<ul class="flex flex-col gap-1.5">
			{#each rows as row (row.slot.slotId)}
				{@const slotId = row.slot.slotId}
				<li
					class="bg-surface-100-900 border-surface-200-800 flex flex-col gap-2 rounded-lg border p-2.5 {row.writable
						? ''
						: 'opacity-70'}"
					data-place-stat={slotId}
					data-retired={row.writable ? undefined : ""}
					aria-busy={saving[slotId] ? "true" : undefined}
				>
					<div class="flex min-w-0 flex-wrap items-baseline gap-x-2">
						<span id="{uid}-{slotId}-label" class="text-sm font-medium">{row.slot.label}</span>
						{#if row.heldSince}
							<span class="text-surface-600-400 text-xs" data-place-stat-since>
								since {formatDate(row.heldSince)}
							</span>
						{/if}
						{#if !row.writable}
							<span class="badge preset-tonal-surface text-[11px]">retired</span>
						{/if}
					</div>

					{#if row.kind === "list"}
						{#if row.items.length}
							<ul class="flex flex-wrap gap-1.5" aria-labelledby="{uid}-{slotId}-label">
								{#each row.items as item (item.key)}
									<li
										class="preset-tonal-surface flex max-w-full min-w-0 items-center gap-1 rounded-full py-0.5 pr-0.5 pl-2.5 text-sm"
										data-place-stat-item
									>
										<span class="min-w-0 truncate" data-place-stat-item-text>{item.text}</span>
										{#if row.writable}
											{#if item.entryId !== null}
												<button
													type="button"
													class="btn-icon btn-icon-sm hover:preset-tonal-surface pointer-coarse:size-11 size-7 min-w-0 rounded-full p-0"
													aria-label="One fewer {item.name}"
													disabled={saving[slotId]}
													onclick={() => save(row, listWithRefStep(row.value, item.entryId!, -1))}
												>
													<Icons.Minus size={13} aria-hidden="true" />
												</button>
												<button
													type="button"
													class="btn-icon btn-icon-sm hover:preset-tonal-surface pointer-coarse:size-11 size-7 min-w-0 rounded-full p-0"
													aria-label="One more {item.name}"
													disabled={saving[slotId]}
													onclick={() => save(row, listWithRefStep(row.value, item.entryId!, 1))}
												>
													<Icons.Plus size={13} aria-hidden="true" />
												</button>
											{:else}
												<button
													type="button"
													class="btn-icon btn-icon-sm hover:preset-tonal-surface pointer-coarse:size-11 size-7 min-w-0 rounded-full p-0"
													aria-label="Remove {item.name}"
													disabled={saving[slotId]}
													onclick={() => save(row, listWithout(row.value, item.index))}
												>
													<Icons.X size={13} aria-hidden="true" />
												</button>
											{/if}
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="text-surface-600-400 text-xs">Nothing here yet.</p>
						{/if}

						{#if row.writable}
							<input
								class="input preset-filled-surface-200-800 w-full rounded-lg text-sm"
								type="text"
								aria-label="Add an item to {row.slot.label}"
								placeholder="Type an item, then Enter"
								value={words[slotId] ?? ""}
								oninput={(e) => (words[slotId] = e.currentTarget.value)}
								onkeydown={(e) => addWords(e, row)}
								disabled={saving[slotId]}
								data-place-stat-add-words
							/>
							{#if slotTakesLoreRefs(row.config)}
								{@const picks = placeStatPicks(pool, place.id, row.value)}
								<div class="flex flex-wrap items-end gap-2">
									<div class="min-w-0 flex-[1_1_12rem]">
										<Select
											label="Add from the lorebook"
											class="text-sm"
											options={picks.map((p) => ({
												value: String(p.entryId),
												label: p.title,
												hint: p.held ? `Here ×${p.held}` : undefined
											}))}
											value={picked[slotId] ?? null}
											placeholder="Pick an item or entry"
											emptyMessage="Nothing else in this lorebook to put here."
											onValueChange={(v) => (picked[slotId] = v || null)}
										/>
									</div>
									<label class="flex w-20 shrink-0 flex-col gap-1 text-xs" for="{uid}-{slotId}-count">
										<span class="text-surface-600-400">How many</span>
										<input
											id="{uid}-{slotId}-count"
											class="input preset-filled-surface-200-800 rounded-lg text-sm"
											type="number"
											min="1"
											step="1"
											value={pickCount[slotId] ?? 1}
											oninput={(e) =>
												(pickCount[slotId] = Number.isFinite(e.currentTarget.valueAsNumber)
													? e.currentTarget.valueAsNumber
													: null)}
											onkeydown={(e) => {
												if (e.key === "Enter") {
													e.preventDefault()
													addPicked(row)
												}
											}}
										/>
									</label>
									<button
										type="button"
										class="btn btn-sm preset-tonal-primary shrink-0"
										disabled={!picked[slotId] || saving[slotId]}
										onclick={() => addPicked(row)}
										data-place-stat-pick-add
									>
										<Icons.Plus size={13} aria-hidden="true" />
										<span>Add</span>
									</button>
								</div>
							{/if}
						{/if}
					{:else if !row.writable}
						<p class="text-sm">{row.text || "Not set"}</p>
					{:else if row.kind === "choice"}
						<Select
							label={row.slot.label}
							class="text-sm"
							options={choiceOptions(row)}
							value={typeof row.value === "string" ? row.value : ""}
							placeholder="Not set"
							onValueChange={(v) => {
								if ((v || "") !== (typeof row.value === "string" ? row.value : ""))
									void save(row, v || null)
							}}
						/>
					{:else if row.kind === "boolean"}
						<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
							<label class="flex items-center gap-2 text-sm">
								<input
									class="checkbox"
									type="checkbox"
									checked={row.value === true}
									disabled={saving[slotId]}
									onchange={(e) => save(row, e.currentTarget.checked)}
								/>
								<span>{row.value === true ? "Yes" : row.value === false ? "No" : "Not set"}</span>
							</label>
							{#if typeof row.value === "boolean"}
								<button
									type="button"
									class="btn btn-sm hover:preset-tonal-surface pointer-coarse:min-h-11 px-2 text-xs"
									aria-label="Clear {row.slot.label}"
									disabled={saving[slotId]}
									onclick={() => save(row, null)}
									data-place-stat-clear
								>
									Clear
								</button>
							{/if}
						</div>
					{:else}
						<input
							class="input preset-filled-surface-200-800 w-full rounded-lg text-sm"
							type={row.kind === "number" ? "number" : "text"}
							min={row.kind === "number" && typeof row.config.min === "number" ? row.config.min : undefined}
							max={row.kind === "number" && typeof row.config.max === "number" ? row.config.max : undefined}
							step={row.kind === "number" ? (slotIsWhole(row.slot) ? 1 : "any") : undefined}
							aria-labelledby="{uid}-{slotId}-label"
							placeholder="Not set"
							value={drafts[slotId] ?? row.text}
							oninput={(e) => (drafts[slotId] = e.currentTarget.value)}
							onkeydown={(e) => fieldKeys(e, row)}
							onblur={() => commitField(row)}
							disabled={saving[slotId]}
						/>
					{/if}

					{#if errors[slotId]}
						<p class="text-error-600-400 text-xs" role="alert" data-place-stat-error use:reveal>
							{errors[slotId]}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
