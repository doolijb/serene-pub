<script lang="ts">
	/**
	 * 🚧 Picks the date of a version: for a new one, or to move one.
	 * It picks a value and removes nothing, so it is a `dialog` in a `Portal`
	 * (STYLE-GUIDE §6.6), answered and never dismissed by a click outside.
	 *
	 * The calendar's reading and problems come from the open book's calendar;
	 * the bounds and a taken date are the caller's. A taken date merges (the
	 * confirm stays on and says so) or is refused (the confirm is off).
	 */
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { dateProblem } from "$lib/shared/lorebooks/storyDate"
	import { formatDate, type StoryDate } from "../sections/historyDates"
	import { openBookTime } from "./bookTime.svelte"
	import {
		TAKEN_REDATE_SENTENCE,
		TAKEN_SAVE_SENTENCE,
		versionDateProblem,
		type DateBounds
	} from "./entryVersions"

	interface Props {
		open: boolean
		title: string
		description: string
		/** Prefill, applied each time the dialog opens. */
		initial: StoryDate | null
		bounds: DateBounds
		/** The line's own version at a date, if one is there (only tested for a value). */
		taken: (date: StoryDate) => object | null
		takenMode: "merge" | "refuse"
		confirmLabel: string
		busy?: boolean
		onConfirm: (date: StoryDate) => void
		onCancel: () => void
	}

	let {
		open,
		title,
		description,
		initial,
		bounds,
		taken,
		takenMode,
		confirmLabel,
		busy = false,
		onConfirm,
		onCancel
	}: Props = $props()

	let year = $state("")
	let month = $state("")
	let day = $state("")

	$effect(() => {
		if (!open) return
		untrack(() => {
			year = initial ? String(initial.year) : ""
			month = initial?.month != null ? String(initial.month) : ""
			day = initial?.day != null ? String(initial.day) : ""
		})
	})

	const whole = (s: string) => /^-?\d+$/.test(s.trim())
	const yearOk = $derived(whole(year))
	const partsOk = $derived(
		(month.trim() === "" || whole(month)) &&
			(day.trim() === "" || month.trim() === "" || whole(day))
	)
	const date = $derived<StoryDate | null>(
		yearOk && partsOk
			? {
					year: Number(year),
					month: month.trim() === "" ? null : Number(month),
					day:
						month.trim() === "" || day.trim() === ""
							? null
							: Number(day)
				}
			: null
	)

	const calendarHint = $derived.by(() => {
		const cal = openBookTime.calendar
		if (!cal || !date) return null
		const problem = dateProblem(date, cal)
		return problem ? { problem } : { reads: formatDate(date, cal) }
	})
	const boundsProblem = $derived(
		date ? versionDateProblem(date, bounds) : null
	)
	const takenBy = $derived(date ? taken(date) : null)
	const refused = $derived(takenBy !== null && takenMode === "refuse")
	const canConfirm = $derived(
		date !== null &&
			!calendarHint?.problem &&
			!boundsProblem &&
			!refused &&
			!busy
	)

	function confirm() {
		if (canConfirm && date) onConfirm(date)
	}

	const uid = `versionDate${Math.random().toString(36).slice(2, 8)}`
	const inputClass =
		"input preset-filled-surface-200-800 min-h-11 w-full rounded-lg"
	const enter = (e: KeyboardEvent) => {
		if (e.key !== "Enter") return
		e.preventDefault()
		confirm()
	}
</script>

<Dialog
	{open}
	role="dialog"
	closeOnInteractOutside={false}
	onOpenChange={(e: OpenChangeDetails) => {
		if (!e.open) onCancel()
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
				data-testid="version-date-dialog"
			>
				<header class="flex items-start justify-between gap-2">
					<div class="space-y-1">
						<Dialog.Title class="h4">{title}</Dialog.Title>
						<Dialog.Description
							class="text-surface-700-300 text-sm"
						>
							{description}
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger
						class="btn-icon hover:preset-tonal min-h-11 min-w-11"
						aria-label="Close"
					>
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>
				<div class="flex gap-2">
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="{uid}Year">
							Year <span class="text-error-600-400">*</span>
						</label>
						<input
							id="{uid}Year"
							class={inputClass}
							type="number"
							required
							placeholder="2055"
							value={year}
							oninput={(e) => (year = e.currentTarget.value)}
							onkeydown={enter}
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="{uid}Month">
							Month
						</label>
						<input
							id="{uid}Month"
							class={inputClass}
							type="number"
							placeholder="3"
							value={month}
							oninput={(e) => (month = e.currentTarget.value)}
							onkeydown={enter}
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="{uid}Day">
							Day
						</label>
						<input
							id="{uid}Day"
							class={inputClass}
							type="number"
							placeholder="1"
							disabled={month.trim() === ""}
							title={month.trim() === ""
								? "A day needs a month: the calendar narrows left to right"
								: undefined}
							value={day}
							oninput={(e) => (day = e.currentTarget.value)}
							onkeydown={enter}
						/>
					</div>
				</div>
				<div class="flex flex-col gap-1 text-xs" aria-live="polite">
					{#if calendarHint}
						<p data-version-date-reads>
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
					{#if boundsProblem}
						<p class="text-error-600-400" data-version-date-problem>
							{boundsProblem}
						</p>
					{/if}
					{#if takenBy && date}
						<p
							class={refused
								? "text-error-600-400"
								: "text-surface-700-300"}
							data-version-date-taken
						>
							{refused
								? TAKEN_REDATE_SENTENCE(date)
								: TAKEN_SAVE_SENTENCE(date)}
						</p>
					{/if}
				</div>
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal min-h-11"
						onclick={onCancel}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500 min-h-11"
						disabled={!canConfirm}
						onclick={confirm}
					>
						{confirmLabel}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
