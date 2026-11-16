<script lang="ts">
	import { tick, type Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { bookTimeline } from "../bookData.svelte"
	import { formatDate } from "../sections/historyDates"
	import { dateProblem } from "$lib/shared/lorebooks/storyDate"
	import { keyList } from "$lib/shared/entries/keyList"
	import { isFileableEntryType } from "$lib/shared/entries/types"
	import { openBookTime } from "./bookTime.svelte"
	import type { ZoneField } from "./entryVersions"
	import { entryZoneWords } from "./entryZoneWords"
	import { CHANGE_FROM_VERSION_LABEL } from "./versionZones"

	/**
	 * 🚧 The entry zone's row: one line that says the entry in words (its line,
	 * Beginning, Decay and the fields the form holds in it) and opens on demand.
	 * Open, it shows Beginning, Decay, the form's own fields (`children`), the
	 * one Change from this version… control, then the line and its action.
	 *
	 * Beginning is the entry's own `year`, `month`, `day` (`null` = Perpetual);
	 * with the book's Timeline off it is neither shown nor settable. Decay is
	 * `decayRate`, 0 (Fact) to 1; recall does not read it yet.
	 *
	 * ⚠ Only a person's choice writes the draft. Opening, or drawing, never
	 * does: the form's unsaved-changes check compares the draft with what was
	 * saved, and a write nobody made reads as a false change.
	 */
	interface Props {
		draft: Record<string, any>
		/** Distinguishes this instance's inputs from a sibling editor's. */
		idPrefix: string
		/** The line the entry is read on (*On main*); shown with the Timeline on. */
		lineWords?: string
		/** The row is unfolded. */
		open?: boolean
		/** Every control in the open region is disabled; the toggle stays live. */
		disabled?: boolean
		/** Which of the four entry fields the form puts in the row, for the words. */
		held?: readonly ZoneField[]
		/** The parent's name; null is top level. */
		parentName?: string | null
		/** Fields that can be made to differ at a date. */
		promotable?: readonly { field: ZoneField; name: string }[]
		onPromote?: (field: ZoneField) => void
		/** The entry's own fields, after Decay inside the fold. */
		children?: Snippet
		/** An action about the entry's line, drawn with the line in the fold. */
		lineAction?: Snippet
	}

	let {
		draft = $bindable(),
		idPrefix,
		lineWords,
		open = $bindable(false),
		disabled = false,
		held = [],
		parentName = null,
		promotable = [],
		onPromote,
		children,
		lineAction
	}: Props = $props()

	const timeline = bookTimeline()
	let changeOpen = $state(false)
	let toggleEl = $state<HTMLButtonElement | null>(null)
	let changeEl = $state<HTMLButtonElement | null>(null)
	/** A choice of Began at made before any year is typed, for this draft. */
	let chosen = $state.raw<{ draft: unknown; beganAt: boolean } | null>(null)

	const isNum = (v: unknown): v is number =>
		typeof v === "number" && Number.isFinite(v)
	const hasYear = $derived(isNum(draft?.year))
	const beganAt = $derived(
		chosen && chosen.draft === draft ? chosen.beganAt : hasYear
	)
	const rate = $derived(isNum(draft?.decayRate) ? draft.decayRate : 0)
	const rateAboveZero = $derived(rate > 0)
	const rateText = (n: number) => String(Number(n.toFixed(2)))

	const date = $derived({
		year: isNum(draft?.year) ? draft.year : 0,
		month: isNum(draft?.month) ? draft.month : null,
		day: isNum(draft?.day) ? draft.day : null
	})

	const fileable = $derived(
		typeof draft?.typeId !== "string" || isFileableEntryType(draft.typeId)
	)
	const words = $derived(
		entryZoneWords({
			timeline: timeline.value,
			lineWords,
			beganAt: hasYear ? formatDate(date) : null,
			decayRate: rate,
			held,
			keyCount: keyList(draft?.keys).length,
			fileable,
			parentName,
			pinned: !!draft?.constant,
			off: draft?.enabled === false
		})
	)

	const calendarHint = $derived.by(() => {
		const cal = openBookTime.calendar
		if (!cal || !hasYear) return null
		const problem = dateProblem(date, cal)
		return problem ? { problem } : { reads: formatDate(date, cal) }
	})

	function chooseBeginning(began: boolean) {
		chosen = { draft, beganAt: began }
		if (began) return
		draft.year = null
		draft.month = null
		draft.day = null
	}

	function setPart(key: "year" | "month" | "day", raw: string) {
		const n = raw === "" ? null : Number(raw)
		draft[key] = n !== null && Number.isFinite(n) ? n : null
	}

	function chooseDecay(toRateAboveZero: boolean) {
		if (toRateAboveZero) {
			if (!rateAboveZero) draft.decayRate = 0.25
		} else draft.decayRate = 0
	}

	$effect(() => {
		if (calendarHint?.problem) open = true
	})

	async function promote(field: ZoneField) {
		changeOpen = false
		onPromote?.(field)
		await tick()
		;(changeEl ?? toggleEl)?.focus()
	}

	const regionId = $derived(`${idPrefix}BeginningDecay`)
	const inputClass = "input preset-filled-surface-200-800 w-full rounded-lg"
</script>

<div class="flex flex-col gap-2 text-sm" data-lore-beginning-decay>
	<div class="flex flex-wrap items-center gap-x-3">
		<button
			bind:this={toggleEl}
			type="button"
			class="text-surface-700-300 flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold"
			aria-expanded={open}
			aria-controls={regionId}
			aria-label="The entry: {words}"
			title={words}
			onclick={() => (open = !open)}
		>
			{#if open}
				<Icons.ChevronDown size={14} aria-hidden="true" />
			{:else}
				<Icons.ChevronRight size={14} aria-hidden="true" />
			{/if}
			<span class="truncate" data-lore-beginning-decay-words>
				{words}
			</span>
		</button>
	</div>
	<div id={regionId} hidden={!open} class="flex flex-col gap-3">
		{#if open}
			<fieldset {disabled} class="flex min-w-0 flex-col gap-3">
				{#if timeline.value}
					<fieldset class="flex flex-col gap-2" data-lore-beginning>
						<legend class="text-sm font-semibold">Beginning</legend>
						<div class="flex gap-4">
							<label class="flex min-h-11 items-center gap-2">
								<input
									type="radio"
									name="{idPrefix}Beginning"
									value="perpetual"
									checked={!beganAt}
									onchange={() => chooseBeginning(false)}
								/>
								Perpetual
							</label>
							<label class="flex min-h-11 items-center gap-2">
								<input
									type="radio"
									name="{idPrefix}Beginning"
									value="beganAt"
									checked={beganAt}
									onchange={() => chooseBeginning(true)}
								/>
								Began at
							</label>
						</div>
						{#if beganAt}
							<div class="flex gap-2">
								<div class="flex flex-col gap-1">
									<label
										class="text-sm font-semibold"
										for="{idPrefix}BeginYear"
									>
										Year <span class="text-error-600-400">
											*
										</span>
									</label>
									<input
										id="{idPrefix}BeginYear"
										class={inputClass}
										type="number"
										required
										placeholder="2055"
										value={draft.year ?? ""}
										oninput={(e) =>
											setPart(
												"year",
												e.currentTarget.value
											)}
									/>
								</div>
								<div class="flex flex-col gap-1">
									<label
										class="text-sm font-semibold"
										for="{idPrefix}BeginMonth"
									>
										Month
									</label>
									<input
										id="{idPrefix}BeginMonth"
										class={inputClass}
										type="number"
										placeholder="3"
										value={draft.month ?? ""}
										oninput={(e) =>
											setPart(
												"month",
												e.currentTarget.value
											)}
									/>
								</div>
								<div class="flex flex-col gap-1">
									<label
										class="text-sm font-semibold"
										for="{idPrefix}BeginDay"
									>
										Day
									</label>
									<input
										id="{idPrefix}BeginDay"
										class={inputClass}
										type="number"
										placeholder="1"
										value={draft.day ?? ""}
										oninput={(e) =>
											setPart(
												"day",
												e.currentTarget.value
											)}
									/>
								</div>
							</div>
							{#if calendarHint}
								<p
									class="text-xs"
									aria-live="polite"
									data-lore-date-reads
								>
									{#if calendarHint.problem}
										<span class="text-error-600-400">
											{calendarHint.problem}
										</span>
									{:else}
										<span class="text-surface-700-300">
											Reads as
										</span>
										<span class="font-semibold">
											{calendarHint.reads}
										</span>
									{/if}
								</p>
							{/if}
						{/if}
						<p class="text-surface-700-300 text-xs">
							The entry is not read before this date.
						</p>
					</fieldset>
				{/if}
				<fieldset class="flex flex-col gap-2" data-lore-decay>
					<legend class="text-sm font-semibold">Decay</legend>
					<div class="flex gap-4">
						<label class="flex min-h-11 items-center gap-2">
							<input
								type="radio"
								name="{idPrefix}Decay"
								value="fact"
								checked={!rateAboveZero}
								onchange={() => chooseDecay(false)}
							/>
							Fact
						</label>
						<label class="flex min-h-11 items-center gap-2">
							<input
								type="radio"
								name="{idPrefix}Decay"
								value="living"
								checked={rateAboveZero}
								onchange={() => chooseDecay(true)}
							/>
							Living
						</label>
					</div>
					{#if rateAboveZero}
						<div class="flex items-center gap-2">
							<input
								class="min-h-11 flex-1"
								type="range"
								min="0"
								max="1"
								step="0.01"
								aria-label="Decay rate"
								value={rate}
								oninput={(e) =>
									(draft.decayRate = Number(
										e.currentTarget.value
									))}
							/>
							<span
								class="w-10 text-right tabular-nums"
								data-lore-decay-rate
							>
								{rateText(rate)}
							</span>
						</div>
					{/if}
					<p class="text-surface-700-300 text-xs">
						A pipeline can use this to rank the entry lower in
						recall; core does not.
					</p>
				</fieldset>

				{@render children?.()}
			</fieldset>
			{#if promotable.length > 0}
				<button
					bind:this={changeEl}
					type="button"
					class="text-surface-700-300 min-h-11 self-start text-left text-xs underline"
					aria-expanded={changeOpen}
					aria-controls="{idPrefix}ChangeFromVersion"
					onclick={() => (changeOpen = !changeOpen)}
				>
					{CHANGE_FROM_VERSION_LABEL}
				</button>
				{#if changeOpen}
					<div
						id="{idPrefix}ChangeFromVersion"
						role="group"
						aria-label="Change from this version"
						class="flex flex-wrap gap-2"
					>
						{#each promotable as item (item.field)}
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface min-h-11"
								aria-label="Change {item.name} from this version"
								data-lore-change-from-version={item.field}
								onclick={() => promote(item.field)}
							>
								{item.name}
							</button>
						{/each}
					</div>
				{/if}
			{/if}
			{#if (timeline.value && lineWords) || lineAction}
				<div
					class="flex flex-wrap items-center gap-x-3"
					data-lore-entry-line
				>
					{#if timeline.value && lineWords}
						<span class="text-surface-700-300">{lineWords}</span>
					{/if}
					{@render lineAction?.()}
				</div>
			{/if}
		{/if}
	</div>
</div>
