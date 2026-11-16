<script lang="ts" generics="V extends RailVersion, E extends RailElsewhere">
	/**
	 * 🚧 An entry's versions over story time: a vertical rail beside the
	 * fields, folding to a strip above them when the component's own box is
	 * narrow (STYLE-GUIDE §5.3: a named container, never the viewport).
	 *
	 * ⚠ The fields (`children`) render exactly once, in the right column: a
	 * second mount would duplicate inputs and ids. The rail and the strip are
	 * both in the DOM; the one that does not fit is `display: none`.
	 *
	 * The rail draws any subject's versions (`RailVersion`). It reports what was
	 * chosen (`onSelect`, `onAdd`, `onOpenOnLine`) and asks the page to write
	 * the two things it offers: a version's date (`onRedate`) and its deletion
	 * (`onDelete`). A refused write is toasted by the shell; only a reply that
	 * never came is said here.
	 */
	import * as Icons from "@lucide/svelte"
	import type { Snippet } from "svelte"
	import { tick } from "svelte"
	import { isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { isOnLine } from "$lib/shared/lorebooks/lineReading"
	import { formatDate, type StoryDate } from "../sections/historyDates"
	import { openBookTime } from "./bookTime.svelte"
	import {
		versionDateBounds,
		addVersionBounds,
		changesWords,
		takenVersion,
		type RailElsewhere,
		type RailVersion
	} from "./entryVersions"
	import VersionDateDialog from "./VersionDateDialog.svelte"

	interface Props {
		versions: V[]
		/** Changes on lines the reading does not read. */
		elsewhere: E[]
		selectedKey: string
		lineBranchId: number | null
		readOnly: boolean
		lineName: (branchId: number | null) => string
		onSelect: (v: V) => void
		/** After the add dialog confirmed a date. */
		onAdd: (date: StoryDate) => void
		onOpenOnLine: (branchId: number | null, date: StoryDate | null) => void
		onRedated?: (v: V, date: StoryDate) => void
		onDeleted?: (v: V) => void
		/** Writes a version's (or an Elsewhere row's) new date; a rejection leaves the dialog as it is. */
		onRedate: (
			target: { version: V } | { row: E },
			date: StoryDate
		) => Promise<unknown>
		/** Deletes a version (all it is stored as) or an Elsewhere row. */
		onDelete: (target: { version: V } | { row: E }) => Promise<unknown>
		/** Captions a set of field keys; the default is the entry's words. */
		describe?: (keys: string[]) => string
		/** 🚧 The delete question; `line` is null for a version on the rail, the line's name for an Elsewhere row. */
		deleteSentence?: (when: string, line: string | null) => string
		/** The line's own version at a date, ignoring `moving`; the default is the entry rule. */
		takenAt?: (date: StoryDate, moving: V | null) => V | null
		/** When set, every add button is off and says why. */
		addBlocked?: string | null
		/** A version's edit-history rows, by the dated changes it is stored as (null is the entry itself). */
		edits?: Snippet<[readonly (number | null)[]]>
		/** The selected version's fields. */
		children: Snippet
	}

	let {
		versions,
		elsewhere,
		selectedKey,
		lineBranchId,
		readOnly,
		lineName,
		onSelect,
		onAdd,
		onOpenOnLine,
		onRedated,
		onDeleted,
		onRedate,
		onDelete,
		describe = changesWords,
		deleteSentence = defaultDeleteSentence,
		takenAt = (date, moving) => {
			const t = takenVersion(versions, date, lineBranchId)
			return t && t.key !== moving?.key ? t : null
		},
		addBlocked = null,
		edits,
		children
	}: Props = $props()

	// 🚧 The two sentences the rail asks before a delete.
	function defaultDeleteSentence(when: string, line: string | null): string {
		return `Delete the version dated ${when}${line === null ? "" : ` on ${line}`}? From then on the entry reads as the version before it, and this version's edit history goes with it.`
	}

	// Remembered per browser; storage may be missing or throw.
	const EDITS_KEY = "serene.lore.versionEdits"
	let showEdits = $state(true)
	try {
		showEdits = localStorage.getItem(EDITS_KEY) !== "off"
	} catch {
		// the page works without storage
	}
	function toggleEdits() {
		showEdits = !showEdits
		try {
			if (showEdits) localStorage.removeItem(EDITS_KEY)
			else localStorage.setItem(EDITS_KEY, "off")
		} catch {
			// the page works without storage
		}
	}

	const selected = $derived(
		versions.find((v) => v.key === selectedKey) ?? versions[0]
	)
	const line = $derived(openBookTime.lineOf(lineBranchId))

	const rowDate = (r: E): StoryDate => ({
		year: r.year,
		month: r.month ?? null,
		day: r.day ?? null
	})

	/** A version's name on the rail. */
	function words(v: V): string {
		if (v.kind === "beginning")
			return v.date
				? `Began at ${formatDate(v.date)}`
				: "From the beginning"
		return formatDate(v.date!)
	}

	function whereRow(r: E): string {
		const name = lineName(r.branchId ?? null)
		return isOnLine(r, line) ? `on ${name}, after the fork` : `on ${name}`
	}

	type Ask =
		| { kind: "add"; after: V }
		| { kind: "redate"; version: V }
		| { kind: "redateRow"; row: E }
	let ask = $state.raw<Ask | null>(null)
	let busy = $state(false)
	let timedOut = $state(false)
	let confirmingKey = $state<string | null>(null)
	let confirmingRow = $state<number | null>(null)
	let root: HTMLElement | undefined = $state()

	const dialog = $derived.by(() => {
		const a = ask
		if (!a)
			return {
				title: "",
				description: "",
				initial: null as StoryDate | null,
				bounds: versionDateBounds(versions),
				taken: (_d: StoryDate): V | null => null,
				takenMode: "merge" as "merge" | "refuse",
				confirmLabel: ""
			}
		if (a.kind === "add")
			return {
				title: "Add a version",
				description:
					"The new version starts as the one before it; change what differs, then save.",
				initial: null,
				bounds: addVersionBounds(versions, a.after),
				taken: (d: StoryDate) => takenAt(d, null),
				takenMode: "merge" as const,
				confirmLabel: "Add"
			}
		const moving = a.kind === "redate" ? a.version : null
		return {
			title: "Change its date",
			description: "The version moves; what it says stays the same.",
			initial: a.kind === "redate" ? a.version.date : rowDate(a.row),
			bounds: versionDateBounds(versions),
			taken:
				a.kind === "redate"
					? (d: StoryDate) => takenAt(d, moving)
					: (_d: StoryDate) => null,
			takenMode: "refuse" as const,
			confirmLabel: "Move"
		}
	})

	async function confirmDate(date: StoryDate) {
		const a = ask
		if (!a) return
		if (a.kind === "add") {
			ask = null
			onAdd(date)
			return
		}
		busy = true
		timedOut = false
		try {
			await onRedate(
				a.kind === "redate" ? { version: a.version } : { row: a.row },
				date
			)
			ask = null
			if (a.kind === "redate") onRedated?.(a.version, date)
		} catch (err) {
			if (isReplyTimeout(err)) {
				timedOut = true
				ask = null
			}
		} finally {
			busy = false
		}
	}

	async function remove(
		target: { version: V } | { row: E }
	): Promise<boolean> {
		busy = true
		timedOut = false
		try {
			await onDelete(target)
			return true
		} catch (err) {
			if (isReplyTimeout(err)) timedOut = true
			return false
		} finally {
			busy = false
		}
	}

	async function removeVersion(v: V) {
		const before =
			versions[
				Math.max(0, versions.findIndex((x) => x.key === v.key) - 1)
			]
		if (!(await remove({ version: v }))) return
		confirmingKey = null
		onDeleted?.(v)
		await tick()
		focusVersion(before.key)
	}

	async function removeElsewhere(r: E) {
		if (!(await remove({ row: r }))) return
		confirmingRow = null
	}

	/** Focus the rail button of a version, in whichever layout is shown. */
	function focusVersion(key: string) {
		const all = [
			...(root?.querySelectorAll<HTMLElement>(
				`[data-version-key="${key}"]`
			) ?? [])
		]
		const shown = all.find((el) => el.getClientRects().length > 0) ?? all[0]
		shown?.focus()
	}

	const addLabel = (a: V, b: V | undefined) =>
		b
			? `Add a version between ${words(a)} and ${words(b)}`
			: `Add a version after ${words(a)}`

	const quiet =
		"hover:preset-tonal-surface text-primary-700-300 min-h-11 rounded-md px-2 text-left text-xs font-semibold pointer-coarse:min-h-11"
</script>

{#snippet addButton(a: V, b: V | undefined)}
	<button
		type="button"
		class={quiet}
		aria-label={addLabel(a, b)}
		disabled={addBlocked !== null}
		title={addBlocked ?? undefined}
		onclick={() => (ask = { kind: "add", after: a })}
	>
		+ Add a version here
	</button>
{/snippet}

{#snippet headNotes(v: V)}
	{#if v.chip}
		<span class="text-surface-700-300 block text-xs font-normal">
			{v.chip}
		</span>
	{/if}
	{#if v.readHere}
		<!-- 🚧 -->
		<span class="text-surface-700-300 block text-xs font-normal">
			read at this date
		</span>
	{/if}
{/snippet}

{#snippet elsewhereRows()}
	<ul class="flex flex-col gap-2">
		{#each elsewhere as r (r.id)}
			{@const name = lineName(r.branchId ?? null)}
			<li
				class="bg-surface-100-900 rounded-base flex flex-col gap-1 px-2 py-1.5 text-xs"
				data-version-elsewhere={r.id}
			>
				<span class="font-semibold">{formatDate(rowDate(r))}</span>
				{#if r.chip}
					<span
						class="text-surface-700-300 block text-xs font-normal"
					>
						{r.chip}
					</span>
				{/if}
				<span class="text-surface-700-300">
					{describe(Object.keys(r.fields))}
				</span>
				<span class="text-surface-700-300">{whereRow(r)}</span>
				{#if confirmingRow === r.id}
					<span class="text-surface-700-300">
						{deleteSentence(formatDate(rowDate(r)), name)}
					</span>
					<div class="flex gap-2">
						<button
							type="button"
							class="btn btn-sm preset-tonal-error"
							disabled={busy}
							onclick={() => removeElsewhere(r)}
						>
							Delete
						</button>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface"
							onclick={() => (confirmingRow = null)}
						>
							Cancel
						</button>
					</div>
				{:else}
					<div class="flex flex-wrap gap-x-2">
						{#if !readOnly && !r.locked}
							<button
								type="button"
								class={quiet}
								onclick={() =>
									(ask = { kind: "redateRow", row: r })}
							>
								Change its date
							</button>
						{/if}
						<!-- A locked version is not edited or moved here; it can still be deleted. -->
						{#if !readOnly}
							<button
								type="button"
								class={quiet}
								onclick={() => (confirmingRow = r.id)}
							>
								Delete
							</button>
						{/if}
						<button
							type="button"
							class={quiet}
							onclick={() =>
								onOpenOnLine(r.branchId ?? null, rowDate(r))}
						>
							Open on {name}
						</button>
					</div>
				{/if}
				{#if edits && showEdits}
					{@render edits?.([r.id])}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="@container/versions" bind:this={root} data-version-rail-root>
	<div
		class="grid grid-cols-1 gap-3 @min-[36rem]/versions:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)]"
	>
		<div
			class="hidden flex-col gap-4 @min-[36rem]/versions:flex"
			data-version-rail-column
		>
			{#if edits}<div class="flex items-center justify-between gap-2">
					<h5 class="text-surface-700-300 text-xs font-semibold">
						Versions
					</h5>
					<button
						type="button"
						class="btn btn-sm {showEdits
							? 'preset-pressed'
							: 'preset-tonal-surface'}"
						aria-pressed={showEdits}
						title="Show the edit history under each version"
						data-version-edits-toggle
						onclick={toggleEdits}
					>
						Edits
					</button>
				</div>{/if}
			<nav aria-label="Versions" data-version-rail>
				<ol class="flex flex-col">
					{#each versions as v, i (v.key)}
						{@const next = versions[i + 1]}
						<li class="flex flex-col">
							<div class="flex flex-col items-start">
								<button
									type="button"
									class="hover:preset-tonal-surface min-h-11 w-full rounded-md px-2 py-1.5 text-left text-sm {v.key ===
									selected.key
										? 'preset-pressed font-semibold'
										: ''}"
									aria-current={v.key === selected.key
										? "true"
										: undefined}
									data-version-key={v.key}
									onclick={() => onSelect(v)}
								>
									<span class="block">{words(v)}</span>
									{#if v.chip}
										<span
											class="text-surface-700-300 block text-xs font-normal"
										>
											{v.chip}
										</span>
									{/if}
									{#if v.readHere}
										<!-- 🚧 -->
										<span
											class="text-surface-700-300 block text-xs font-normal"
										>
											read at this date
										</span>
									{/if}
									{#if v.kind === "dated"}
										<span
											class="text-surface-700-300 block text-xs font-normal"
										>
											{describe(v.changes)}
										</span>
									{/if}
									{#if !v.own}
										<span
											class="text-surface-700-300 block text-xs font-normal"
										>
											from {lineName(v.branchId)}
										</span>
									{/if}
								</button>
								{#if !v.own}
									<button
										type="button"
										class={quiet}
										onclick={() =>
											onOpenOnLine(v.branchId, v.date)}
									>
										Open on {lineName(v.branchId)}
									</button>
								{/if}
							</div>
							{#if edits && showEdits}<div
									class="pl-2"
									data-version-edits={v.key}
								>
									{@render edits?.(v.editIds)}
								</div>{/if}
							{#if !readOnly}
								<div class="pl-2">
									{@render addButton(v, next)}
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</nav>
			{#if elsewhere.length}
				<section
					class="flex flex-col gap-2"
					data-version-elsewhere-group
				>
					<h5 class="text-surface-700-300 text-xs font-semibold">
						Elsewhere
					</h5>
					{@render elsewhereRows()}
				</section>
			{/if}
		</div>

		<div class="flex min-w-0 flex-col gap-3">
			<div
				class="flex items-center gap-1 overflow-x-auto @min-[36rem]/versions:hidden"
				data-version-strip
			>
				{#each versions as v, i (v.key)}
					<button
						type="button"
						class="chip min-h-11 shrink-0 whitespace-nowrap {v.key ===
						selected.key
							? 'preset-pressed'
							: 'preset-tonal-surface'}"
						aria-current={v.key === selected.key
							? "true"
							: undefined}
						data-version-key={v.key}
						onclick={() => onSelect(v)}
					>
						{words(v)}{v.chip ? ` · ${v.chip}` : ""}
					</button>
					{#if !readOnly}
						<button
							type="button"
							class="chip preset-tonal-surface min-h-11 min-w-11 shrink-0"
							aria-label={addLabel(v, versions[i + 1])}
							disabled={addBlocked !== null}
							title={addBlocked ?? undefined}
							onclick={() => (ask = { kind: "add", after: v })}
						>
							+
						</button>
					{/if}
				{/each}
			</div>

			<div
				class="flex flex-col gap-2 text-sm"
				data-version-head
				data-version-head-key={selected.key}
			>
				{#if selected.kind === "beginning"}
					<div class="flex flex-wrap items-center gap-x-3">
						<span class="font-semibold">{words(selected)}</span>
						{@render headNotes(selected)}
						{#if !selected.own}
							<span class="text-surface-700-300 text-xs">
								from {lineName(selected.branchId)}
							</span>
							<button
								type="button"
								class={quiet}
								onclick={() =>
									onOpenOnLine(
										selected.branchId,
										selected.date
									)}
							>
								Open on {lineName(selected.branchId)}
							</button>
						{/if}
					</div>
				{:else if selected.own}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span class="font-semibold">
							This version begins {formatDate(selected.date!)}
						</span>
						<span class="text-surface-700-300 text-xs">
							{describe(selected.changes)}
						</span>
						{@render headNotes(selected)}
					</div>
					<!-- A locked version is not edited or moved here; it can still be deleted. -->
					{#if !readOnly}
						{#if confirmingKey === selected.key}
							<p class="text-surface-700-300 text-xs">
								{deleteSentence(
									formatDate(selected.date!),
									null
								)}
							</p>
							<div class="flex gap-2">
								<button
									type="button"
									class="btn btn-sm preset-tonal-error"
									disabled={busy}
									onclick={() => removeVersion(selected)}
								>
									Delete
								</button>
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface"
									onclick={() => (confirmingKey = null)}
								>
									Cancel
								</button>
							</div>
						{:else}
							<div class="flex flex-wrap gap-2">
								{#if selected.movable && !selected.locked}
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface min-h-11"
										onclick={() =>
											(ask = {
												kind: "redate",
												version: selected
											})}
									>
										Change its date
									</button>
								{/if}
								<button
									type="button"
									class="btn btn-sm preset-tonal-error min-h-11"
									onclick={() =>
										(confirmingKey = selected.key)}
								>
									Delete this version
								</button>
							</div>
							{#if !selected.movable && !selected.locked}
								<p class="text-surface-700-300 text-xs">
									Saved more than once at this date, so it
									can't be moved; delete it and add it again
									to move it.
								</p>
							{/if}
						{/if}
					{/if}
				{:else}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span class="font-semibold">
							{lineName(selected.branchId)}'s version from {formatDate(
								selected.date!
							)}
						</span>
						<span class="text-surface-700-300 text-xs">
							{describe(selected.changes)}
						</span>
						{@render headNotes(selected)}
						<button
							type="button"
							class={quiet}
							onclick={() =>
								onOpenOnLine(selected.branchId, selected.date)}
						>
							Open on {lineName(selected.branchId)}
						</button>
					</div>
				{/if}
				{#if timedOut}
					<p class="text-error-600-400 text-xs" role="status">
						The server did not answer in time.
					</p>
				{/if}
			</div>

			{@render children()}

			{#if elsewhere.length}
				<details
					class="@min-[36rem]/versions:hidden"
					data-version-elsewhere-narrow
				>
					<summary
						class="text-surface-700-300 min-h-11 text-xs font-semibold"
					>
						Elsewhere · {elsewhere.length}
					</summary>
					{@render elsewhereRows()}
				</details>
			{/if}
		</div>
	</div>
</div>

<!-- A reader adds and re-dates nothing: no dialog, open or closed. -->
{#if !readOnly}
<VersionDateDialog
	open={ask !== null}
	title={dialog.title}
	description={dialog.description}
	initial={dialog.initial}
	bounds={dialog.bounds}
	taken={dialog.taken}
	takenMode={dialog.takenMode}
	confirmLabel={dialog.confirmLabel}
	{busy}
	onConfirm={confirmDate}
	onCancel={() => (ask = null)}
/>
{/if}
