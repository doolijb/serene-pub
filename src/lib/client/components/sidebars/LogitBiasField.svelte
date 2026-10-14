<script lang="ts">
	/**
	 * The logit bias field: a sampling config's `logitBias` list, one row per
	 * logit bias entry, each with its text, its bias and the controls that
	 * move or remove it.
	 *
	 * Every row is read by the shared syntax reader (`readLogitBiasText`), the
	 * one the server resolves rows with, so the note beside a row is the reason
	 * the server skips it. Rows are stored exactly as typed: an empty or
	 * invalid row stays in the list, with what is wrong said beside it, until
	 * someone edits or removes it.
	 *
	 * The bound value is always written as a fresh `LogitBiasEntry[]`. An unset
	 * value shows the declaration's default and is written only on the first
	 * edit, so opening a config never makes it look changed.
	 */

	import * as Icons from "@lucide/svelte"
	import { tick } from "svelte"
	import {
		LOGIT_BIAS_MAX,
		LOGIT_BIAS_MIN,
		parseSillyTavernLogitBias,
		readLogitBiasText,
		readLogitBiasValue,
		type LogitBiasEntry
	} from "$lib/shared/utils/logitBias"

	interface Props {
		/** The stored `logitBias` value. Bound: every edit assigns a new list. */
		value: unknown
		/** What an unset value reads as: the field declaration's `default`. */
		declaredDefault?: unknown
		/** The id of the element that names the field (the form's label). */
		labelledby?: string
		/** Immutable configs: the rows are readable and nothing is editable. */
		disabled?: boolean
	}

	let {
		value = $bindable(),
		declaredDefault = [],
		labelledby,
		disabled = false
	}: Props = $props()

	const uid = $props.id()

	/** The rows, or `null` when the stored value cannot be read as a list. */
	const entries = $derived(readLogitBiasValue(value ?? declaredDefault))

	/** The import's outcome, said inline. Components never toast. */
	let importStatus: { tone: "done" | "error"; text: string } | null =
		$state(null)
	/** Set by the import's own write, so the effect below keeps its report. */
	let keepStatus = false
	$effect(() => {
		void entries
		if (keepStatus) keepStatus = false
		else importStatus = null
	})

	let fileInput: HTMLInputElement | undefined = $state()

	function write(next: LogitBiasEntry[]) {
		value = next
	}

	function patchRow(i: number, patch: Partial<LogitBiasEntry>) {
		if (!entries) return
		write(entries.map((e, j) => (j === i ? { ...e, ...patch } : { ...e })))
	}

	const clampBias = (n: number) =>
		Math.min(LOGIT_BIAS_MAX, Math.max(LOGIT_BIAS_MIN, n))

	/**
	 * A bias is written once it is a number. Blank or half-typed (`-`) writes
	 * nothing; out of range is clamped in the input itself, so what shows is
	 * what is stored.
	 */
	function onBiasInput(i: number, input: HTMLInputElement) {
		const raw = input.value.trim()
		if (!raw) return
		const typed = Number(raw)
		if (!Number.isFinite(typed)) return
		const bias = clampBias(typed)
		if (bias !== typed) input.value = String(bias)
		patchRow(i, { value: bias })
	}

	/** Left blank: the input shows the stored bias again. */
	function onBiasChange(i: number, input: HTMLInputElement) {
		if (!input.value.trim() && entries?.[i])
			input.value = String(entries[i].value)
	}

	const focusById = async (id: string) => {
		await tick()
		document.getElementById(id)?.focus()
	}

	function addRow() {
		if (!entries) return
		const at = entries.length
		write([...entries.map((e) => ({ ...e })), { text: "", value: 0 }])
		void focusById(`${uid}-text-${at}`)
	}

	function removeRow(i: number) {
		if (!entries) return
		const rest = entries.filter((_, j) => j !== i).map((e) => ({ ...e }))
		write(rest)
		void focusById(
			rest.length
				? `${uid}-remove-${Math.min(i, rest.length - 1)}`
				: `${uid}-add`
		)
	}

	function moveRow(i: number, by: -1 | 1) {
		if (!entries) return
		const j = i + by
		if (j < 0 || j >= entries.length) return
		const next = entries.map((e) => ({ ...e }))
		;[next[i], next[j]] = [next[j], next[i]]
		write(next)
		// Focus follows the row; at an end its arrow is disabled, so the other.
		const atEnd = by < 0 ? j === 0 : j === next.length - 1
		const arrow = by < 0 ? "up" : "down"
		const other = by < 0 ? "down" : "up"
		void focusById(`${uid}-${atEnd ? other : arrow}-${j}`)
	}

	async function importFile(input: HTMLInputElement) {
		const file = input.files?.[0]
		input.value = ""
		if (!file) return
		let text: string
		try {
			text = await file.text()
		} catch {
			importStatus = {
				tone: "error",
				text: "This file couldn't be read. Choose it again, or choose another."
			}
			return
		}
		const read = parseSillyTavernLogitBias(text)
		if ("error" in read) {
			importStatus = { tone: "error", text: read.error }
			return
		}
		// Read again: the list may have changed while the file was read.
		const current = readLogitBiasValue(value ?? declaredDefault)
		if (!current) return
		const n = read.entries.length
		keepStatus = true
		write([...current, ...read.entries.map((e) => ({ ...e }))])
		importStatus = {
			tone: "done",
			text:
				`Added ${n} logit bias ${n === 1 ? "entry" : "entries"}` +
				(read.biasPresetName === undefined
					? "."
					: ` from SillyTavern's bias preset “${read.biasPresetName}”.`)
		}
	}

	/** How a row is named on its controls: its text, or that it is blank. */
	const rowName = (entry: LogitBiasEntry) =>
		entry.text.trim() ? `“${entry.text.trim()}”` : "the blank row"

	/** The note beside a row: why it is skipped, or nothing. */
	function rowNote(
		entry: LogitBiasEntry
	): { tone: "error" | "muted"; text: string } | null {
		const reading = readLogitBiasText(entry.text)
		if (reading.kind === "invalid")
			return { tone: "error", text: reading.reason }
		if (reading.kind === "empty")
			return { tone: "muted", text: "Ignored until it has text." }
		return null
	}

	const iconButton =
		"btn-icon btn-icon-sm hover:preset-tonal-surface pointer-coarse:size-11 size-7 min-w-0 shrink-0 p-0 disabled:opacity-30"
</script>

<div
	class="@container/logit-bias flex flex-col gap-2"
	role="group"
	aria-labelledby={labelledby}
>
	{#if !entries}
		<div class="flex flex-wrap items-center gap-2">
			<p class="text-error-600-400 min-w-0 flex-1 text-xs">
				This logit bias list can't be read, so it isn't sent.
				{#if !disabled}Clear it to start a new list.{/if}
			</p>
			{#if !disabled}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
					onclick={() => write([])}
				>
					Clear
				</button>
			{/if}
		</div>
	{:else}
		<p class="text-surface-600-400 text-xs">
			A plain word is read with a space before it, as it appears
			mid-sentence; <code>{"{exact text}"}</code>
			as written;
			<code>[1, 2]</code>
			as token ids.
		</p>

		{#if entries.length}
			<ul class="flex flex-col gap-1">
				{#each entries as entry, i}
					{@const note = rowNote(entry)}
					{@const noteId = `${uid}-note-${i}`}
					<li class="flex flex-col gap-0.5">
						<div
							class="flex items-center gap-1 @min-[28rem]/logit-bias:gap-2"
						>
							<input
								id="{uid}-text-{i}"
								type="text"
								class="input min-w-0 flex-1 px-2 py-1 font-mono text-sm"
								aria-label="Text to bias"
								placeholder="word, {'{exact}'} or [ids]"
								aria-invalid={note?.tone === "error"
									? "true"
									: undefined}
								aria-describedby={note ? noteId : undefined}
								{disabled}
								value={entry.text}
								oninput={(e) =>
									patchRow(i, {
										text: e.currentTarget.value
									})}
							/>
							<input
								id="{uid}-bias-{i}"
								type="number"
								class="input w-18 shrink-0 px-2 py-1 text-right text-sm tabular-nums @min-[28rem]/logit-bias:w-20"
								aria-label="Bias for {rowName(entry)}"
								min={LOGIT_BIAS_MIN}
								max={LOGIT_BIAS_MAX}
								step="any"
								{disabled}
								value={entry.value}
								oninput={(e) => onBiasInput(i, e.currentTarget)}
								onchange={(e) =>
									onBiasChange(i, e.currentTarget)}
							/>
							{#if !disabled}
								<button
									id="{uid}-up-{i}"
									type="button"
									class={iconButton}
									aria-label="Move {rowName(entry)} up"
									disabled={i === 0}
									onclick={() => moveRow(i, -1)}
								>
									<Icons.ChevronUp
										size={14}
										aria-hidden="true"
									/>
								</button>
								<button
									id="{uid}-down-{i}"
									type="button"
									class={iconButton}
									aria-label="Move {rowName(entry)} down"
									disabled={i === entries.length - 1}
									onclick={() => moveRow(i, 1)}
								>
									<Icons.ChevronDown
										size={14}
										aria-hidden="true"
									/>
								</button>
								<button
									id="{uid}-remove-{i}"
									type="button"
									class="{iconButton} text-surface-600-400 hover:text-error-600-400"
									aria-label="Remove {rowName(entry)}"
									onclick={() => removeRow(i)}
								>
									<Icons.X size={14} aria-hidden="true" />
								</button>
							{/if}
						</div>
						{#if note}
							<p
								id={noteId}
								class="px-2 text-xs {note.tone === 'error'
									? 'text-error-600-400'
									: 'text-surface-600-400'}"
							>
								{note.text}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if !disabled}
			<div class="flex flex-col">
				<div class="flex flex-wrap items-center gap-2">
					<button
						id="{uid}-add"
						type="button"
						class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
						onclick={addRow}
					>
						<Icons.Plus size={14} aria-hidden="true" />
						Add
					</button>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
						onclick={() => fileInput?.click()}
					>
						<Icons.Upload size={14} aria-hidden="true" />
						Import SillyTavern list
					</button>
					<input
						bind:this={fileInput}
						type="file"
						accept=".json,application/json"
						class="hidden"
						onchange={(e) => importFile(e.currentTarget)}
					/>
				</div>
				<!-- Always present, so the outcome is announced when it lands;
				     empty, it takes no room. -->
				<p class="text-xs" role="status">
					{#if importStatus}
						<span
							class="mt-1 block {importStatus.tone === 'error'
								? 'text-error-600-400'
								: 'text-surface-600-400'}"
						>
							{importStatus.text}
						</span>
					{/if}
				</p>
			</div>
		{/if}
	{/if}
</div>
