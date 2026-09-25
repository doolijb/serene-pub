<script lang="ts">
	/**
	 * Lore entries (PLAN-sdk-1.0 §3.9, R58): the session's lorebook entry by
	 * entry, with what this session's rankings made of each, and the two
	 * marks — **Off** and **Pin** — through `entries:setMarks`, which never
	 * forces a re-embed. One server read (`entries:sessionEntries`) does the
	 * search, sort, filter and paging.
	 *
	 * The book's owner and admins see it; anyone else is told whose it is,
	 * because a widget declaration has no visibility field of its own.
	 */
	import * as Icons from "@lucide/svelte"
	import { useWidgetContext } from "$lib/shared/widgets/context"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		sessionId: number | null
		session?: unknown
		channels: string[]
	}
	let { sessionId }: Props = $props()

	type Sort = NonNullable<Sockets.Entries.SessionEntries.Params["sort"]>
	type Filter = NonNullable<Sockets.Entries.SessionEntries.Params["filter"]>
	type Row = Sockets.Entries.SessionEntries.Row

	const socket = useTypedSocket()
	const widget = useWidgetContext()
	const settings = $derived(
		(widget?.current?.settings?.v1 ?? {}) as Record<string, unknown>
	)
	const pageSize = $derived(
		typeof settings.pageSize === "number" ? settings.pageSize : 25
	)

	let query = $state("")
	let sort = $state<Sort | null>(null)
	const effectiveSort = $derived<Sort>(
		sort ?? ((settings.sort as Sort | undefined) ?? "lastRead")
	)
	let filter = $state<Filter>("all")
	let offset = $state(0)

	let answer = $state<Sockets.Entries.SessionEntries.Response | null>(null)

	// The answer comes back on a user-wide event, so a second panel, another
	// tab, or a reply that lost a race would otherwise overwrite this view:
	// every ask carries a token, and only the newest ask's answer is taken.
	const panelKey = Math.random().toString(36).slice(2)
	let asked = 0
	let latest = ""
	const nextRequest = () => (latest = `${panelKey}:${++asked}`)

	const onEntries = (res: Sockets.Entries.SessionEntries.Response) => {
		if (res.sessionId !== sessionId || res.request !== latest) return
		answer = res
		// The server pulls a page that ran past the end back to the last one.
		if (typeof res.offset === "number" && res.offset !== offset) offset = res.offset
	}
	const onMarks = (res: Sockets.Entries.SetMarks.Response) => {
		if (!answer?.rows.some((r) => r.id === res.entryId)) return
		if (res.error) toaster.error({ title: "Not changed", description: res.error })
		refresh()
	}
	useInterest<"entries:setMarks">("entries:setMarks", onMarks)
	useInterest<"entries:setMarks:error">("entries:setMarks:error", onMarks)

	// The search asks once typing pauses, not once per keystroke.
	let searched = $state("")
	$effect(() => {
		const q = query.trim()
		const t = setTimeout(() => (searched = q), 250)
		return () => clearTimeout(t)
	})

	const askParams = () => ({
		sessionId: sessionId!,
		query: searched || undefined,
		sort: effectiveSort,
		filter,
		offset,
		limit: pageSize,
		request: nextRequest()
	})

	function refresh() {
		if (sessionId == null) return
		socket.emit("entries:sessionEntries", askParams())
	}

	// The answer's interest, held while the panel is mounted; each change of
	// the search, sort, filter or page asks again.
	$effect(() => {
		if (sessionId == null) return
		return requestWithInterest("entries:sessionEntries", askParams(), onEntries)
	})

	/** The filter radios: one tab stop, arrows move and select (APG radio group). */
	function onFilterKey(e: KeyboardEvent, i: number) {
		const step =
			e.key === "ArrowRight" || e.key === "ArrowDown"
				? 1
				: e.key === "ArrowLeft" || e.key === "ArrowUp"
					? -1
					: 0
		if (!step) return
		e.preventDefault()
		const next = (i + step + FILTERS.length) % FILTERS.length
		filter = FILTERS[next].value
		offset = 0
		const group = (e.currentTarget as HTMLElement).parentElement
		;(group?.children[next] as HTMLElement | undefined)?.focus()
	}

	function setMark(row: Row, mark: "off" | "pinned") {
		socket.emit("entries:setMarks", {
			entryId: row.id,
			...(mark === "off" ? { off: !row.off } : { pinned: !row.pinned })
		})
	}

	const FILTERS: Array<{ value: Filter; label: string }> = [
		{ value: "all", label: "All" },
		{ value: "fired", label: "Read" },
		{ value: "pinned", label: "Pinned" },
		{ value: "off", label: "Off" }
	]
	const SORTS: Array<{ value: Sort; label: string }> = [
		{ value: "lastRead", label: "Last read" },
		{ value: "timesRead", label: "Times read" },
		{ value: "rank", label: "Rank" },
		{ value: "name", label: "Name" }
	]

	const ago = (iso: string | null) => {
		if (!iso) return null
		const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
		if (s < 60) return "just now"
		if (s < 3600) return `${Math.round(s / 60)}m ago`
		if (s < 86400) return `${Math.round(s / 3600)}h ago`
		return `${Math.round(s / 86400)}d ago`
	}
	const readLine = (r: Row) => {
		if (!r.timesJudged) return "Not read in this session yet"
		const parts = [`read ${r.timesIncluded} of ${r.timesJudged}`]
		if (r.lastIncluded && r.lastRank != null) parts.push(`last at rank ${r.lastRank}`)
		else if (r.lastIncluded === false) parts.push("left out last time")
		const when = ago(r.lastJudgedAt)
		if (when) parts.push(when)
		return parts.join(" · ")
	}
</script>

<div class="flex flex-col gap-2 p-2" data-widget="lore-entries">
	{#if answer?.ownerOnly}
		<p class="text-surface-600-400 p-2 text-sm">
			These entries are the lorebook owner's to manage.
		</p>
	{:else if answer && answer.lorebookId === null}
		<p class="text-surface-600-400 p-2 text-sm">This session reads no lorebook.</p>
	{:else}
		<div class="flex items-center gap-2">
			<label class="relative min-w-0 flex-1">
				<span class="sr-only">Search entries by title or key</span>
				<Icons.Search
					size={14}
					class="text-surface-600-400 pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
					aria-hidden="true"
				/>
				<input
					class="input h-9 w-full pl-8 text-sm"
					placeholder={answer ? `Search ${answer.total} entries` : "Search entries"}
					bind:value={query}
					oninput={() => (offset = 0)}
				/>
			</label>
			<button
				type="button"
				class="btn-icon btn-icon-sm hover:preset-tonal-surface pointer-coarse:size-11"
				aria-label="Refresh"
				title="Refresh"
				onclick={refresh}
			>
				<Icons.RefreshCw size={14} aria-hidden="true" />
			</button>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex gap-1" role="radiogroup" aria-label="Show">
				{#each FILTERS as f, i (f.value)}
					<button
						type="button"
						role="radio"
						aria-checked={filter === f.value}
						tabindex={filter === f.value ? 0 : -1}
						onkeydown={(e) => onFilterKey(e, i)}
						class="rounded-full px-2.5 py-1 text-xs pointer-coarse:min-h-11 {filter === f.value
							? 'preset-tonal-primary'
							: 'hover:bg-surface-200-800'}"
						onclick={() => {
							filter = f.value
							offset = 0
						}}
					>
						{f.label}
					</button>
				{/each}
			</div>
			<label class="text-surface-600-400 ml-auto flex items-center gap-1 text-xs">
				Sort
				<select
					class="select h-8 py-0 text-xs pointer-coarse:h-11"
					value={effectiveSort}
					onchange={(e) => {
						sort = e.currentTarget.value as Sort
						offset = 0
					}}
				>
					{#each SORTS as o (o.value)}
						<option value={o.value}>{o.label}</option>
					{/each}
				</select>
			</label>
		</div>

		<ul class="flex flex-col gap-0.5" aria-label="Lore entries">
			{#each answer?.rows ?? [] as r (r.id)}
				<li class="hover:bg-surface-200-800 flex items-start gap-2 rounded-md px-2 py-1.5">
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm {r.off ? 'text-surface-600-400 line-through' : ''}">
							{r.title || `Entry #${r.id}`}
						</span>
						{#if r.keys.length}
							<span class="text-surface-600-400 block truncate text-xs">{r.keys.join(", ")}</span>
						{/if}
						<span class="text-surface-600-400 block truncate text-xs">{readLine(r)}</span>
					</span>
					<span class="flex shrink-0 gap-1">
						<button
							type="button"
							class="btn-icon btn-icon-sm pointer-coarse:size-11 {r.pinned
								? 'preset-tonal-primary'
								: 'hover:preset-tonal-surface'}"
							aria-pressed={r.pinned}
							aria-label="Pin {r.title || `entry ${r.id}`}"
							title={r.pinned ? "Pinned: always read" : "Pin: always read"}
							onclick={() => setMark(r, "pinned")}
						>
							<Icons.Pin size={14} aria-hidden="true" />
						</button>
						<button
							type="button"
							class="btn-icon btn-icon-sm pointer-coarse:size-11 {r.off
								? 'preset-tonal-warning'
								: 'hover:preset-tonal-surface'}"
							aria-pressed={r.off}
							aria-label="Turn {r.title || `entry ${r.id}`} off"
							title={r.off ? "Off: never read" : "Turn off: never read"}
							onclick={() => setMark(r, "off")}
						>
							<Icons.CircleOff size={14} aria-hidden="true" />
						</button>
					</span>
				</li>
			{:else}
				{#if answer}
					<li class="text-surface-600-400 p-2 text-sm">
						{query.trim() || filter !== "all" ? "Nothing matches." : "This lorebook has no entries yet."}
					</li>
				{/if}
			{/each}
		</ul>

		{#if answer && answer.total > pageSize}
			<div class="text-surface-600-400 flex items-center justify-between text-xs">
				<button
					type="button"
					class="btn btn-sm hover:preset-tonal-surface pointer-coarse:min-h-11"
					disabled={offset === 0}
					onclick={() => (offset = Math.max(0, offset - pageSize))}
				>
					Previous
				</button>
				<span>
					{offset + 1}–{Math.min(offset + pageSize, answer.total)} of {answer.total}
				</span>
				<button
					type="button"
					class="btn btn-sm hover:preset-tonal-surface pointer-coarse:min-h-11"
					disabled={offset + pageSize >= answer.total}
					onclick={() => (offset = offset + pageSize)}
				>
					Next
				</button>
			</div>
		{/if}
	{/if}
</div>
