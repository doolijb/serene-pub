<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import { Dialog, Portal, Switch } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import {
		enumValues,
		listItemsOf,
		listWithAdded,
		listWithout,
		numberDraftFor,
		slotIsWhole,
		textDraftValue
	} from "@serene-pub/core-catalog/session-state"
	import type { SlotValue } from "@serene-pub/sdk"
	import {
		LIMIT_LABEL,
		blankSlotForm,
		cardStatChanges,
		cardStatGroups,
		limitKeys,
		sheetSlotLabels,
		sheetsMoved,
		slotPropsFrom,
		valueText,
		type CardStatRow,
		type NewSlotForm,
		type NewSlotType
	} from "./cardStats"
	import type { CardStatsApi } from "./cardStatsApi"

	/**
	 * 🚧 The character form's **Stats** tab (DESIGN-card-strokes-and-dowry
	 * §B.4): what this character brings to every session it joins — the
	 * sheets it carries, a starting value for each stat and the limits it
	 * holds to.
	 *
	 * Sheets apply at once. Values and limits are held here until **Save
	 * stats**, which sends them all in ONE `cardState:set` — separately from
	 * the character's own Save, because the character form may be unsaved and
	 * a card's stats are rows of their own. A refusal is said under the button
	 * it came from, never as a toast. What is drawn is the server's reply.
	 */
	interface Props {
		/** Absent on a character not saved yet: stats need a card to hang on. */
		characterId?: number
		/** The tab is on show — the first read waits for it. */
		active: boolean
		api: CardStatsApi
		/** Edits not yet sent with Save stats. */
		dirty?: boolean
	}

	let { characterId, active, api, dirty = $bindable(false) }: Props = $props()

	const uid = $props.id()

	// ── The read ──────────────────────────────────────────────────────────

	let read = $state<Sockets.CardState.Get.Response | null>(null)
	let loadError = $state<string | null>(null)
	let reads = 0

	const failure = (err: unknown, fallback: string) =>
		isReplyTimeout(err)
			? "The server did not answer. Nothing was saved; try again."
			: err instanceof Error && err.message
				? err.message
				: fallback

	function load(id: number) {
		const attempt = ++reads
		api.read(id).then(
			(res) => {
				if (attempt !== reads) return
				read = res
				loadError = null
			},
			(err) => {
				if (attempt !== reads) return
				loadError = failure(err, "This character's stats could not be read.")
			}
		)
	}

	// First read when the tab is first shown; again when the card changes.
	let readFor = $state<number | null>(null)
	$effect(() => {
		const id = characterId
		if (!id || !active) return
		untrack(() => {
			if (readFor === id) return
			readFor = id
			read = null
			load(id)
		})
	})

	// Another tab or surface wrote the card's layer: read again.
	$effect(() => {
		const id = characterId
		if (!id) return
		return declareInterest<"cardState:changed">(interestKey("cardState:changed", id), () => {
			if (readFor === id) load(id)
		})
	})

	let groups = $derived(read ? cardStatGroups(read) : [])

	// ── Sheets (apply at once) ────────────────────────────────────────────

	let sheetBusy = $state(false)
	let sheetError = $state<string | null>(null)
	let pickKey = $state(0)

	let sheetsById = $derived(new Map((read?.available.sheets ?? []).map((s) => [s.id, s])))
	let sheetOptions = $derived(
		read
			? read.available.sheets
					.filter((s) => !read!.sheets.includes(s.id))
					.map((s) => ({
						value: s.id,
						label: s.label,
						hint: s.retired
							? "Retired — kept where it is, offered nowhere new"
							: sheetSlotLabels(s, read!) || undefined,
						disabled: s.retired
					}))
			: []
	)

	async function setSheets(ids: string[]) {
		if (!characterId || sheetBusy) return
		sheetBusy = true
		sheetError = null
		try {
			read = await api.setSheets(characterId, ids)
		} catch (err) {
			sheetError = failure(err, "The sheets could not be saved.")
		} finally {
			sheetBusy = false
			pickKey++
		}
	}

	// ── Values and limits (held until Save stats) ─────────────────────────

	/** A value to set, by slot; `null` clears the card's own. */
	let values = $state<Record<string, SlotValue | null>>({})
	/** The card's own limits, by slot; `null` resets them. */
	let limits = $state<Record<string, Record<string, unknown> | null>>({})
	/** A list's typed item, before Enter. */
	let words = $state<Record<string, string>>({})
	let rowErrors = $state<Record<string, string | null>>({})
	let saving = $state(false)
	let saveError = $state<string | null>(null)
	let changes = $derived(cardStatChanges(values, limits))

	$effect(() => {
		dirty = changes.length > 0
	})

	const shown = (row: CardStatRow): SlotValue | undefined =>
		row.slot.slotId in values ? (values[row.slot.slotId] ?? undefined) : row.value
	const shownLimits = (row: CardStatRow): Record<string, unknown> =>
		row.slot.slotId in limits ? (limits[row.slot.slotId] ?? {}) : (row.ownConfig ?? {})

	function setValue(row: CardStatRow, v: SlotValue | null) {
		rowErrors[row.slot.slotId] = null
		const was = row.value ?? null
		if (JSON.stringify(v) === JSON.stringify(was)) delete values[row.slot.slotId]
		else values[row.slot.slotId] = v
	}

	function setNumber(row: CardStatRow, raw: string) {
		const next = numberDraftFor(raw, {}, slotIsWhole(row.slot as never))
		if (next === undefined) {
			rowErrors[row.slot.slotId] = `${row.slot.label} is a number.`
			return
		}
		setValue(row, next)
	}

	function setLimit(row: CardStatRow, key: string, n: number | null) {
		const own = { ...shownLimits(row) }
		if (n === null || !Number.isFinite(n)) delete own[key]
		else own[key] = Math.trunc(n)
		limits[row.slot.slotId] = own
	}

	function resetLimits(row: CardStatRow) {
		if (row.ownConfig) limits[row.slot.slotId] = null
		else delete limits[row.slot.slotId]
	}

	function addWord(e: KeyboardEvent, row: CardStatRow) {
		if (e.key !== "Enter") return
		e.preventDefault()
		const slotId = row.slot.slotId
		const edit = listWithAdded(shown(row), words[slotId] ?? "", row.config)
		if (!edit) return
		if (edit.refusal) {
			rowErrors[slotId] = edit.refusal
			return
		}
		setValue(row, edit.value)
		words[slotId] = ""
	}

	function discard() {
		values = {}
		limits = {}
		rowErrors = {}
		saveError = null
	}

	async function save() {
		if (!characterId || saving || !changes.length) return
		saving = true
		saveError = null
		try {
			read = await api.write(characterId, changes)
			values = {}
			limits = {}
		} catch (err) {
			saveError = failure(err, "The stats could not be saved.")
		} finally {
			saving = false
		}
	}

	const choiceOptions = (row: CardStatRow) => [
		{ value: "", label: row.fallback !== undefined ? `Default (${valueText(row.slot, row.fallback)})` : "Not set" },
		...enumValues(row.config).map((v) => ({ value: v, label: v }))
	]

	const placeholderOf = (row: CardStatRow) =>
		row.fallback !== undefined ? `Default: ${valueText(row.slot, row.fallback)}` : "Not set"

	// ── New slot / New sheet ──────────────────────────────────────────────

	let slotOpen = $state(false)
	let slotForm = $state<NewSlotForm>(blankSlotForm())
	let slotBusy = $state(false)
	let slotError = $state<string | null>(null)

	function openSlot() {
		slotForm = blankSlotForm()
		slotError = null
		slotOpen = true
	}

	async function declareSlot() {
		if (slotBusy) return
		const built = slotPropsFrom(slotForm)
		if (!built.props) {
			slotError = built.refusal
			return
		}
		slotBusy = true
		slotError = null
		try {
			const slot = await api.declareSlot({ name: slotForm.label.trim(), props: built.props })
			slotOpen = false
			// A slot reaches a card through a sheet: the next New sheet… starts
			// with it picked.
			pendingSheetSlots = [...pendingSheetSlots, slot.id]
			if (characterId) load(characterId)
		} catch (err) {
			slotError = failure(err, "The slot could not be declared.")
		} finally {
			slotBusy = false
		}
	}

	let sheetOpen = $state(false)
	let sheetLabel = $state("")
	let sheetDescription = $state("")
	let sheetSlots = $state<string[]>([])
	let sheetBusyNew = $state(false)
	let sheetNewError = $state<string | null>(null)
	/** Slots declared here this visit, offered first on a new sheet. */
	let pendingSheetSlots = $state<string[]>([])
	let slotPickKey = $state(0)

	function openSheet() {
		sheetLabel = ""
		sheetDescription = ""
		sheetSlots = [...pendingSheetSlots]
		sheetNewError = null
		sheetOpen = true
	}

	let slotLabels = $derived(new Map((read?.available.slots ?? []).map((s) => [s.id, s.label])))
	let sheetSlotOptions = $derived(
		(read?.available.slots ?? [])
			.filter((s) => !s.retired && !sheetSlots.includes(s.id))
			.map((s) => ({ value: s.id, label: s.label, hint: s.description }))
	)

	async function declareSheet() {
		if (sheetBusyNew) return
		const label = sheetLabel.trim()
		if (!label) {
			sheetNewError = "Give the sheet a label."
			return
		}
		if (!sheetSlots.length) {
			sheetNewError = "Pick at least one slot for the sheet."
			return
		}
		sheetBusyNew = true
		sheetNewError = null
		try {
			const sheet = await api.declareSheet({
				name: label,
				props: {
					label,
					...(sheetDescription.trim() ? { description: sheetDescription.trim() } : {}),
					slots: sheetSlots.map((id) => ({ id }))
				}
			})
			sheetOpen = false
			pendingSheetSlots = []
			if (read && !read.sheets.includes(sheet.id)) await setSheets([...read.sheets, sheet.id])
		} catch (err) {
			sheetNewError = failure(err, "The sheet could not be declared.")
		} finally {
			sheetBusyNew = false
		}
	}

	const TYPE_OPTIONS: Array<{ value: NewSlotType; label: string; hint: string }> = [
		{ value: "integer", label: "Number", hint: "A whole number, with optional bounds" },
		{ value: "enum", label: "Choice", hint: "One of a fixed set of values" },
		{ value: "text", label: "Text", hint: "A line of words" },
		{ value: "boolean", label: "Yes or no", hint: "On or off" },
		{ value: "list", label: "List", hint: "Items — an inventory, conditions" }
	]

	const switchClass =
		"preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
</script>

{#snippet numberField(label: string, value: number | null, set: (n: number | null) => void)}
	<label class="flex w-28 flex-col gap-1 text-xs">
		<span class="text-surface-600-400">{label}</span>
		<input
			class="input preset-filled-surface-200-800 rounded-lg text-sm"
			type="number"
			step="1"
			{value}
			oninput={(e) =>
				set(Number.isFinite(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : null)}
		/>
	</label>
{/snippet}

<section class="flex flex-col gap-3" aria-labelledby="{uid}-heading" data-card-stats>
	{#if !characterId}
		<div class="panel-card flex flex-col items-center gap-2 py-8 text-center" data-card-stats-unsaved>
			<Icons.HeartPulse size={24} class="text-surface-600-400" aria-hidden="true" />
			<p class="text-sm">Save the character first to give it stats.</p>
			<p class="text-surface-600-400 text-xs">
				Stats are kept with the character, so it needs to exist before it can hold them.
			</p>
		</div>
	{:else if loadError}
		<p class="text-error-600-400 text-xs" role="alert">{loadError}</p>
	{:else if !read}
		<p class="text-surface-600-400 text-xs">Reading this character's stats…</p>
	{:else}
		<section class="panel-card flex flex-col gap-2">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 id="{uid}-heading" class="text-sm font-medium">Sheets</h2>
				<span class="text-surface-600-400 text-xs">Applies at once</span>
			</div>
			<p class="text-surface-600-400 text-xs">
				The stats this character brings to every session it joins, in this order.
			</p>
			{#if read.sheets.length}
				<ul class="flex flex-wrap gap-1.5" aria-label="Sheets this character carries" data-card-sheets>
					{#each read.sheets as id, i (id)}
						{@const sheet = sheetsById.get(id)}
						<li
							class="preset-tonal-surface flex max-w-full min-w-0 items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2.5 text-sm"
							data-card-sheet={id}
						>
							<span class="min-w-0 truncate">{sheet?.label ?? id}</span>
							{#if sheet?.retired}
								<span class="badge preset-tonal-warning ml-1 text-meta">retired</span>
							{/if}
							<button
								type="button"
								class="btn-icon btn-icon-sm hover:preset-tonal-surface pointer-coarse:size-11 size-7 min-w-0 rounded-full p-0"
								aria-label="Move {sheet?.label ?? id} earlier"
								disabled={sheetBusy || i === 0}
								onclick={() => setSheets(sheetsMoved(read!.sheets, i, -1))}
							>
								<Icons.ChevronLeft size={13} aria-hidden="true" />
							</button>
							<button
								type="button"
								class="btn-icon btn-icon-sm hover:preset-tonal-surface pointer-coarse:size-11 size-7 min-w-0 rounded-full p-0"
								aria-label="Move {sheet?.label ?? id} later"
								disabled={sheetBusy || i === read.sheets.length - 1}
								onclick={() => setSheets(sheetsMoved(read!.sheets, i, 1))}
							>
								<Icons.ChevronRight size={13} aria-hidden="true" />
							</button>
							<button
								type="button"
								class="btn-icon btn-icon-sm hover:preset-tonal-surface pointer-coarse:size-11 size-7 min-w-0 rounded-full p-0"
								aria-label="Remove {sheet?.label ?? id}"
								disabled={sheetBusy}
								onclick={() => setSheets(read!.sheets.filter((s) => s !== id))}
							>
								<Icons.X size={13} aria-hidden="true" />
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-surface-600-400 text-xs">No sheets yet.</p>
			{/if}
			<div class="flex flex-wrap items-end gap-2">
				{#key pickKey}
					<Select
						label="Add a sheet"
						class="min-w-0 flex-[1_1_14rem] text-sm"
						options={sheetOptions}
						value={null}
						placeholder="Pick a sheet"
						emptyMessage="No other sheet fits a character."
						disabled={sheetBusy}
						onValueChange={(v) => v && setSheets([...read!.sheets, v])}
					/>
				{/key}
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={openSheet} data-card-new-sheet>
					<Icons.Plus size={14} aria-hidden="true" />
					<span>New sheet…</span>
				</button>
			</div>
			{#if sheetError}
				<p class="text-error-600-400 text-xs" role="alert">{sheetError}</p>
			{/if}
		</section>

		<section class="panel-card flex flex-col gap-3" aria-label="Stats">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 class="text-sm font-medium">Stats</h2>
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={openSlot} data-card-new-slot>
					<Icons.Plus size={14} aria-hidden="true" />
					<span>New slot…</span>
				</button>
			</div>
			<p class="text-surface-600-400 text-xs">
				Where every session with this character starts. Saved with <strong>Save stats</strong>, not
				with the character's Save.
			</p>

			{#if !groups.length}
				<p class="text-surface-600-400 text-xs">Pick a sheet to give this character stats.</p>
			{/if}

			{#each groups as group (group.sheetId ?? "loose")}
				<div class="flex flex-col gap-1.5" data-card-stat-group={group.sheetId ?? "loose"}>
					<h3 class="text-surface-600-400 text-xs">{group.label}</h3>
					<ul class="flex flex-col gap-1.5">
						{#each group.rows as row (row.slot.slotId)}
							{@const slotId = row.slot.slotId}
							{@const v = shown(row)}
							{@const own = shownLimits(row)}
							<li
								class="bg-surface-50-950 border-surface-200-800 flex flex-col gap-2 rounded-lg border p-2.5 {row.writable
									? ''
									: 'opacity-70'} {slotId in values || slotId in limits ? 'border-primary-500/60' : ''}"
								data-card-stat={slotId}
							>
								<div class="flex min-w-0 flex-wrap items-baseline gap-x-2">
									<span id="{uid}-{slotId}-label" class="text-sm font-medium">{row.slot.label}</span>
									{#if row.slot.description}
										<span class="text-surface-600-400 text-xs">{row.slot.description}</span>
									{/if}
									{#if row.slot.retired}
										<span class="badge preset-tonal-surface text-meta">retired</span>
									{/if}
									{#if slotId in values || slotId in limits}
										<span class="text-primary-ink ml-auto text-meta">Not saved</span>
									{/if}
								</div>

								{#if !row.writable}
									<p class="text-sm">
										{valueText(row.slot, v) || (row.slot.type === "derived" ? "Worked out in play" : "Not set")}
									</p>
								{:else if row.kind === "list"}
									{@const items = listItemsOf(v)}
									{#if items.length}
										<ul class="flex flex-wrap gap-1.5" aria-labelledby="{uid}-{slotId}-label">
											{#each items as item, i (`${i}:${String(item)}`)}
												<li class="preset-tonal-surface flex items-center gap-1 rounded-full py-0.5 pr-0.5 pl-2.5 text-sm">
													<span>{String(item)}</span>
													<button
														type="button"
														class="btn-icon btn-icon-sm hover:preset-tonal-surface pointer-coarse:size-11 size-7 min-w-0 rounded-full p-0"
														aria-label="Remove {String(item)}"
														onclick={() => setValue(row, listWithout(v, i))}
													>
														<Icons.X size={13} aria-hidden="true" />
													</button>
												</li>
											{/each}
										</ul>
									{/if}
									<input
										class="input preset-filled-surface-200-800 w-full rounded-lg text-sm"
										type="text"
										aria-label="Add an item to {row.slot.label}"
										placeholder={items.length ? "Type an item, then Enter" : `${placeholderOf(row)} — type an item, then Enter`}
										value={words[slotId] ?? ""}
										oninput={(e) => (words[slotId] = e.currentTarget.value)}
										onkeydown={(e) => addWord(e, row)}
									/>
								{:else if row.kind === "choice"}
									<Select
										label={row.slot.label}
										labelHidden
										class="text-sm"
										options={choiceOptions(row)}
										value={typeof v === "string" ? v : ""}
										placeholder={placeholderOf(row)}
										onValueChange={(next) => setValue(row, next || null)}
									/>
								{:else if row.kind === "boolean"}
									<div class="flex items-center gap-3">
										<Switch
											checked={v === true}
											onCheckedChange={(e) => setValue(row, e.checked)}
											class="flex items-center gap-2"
										>
											<Switch.Control class={switchClass}>
												<Switch.Thumb />
											</Switch.Control>
											<Switch.Label class="text-sm">
												{v === true ? "Yes" : v === false ? "No" : placeholderOf(row)}
											</Switch.Label>
											<Switch.HiddenInput />
										</Switch>
										{#if typeof v === "boolean"}
											<button
												type="button"
												class="btn btn-sm hover:preset-tonal-surface px-2 text-xs"
												aria-label="Clear {row.slot.label}"
												onclick={() => setValue(row, null)}
											>
												Clear
											</button>
										{/if}
									</div>
								{:else if row.kind === "number"}
									<input
										class="input preset-filled-surface-200-800 w-40 rounded-lg text-sm"
										type="number"
										min={typeof row.config.min === "number" ? row.config.min : undefined}
										max={typeof row.config.max === "number" ? row.config.max : undefined}
										step={slotIsWhole(row.slot as never) ? 1 : "any"}
										aria-labelledby="{uid}-{slotId}-label"
										placeholder={placeholderOf(row)}
										value={typeof v === "number" ? v : ""}
										onchange={(e) => setNumber(row, e.currentTarget.value)}
									/>
								{:else}
									<input
										class="input preset-filled-surface-200-800 w-full rounded-lg text-sm"
										type="text"
										aria-labelledby="{uid}-{slotId}-label"
										placeholder={placeholderOf(row)}
										value={typeof v === "string" ? v : ""}
										onchange={(e) => setValue(row, textDraftValue(e.currentTarget.value, row.config))}
									/>
								{/if}

								{#if row.writable && limitKeys(row.kind).length}
									<details class="text-xs" data-card-limits>
										<summary class="text-surface-600-400 cursor-pointer">
											Limits{row.ownConfig || limits[slotId] ? " · this character's own" : ""}
										</summary>
										<div class="mt-1.5 flex flex-wrap items-end gap-2">
											{#each limitKeys(row.kind) as key (key)}
												{@render numberField(
													LIMIT_LABEL[key],
													typeof own[key] === "number"
														? (own[key] as number)
														: null,
													(n) => setLimit(row, key, n)
												)}
											{/each}
											<button
												type="button"
												class="btn btn-sm hover:preset-tonal-surface px-2 text-xs"
												disabled={!row.ownConfig && !(slotId in limits)}
												onclick={() => resetLimits(row)}
											>
												<Icons.RotateCcw size={13} aria-hidden="true" />
												<span>Reset</span>
											</button>
										</div>
										<p class="text-surface-600-400 mt-1">
											Empty keeps the slot's own{typeof row.config.min === "number" ||
											typeof row.config.max === "number"
												? ` (now ${row.config.min ?? "—"} to ${row.config.max ?? "—"})`
												: ""}.
										</p>
									</details>
								{/if}

								{#if rowErrors[slotId]}
									<p class="text-error-600-400 text-xs" role="alert">{rowErrors[slotId]}</p>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/each}

			<div class="flex flex-wrap items-center justify-end gap-2">
				{#if changes.length}
					<span class="text-surface-600-400 mr-auto text-xs" aria-live="polite">
						{changes.length} {changes.length === 1 ? "stat" : "stats"} not saved
					</span>
					<button type="button" class="btn btn-sm preset-tonal-surface" disabled={saving} onclick={discard}>
						Discard
					</button>
				{/if}
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					disabled={!changes.length || saving}
					onclick={save}
					data-card-save-stats
				>
					{#if saving}<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{/if}
					<span>Save stats</span>
				</button>
			</div>
			{#if saveError}
				<p class="text-error-600-400 text-right text-xs" role="alert">{saveError}</p>
			{/if}
		</section>
	{/if}
</section>

<Dialog open={slotOpen} onOpenChange={(e) => (slotOpen = e.open)}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto p-5 shadow-xl"
				data-card-slot-dialog
			>
				<header class="flex items-start justify-between gap-3">
					<div>
						<Dialog.Title class="text-lg font-semibold">New slot</Dialog.Title>
						<Dialog.Description class="text-surface-600-400 text-sm">
							A stat a character can carry. It is yours, offered on every card; put it on a sheet to
							give it to this one.
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger class="btn-icon btn-icon-sm hover:preset-tonal" aria-label="Close">
						<Icons.X size={16} />
					</Dialog.CloseTrigger>
				</header>
				<div class="flex flex-col gap-3 text-sm">
					<label class="flex flex-col gap-1">
						<span class="text-surface-600-400 text-xs">Label</span>
						<input class="input rounded-base" type="text" bind:value={slotForm.label} placeholder="Nerve" />
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-surface-600-400 text-xs">Description (optional)</span>
						<input
							class="input rounded-base"
							type="text"
							bind:value={slotForm.description}
							placeholder="Shown where the stat is listed"
						/>
					</label>
					<Select
						label="Type"
						class="text-sm"
						options={TYPE_OPTIONS}
						value={slotForm.type}
						onValueChange={(v) => {
							slotForm.type = (v || "integer") as NewSlotType
							slotForm.defaultText = ""
						}}
					/>
					<label class="flex flex-col gap-1">
						<span class="text-surface-600-400 text-xs">What the model is told this is</span>
						<textarea
							class="input rounded-base"
							rows="2"
							bind:value={slotForm.descriptor}
							placeholder="How steady their nerves are, 0 to 10."
						></textarea>
						<span class="text-surface-600-400 text-xs">Required. Changing it later changes every prompt it is in.</span>
					</label>
					{#if slotForm.type === "integer"}
						<div class="flex flex-wrap gap-2">
							{@render numberField("Lowest", slotForm.min, (n) => (slotForm.min = n))}
							{@render numberField("Highest", slotForm.max, (n) => (slotForm.max = n))}
						</div>
					{:else if slotForm.type === "enum"}
						<label class="flex flex-col gap-1">
							<span class="text-surface-600-400 text-xs">Values, comma separated</span>
							<input class="input rounded-base" type="text" bind:value={slotForm.values} placeholder="calm, wary, afraid" />
						</label>
					{:else if slotForm.type === "text"}
						{@render numberField("Longest text", slotForm.maxLength, (n) => (slotForm.maxLength = n))}
					{:else if slotForm.type === "list"}
						<div class="flex flex-wrap items-end gap-2">
							{@render numberField("Most items", slotForm.maxItems, (n) => (slotForm.maxItems = n))}
							{@render numberField("Longest item", slotForm.maxLength, (n) => (slotForm.maxLength = n))}
							<label class="flex items-center gap-2 pb-2 text-sm">
								<input class="checkbox" type="checkbox" bind:checked={slotForm.unique} />
								<span>A repeat is one item</span>
							</label>
						</div>
					{/if}
					{#if slotForm.type === "boolean"}
						<Select
							label="Default"
							class="text-sm"
							options={[
								{ value: "", label: "None" },
								{ value: "yes", label: "Yes" },
								{ value: "no", label: "No" }
							]}
							value={slotForm.defaultText}
							onValueChange={(v) => (slotForm.defaultText = v)}
						/>
					{:else}
						<label class="flex flex-col gap-1">
							<span class="text-surface-600-400 text-xs">
								Default (optional){slotForm.type === "list" ? ", comma separated" : ""}
							</span>
							<input class="input rounded-base" type="text" bind:value={slotForm.defaultText} />
						</label>
					{/if}
				</div>
				<footer class="flex flex-col items-end gap-1.5">
					<div class="flex gap-2">
						<button type="button" class="btn preset-tonal-surface" onclick={() => (slotOpen = false)}>Cancel</button>
						<button
							type="button"
							class="btn preset-filled-primary-500"
							disabled={slotBusy}
							onclick={declareSlot}
							data-card-slot-declare
						>
							Create slot
						</button>
					</div>
					{#if slotError}
						<p class="text-error-600-400 text-xs" role="alert">{slotError}</p>
					{/if}
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<Dialog open={sheetOpen} onOpenChange={(e) => (sheetOpen = e.open)}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto p-5 shadow-xl"
				data-card-sheet-dialog
			>
				<header class="flex items-start justify-between gap-3">
					<div>
						<Dialog.Title class="text-lg font-semibold">New sheet</Dialog.Title>
						<Dialog.Description class="text-surface-600-400 text-sm">
							A set of slots, in order. It is yours, offered on every card, and goes on this one now.
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger class="btn-icon btn-icon-sm hover:preset-tonal" aria-label="Close">
						<Icons.X size={16} />
					</Dialog.CloseTrigger>
				</header>
				<div class="flex flex-col gap-3 text-sm">
					<label class="flex flex-col gap-1">
						<span class="text-surface-600-400 text-xs">Label</span>
						<input class="input rounded-base" type="text" bind:value={sheetLabel} placeholder="Grit" />
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-surface-600-400 text-xs">Description (optional)</span>
						<input class="input rounded-base" type="text" bind:value={sheetDescription} />
					</label>
					<div class="flex flex-col gap-1.5">
						<span class="text-surface-600-400 text-xs">Slots, in order</span>
						{#if sheetSlots.length}
							<ol class="flex flex-col gap-1">
								{#each sheetSlots as id, i (id)}
									<li class="bg-surface-50-950 border-surface-200-800 flex items-center gap-1 rounded-lg border py-1 pr-1 pl-2.5">
										<span class="min-w-0 flex-1 truncate">{slotLabels.get(id) ?? id}</span>
										<button
											type="button"
											class="btn-icon btn-icon-sm hover:preset-tonal-surface size-7 p-0"
											aria-label="Move {slotLabels.get(id) ?? id} up"
											disabled={i === 0}
											onclick={() => (sheetSlots = sheetsMoved(sheetSlots, i, -1))}
										>
											<Icons.ArrowUp size={13} aria-hidden="true" />
										</button>
										<button
											type="button"
											class="btn-icon btn-icon-sm hover:preset-tonal-surface size-7 p-0"
											aria-label="Move {slotLabels.get(id) ?? id} down"
											disabled={i === sheetSlots.length - 1}
											onclick={() => (sheetSlots = sheetsMoved(sheetSlots, i, 1))}
										>
											<Icons.ArrowDown size={13} aria-hidden="true" />
										</button>
										<button
											type="button"
											class="btn-icon btn-icon-sm hover:preset-tonal-surface size-7 p-0"
											aria-label="Remove {slotLabels.get(id) ?? id}"
											onclick={() => (sheetSlots = sheetSlots.filter((s) => s !== id))}
										>
											<Icons.X size={13} aria-hidden="true" />
										</button>
									</li>
								{/each}
							</ol>
						{/if}
						{#key slotPickKey}
							<Select
								label="Add a slot"
								labelHidden
								class="text-sm"
								options={sheetSlotOptions}
								value={null}
								placeholder="Add a slot"
								emptyMessage="No other slot fits a character."
								onValueChange={(v) => {
									if (v) sheetSlots = [...sheetSlots, v]
									slotPickKey++
								}}
							/>
						{/key}
					</div>
				</div>
				<footer class="flex flex-col items-end gap-1.5">
					<div class="flex gap-2">
						<button type="button" class="btn preset-tonal-surface" onclick={() => (sheetOpen = false)}>Cancel</button>
						<button
							type="button"
							class="btn preset-filled-primary-500"
							disabled={sheetBusyNew}
							onclick={declareSheet}
							data-card-sheet-declare
						>
							Create sheet
						</button>
					</div>
					{#if sheetNewError}
						<p class="text-error-600-400 text-xs" role="alert">{sheetNewError}</p>
					{/if}
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
