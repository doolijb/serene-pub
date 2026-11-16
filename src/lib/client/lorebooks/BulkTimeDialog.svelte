<script lang="ts">
	/**
	 * 🚧 Asks one **Beginning** or one **Decay** for several selected entries and
	 * hands it back. It sends nothing: the caller sends one `entries:update` per
	 * entry. The controls and copy are those of `time/BeginningDecayRow.svelte`.
	 */
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { dateProblem } from "$lib/shared/lorebooks/storyDate"
	import { formatDate } from "./sections/historyDates"
	import { openBookTime } from "./time/bookTime.svelte"

	interface Props {
		open: boolean
		mode: "beginning" | "decay"
		/** How many entries the value goes to (after the caller left out the ones it does not fit). */
		count: number
		onApply: (
			patch:
				| {
						year: number | null
						month: number | null
						day: number | null
				  }
				| { decayRate: number }
		) => void
		onClose: () => void
	}

	let { open, mode, count, onApply, onClose }: Props = $props()

	const uid = `bulkTime${Math.random().toString(36).slice(2, 8)}`
	const inputClass = "input preset-filled-surface-200-800 w-full rounded-lg"

	let beganAt = $state(false)
	let year = $state("")
	let month = $state("")
	let day = $state("")
	let rate = $state(0)

	$effect(() => {
		if (!open) return
		untrack(() => {
			beganAt = false
			year = ""
			month = ""
			day = ""
			rate = 0
		})
	})

	const noun = $derived(count === 1 ? "1 entry" : `${count} entries`)
	const rateAboveZero = $derived(rate > 0)
	const rateText = (n: number) => String(Number(n.toFixed(2)))

	const whole = (raw: string, min: number | null) => {
		if (raw.trim() === "") return false
		const n = Number(raw)
		return Number.isInteger(n) && (min === null || n >= min)
	}
	const yearOk = $derived(whole(year, null))

	const date = $derived({
		year: yearOk ? Number(year) : 0,
		month: whole(month, 1) ? Number(month) : null,
		day: whole(day, 1) ? Number(day) : null
	})

	const calendarHint = $derived.by(() => {
		const cal = openBookTime.calendar
		if (!cal || !yearOk) return null
		const problem = dateProblem(date, cal)
		return problem ? { problem } : { reads: formatDate(date, cal) }
	})

	const canApply = $derived.by(() => {
		if (mode === "decay") return true
		if (!beganAt) return true
		if (!yearOk) return false
		if (month.trim() !== "" && !whole(month, 1)) return false
		if (day.trim() !== "" && !whole(day, 1)) return false
		if (day.trim() !== "" && month.trim() === "") return false
		return !calendarHint?.problem
	})

	function apply() {
		if (!canApply) return
		if (mode === "decay") onApply({ decayRate: rate })
		else if (!beganAt) onApply({ year: null, month: null, day: null })
		else
			onApply({
				year: Number(year),
				month: month.trim() === "" ? null : Number(month),
				day: day.trim() === "" ? null : Number(day)
			})
		onClose()
	}
</script>

<Dialog
	{open}
	role="dialog"
	onOpenChange={(e: { open: boolean }) => {
		if (!e.open) onClose()
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
				data-testid="bulk-time-dialog"
			>
				<header class="flex items-start justify-between gap-2">
					<div class="space-y-1">
						<Dialog.Title class="h4">
							{mode === "beginning" ? "Beginning" : "Decay"} for {noun}
						</Dialog.Title>
						<Dialog.Description
							class="text-surface-700-300 text-sm"
						>
							{#if mode === "beginning"}
								Sets when each entry starts being read. Their
								other fields stay as they are.
							{:else}
								Sets the Decay stored on each entry. Their other
								fields stay as they are.
							{/if}
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger
						class="btn-icon hover:preset-tonal min-h-11 min-w-11"
						aria-label="Close"
					>
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>
				<div class="flex flex-col gap-3 text-sm">
					{#if mode === "beginning"}
						<fieldset
							class="flex flex-col gap-2"
							data-lore-beginning
						>
							<legend class="text-sm font-semibold">
								Beginning
							</legend>
							<div class="flex gap-4">
								<label class="flex min-h-11 items-center gap-2">
									<input
										type="radio"
										name="{uid}Beginning"
										value="perpetual"
										checked={!beganAt}
										onchange={() => (beganAt = false)}
									/>
									Perpetual
								</label>
								<label class="flex min-h-11 items-center gap-2">
									<input
										type="radio"
										name="{uid}Beginning"
										value="beganAt"
										checked={beganAt}
										onchange={() => (beganAt = true)}
									/>
									Began at
								</label>
							</div>
							{#if beganAt}
								<div class="flex gap-2">
									<div class="flex flex-col gap-1">
										<label
											class="text-sm font-semibold"
											for="{uid}BeginYear"
										>
											Year <span
												class="text-error-600-400"
											>
												*
											</span>
										</label>
										<input
											id="{uid}BeginYear"
											class="{inputClass} min-h-11"
											type="number"
											required
											placeholder="2055"
											value={year}
											oninput={(e) =>
												(year = e.currentTarget.value)}
										/>
									</div>
									<div class="flex flex-col gap-1">
										<label
											class="text-sm font-semibold"
											for="{uid}BeginMonth"
										>
											Month
										</label>
										<input
											id="{uid}BeginMonth"
											class="{inputClass} min-h-11"
											type="number"
											placeholder="3"
											value={month}
											oninput={(e) =>
												(month = e.currentTarget.value)}
										/>
									</div>
									<div class="flex flex-col gap-1">
										<label
											class="text-sm font-semibold"
											for="{uid}BeginDay"
										>
											Day
										</label>
										<input
											id="{uid}BeginDay"
											class="{inputClass} min-h-11"
											type="number"
											placeholder="1"
											value={day}
											oninput={(e) =>
												(day = e.currentTarget.value)}
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
					{:else}
						<fieldset class="flex flex-col gap-2" data-lore-decay>
							<legend class="text-sm font-semibold">Decay</legend>
							<div class="flex gap-4">
								<label class="flex min-h-11 items-center gap-2">
									<input
										type="radio"
										name="{uid}Decay"
										value="fact"
										checked={!rateAboveZero}
										onchange={() => (rate = 0)}
									/>
									Fact
								</label>
								<label class="flex min-h-11 items-center gap-2">
									<input
										type="radio"
										name="{uid}Decay"
										value="living"
										checked={rateAboveZero}
										onchange={() => {
											if (!rateAboveZero) rate = 0.25
										}}
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
											(rate = Number(
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
								A pipeline can use this to rank the entry lower in recall; core does not.
							</p>
						</fieldset>
					{/if}
				</div>
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal min-h-11"
						onclick={onClose}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500 min-h-11"
						disabled={!canApply}
						onclick={apply}
					>
						Apply to {noun}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
