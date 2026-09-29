<script lang="ts">
	/**
	 * Instance › History — the admin logbook (`admin:logbook`): who changed
	 * what on this instance, and when. Django admin's History, for every admin
	 * section at once.
	 *
	 * The ADDRESS is the filter state. `?type=connection&id=12` is the
	 * contract a change form links to ("History" for one object); the other
	 * filters ride in the same query (`actor`, `action`, `q`, `since`,
	 * `until`) so a filtered list can be linked and survives Back. Controls
	 * write the query; the request follows it.
	 *
	 * The server filters and pages by cursor (newest first, "Load older"); the
	 * changelist sorts and pages what is loaded. A row opens its record: the
	 * summary, and each changed field's before and after. Secrets were
	 * withheld when the record was written — a redacted line says only that
	 * the field changed.
	 */
	import { getContext, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		adminGoto as goto,
		adminPage as page,
		adminReplaceState
	} from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		LOGBOOK_ACTIONS,
		LOGBOOK_ACTION_LABELS,
		LOGBOOK_OBJECT_TYPES,
		isLogbookObjectType,
		type LogbookAction,
		type LogbookRecordView
	} from "$lib/shared/adminLogbook"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const interest = getInterestContext()

	const PAGE = 100

	/* ── the query, read from the address ─────────────────────────────── */

	const qp = (k: string) => page.url.searchParams.get(k) ?? ""
	let type = $derived(qp("type"))
	let objectId = $derived(page.url.searchParams.get("id"))
	let actor = $derived(qp("actor"))
	let action = $derived(qp("action"))
	let since = $derived(qp("since"))
	let until = $derived(qp("until"))
	let q = $derived(qp("q"))

	/** Writes one filter into the address; `""` removes it. */
	function setParam(key: string, value: string | null) {
		const next = new URLSearchParams(page.url.searchParams)
		if (value == null || value === "") next.delete(key)
		else next.set(key, value)
		// Choosing another object type drops the one object it was narrowed to.
		if (key === "type") next.delete("id")
		const s = next.toString()
		adminReplaceState(s ? `?${s}` : "?", {} as App.PageState)
	}

	function clearAll() {
		searchDraft = ""
		adminReplaceState("?", {} as App.PageState)
	}

	/* ── search box: typed locally, written to the address after a pause ── */

	let searchDraft = $state(untrack(() => q))
	let searchTimer: ReturnType<typeof setTimeout> | undefined
	$effect(() => {
		// The address changed from elsewhere (a link, Back): follow it.
		const fromUrl = q
		untrack(() => {
			if (fromUrl !== searchDraft.trim()) searchDraft = fromUrl
		})
	})
	function onSearchInput() {
		clearTimeout(searchTimer)
		searchTimer = setTimeout(() => setParam("q", searchDraft.trim()), 300)
	}

	/* ── the read ─────────────────────────────────────────────────────── */

	let records: LogbookRecordView[] = $state([])
	let actors: Array<{ id: number | null; name: string }> = $state([])
	let hasMore = $state(false)
	let loading = $state(true)
	let loadingOlder = $state(false)
	let selectedId: number | null = $state(null)
	/** The request whose reply is current; older replies are dropped. */
	let currentRequest = ""
	/** Replies to "Load older" append; a fresh query replaces. */
	let appendFor = ""

	function dateParam(d: string, endOfDay: boolean): string | null {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
		// Local midnight — the day as the reader means it.
		const t = new Date(`${d}T00:00:00`)
		if (endOfDay) t.setDate(t.getDate() + 1)
		return t.toISOString()
	}

	let query = $derived<Sockets.Admin.Logbook.Params>({
		objectType: type || null,
		objectId: type ? objectId : null,
		actorUserId: actor && /^\d+$/.test(actor) ? Number(actor) : null,
		action: (LOGBOOK_ACTIONS as readonly string[]).includes(action)
			? (action as LogbookAction)
			: null,
		since: dateParam(since, false),
		until: dateParam(until, true),
		text: q || null,
		limit: PAGE
	})

	const onReply = (res: Sockets.Admin.Logbook.Response) => {
		if (res.requestId !== currentRequest) return
		records =
			appendFor === currentRequest ? [...records, ...res.records] : res.records
		actors = res.actors
		hasMore = res.hasMore
		loading = false
		loadingOlder = false
	}

	let seq = 0
	function request(params: Sockets.Admin.Logbook.Params, append: boolean) {
		const requestId = `h${++seq}`
		currentRequest = requestId
		appendFor = append ? requestId : ""
		// Its own handler per request: the registry dedupes by reference, so a
		// shared one would be released by whichever request let go first.
		return interest.requestWithInterest(
			"admin:logbook",
			{ ...params, requestId },
			(res) => onReply(res)
		)
	}

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const params = query
		return untrack(() => {
			loading = true
			selectedId = null
			return request(params, false)
		})
	})

	let releaseOlder: (() => void) | null = null
	function loadOlder() {
		const last = records[records.length - 1]
		if (!last || loadingOlder) return
		loadingOlder = true
		releaseOlder?.()
		releaseOlder = request({ ...query, before: last.id }, true)
	}
	$effect(() => () => releaseOlder?.())

	$effect(() => {
		if (userCtx.user && !userCtx.user.isAdmin) goto("/")
	})

	/* ── presentation ─────────────────────────────────────────────────── */

	const typeLabel = (t: string) =>
		isLogbookObjectType(t) ? LOGBOOK_OBJECT_TYPES[t].label : t

	/** "connection “Local”"; a singleton whose name IS its kind says it once. */
	function objectName(t: string, label: string): string {
		const kind = typeLabel(t)
		if (!label || label.toLowerCase() === kind.toLowerCase())
			return kind.charAt(0).toUpperCase() + kind.slice(1)
		return `${kind} “${label}”`
	}

	function objectHref(r: LogbookRecordView): string | null {
		if (!isLogbookObjectType(r.objectType)) return null
		const t = LOGBOOK_OBJECT_TYPES[r.objectType] as {
			href?: (id: string | null) => string | null
		}
		// A deleted object has no page to open.
		if (r.action === "delete") return null
		return t.href?.(r.objectId) ?? null
	}

	const fmtWhen = (iso: string) =>
		new Date(iso).toLocaleString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit"
		})

	function fmtValue(v: unknown): string {
		if (v === undefined) return ""
		if (v == null || v === "") return "empty"
		if (typeof v === "boolean") return v ? "on" : "off"
		if (typeof v === "string" || typeof v === "number") return String(v)
		try {
			return JSON.stringify(v, null, 1)
		} catch {
			return String(v)
		}
	}

	const ACTION_TONE: Record<LogbookAction, string> = {
		add: "preset-tonal-success",
		change: "preset-tonal-primary",
		delete: "preset-tonal-error",
		other: "preset-tonal-surface"
	}
	const ACTION_ICON: Record<LogbookAction, keyof typeof Icons> = {
		add: "Plus",
		change: "Pencil",
		delete: "Trash2",
		other: "Zap"
	}

	const typeOptions = Object.entries(LOGBOOK_OBJECT_TYPES)
		.map(([value, t]) => ({
			value,
			label: t.label.charAt(0).toUpperCase() + t.label.slice(1)
		}))
		.sort((a, b) => a.label.localeCompare(b.label))
	const actionOptions = LOGBOOK_ACTIONS.map((a) => ({
		value: a,
		label: LOGBOOK_ACTION_LABELS[a]
	}))
	let actorOptions = $derived(
		actors
			.filter((a) => a.id != null)
			.map((a) => ({ value: String(a.id), label: a.name }))
	)

	let selected = $derived(records.find((r) => r.id === selectedId) ?? null)
	/** The one object this page is narrowed to, named from its newest record. */
	let narrowedTo = $derived(
		type && objectId != null
			? (records.find((r) => (r.objectId ?? "") === objectId)?.objectLabel ||
					(objectId ? `#${objectId}` : typeLabel(type)))
			: null
	)
	let filtered = $derived(!!(type || actor || action || since || until || q))

	const columns: AdminColumn<LogbookRecordView>[] = [
		{ key: "when", label: "When", value: (r) => r.at },
		{ key: "who", label: "Who", value: (r) => r.actorName },
		{ key: "action", label: "Action", value: (r) => r.action },
		{
			key: "object",
			label: "Object",
			value: (r) => `${typeLabel(r.objectType)} ${r.objectLabel}`
		},
		{ key: "summary", label: "Change", value: (r) => r.summary }
	]
</script>

<div class="@container/view mx-auto flex w-full max-w-[1120px] flex-col">
	<AdminPageHeader
		title="History"
		purpose="Who changed what on this pub, and when. Records are kept for 90 days; secrets are never written down."
	>
		{#if narrowedTo}
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<span
					class="preset-tonal-primary flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
				>
					{objectName(type, narrowedTo ?? "")}
					<button
						type="button"
						class="hover:preset-tonal-surface flex size-6 items-center justify-center rounded-full"
						aria-label="Show every {typeLabel(type)}"
						onclick={() => setParam("id", null)}
					>
						<Icons.X size={12} />
					</button>
				</span>
			</div>
		{/if}
	</AdminPageHeader>

	<form
		role="search"
		aria-label="Filter the history"
		class="panel-card mb-4 grid gap-3 p-4 @lg/view:grid-cols-2 @min-[900px]/view:grid-cols-3"
		onsubmit={(e) => {
			e.preventDefault()
			clearTimeout(searchTimer)
			setParam("q", searchDraft.trim())
		}}
	>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-700-300 text-xs font-medium">Search</span>
			<span class="relative">
				<Icons.Search
					size={16}
					class="text-surface-600-400 pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
				/>
				<input
					type="search"
					class="input pl-8 text-sm"
					placeholder="Summary, object, person or event"
					bind:value={searchDraft}
					oninput={onSearchInput}
				/>
			</span>
		</label>
		<Select
			label="Object"
			options={typeOptions}
			value={type}
			placeholder="Every kind"
			clearable
			onValueChange={(v) => setParam("type", v)}
		/>
		<Select
			label="Who"
			options={actorOptions}
			value={actor}
			placeholder="Anyone"
			clearable
			emptyMessage="Nobody has changed anything yet."
			onValueChange={(v) => setParam("actor", v)}
		/>
		<Select
			label="Action"
			options={actionOptions}
			value={action}
			placeholder="Any action"
			clearable
			onValueChange={(v) => setParam("action", v)}
		/>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-700-300 text-xs font-medium">From</span>
			<input
				type="date"
				class="input text-sm"
				value={since}
				max={until || undefined}
				onchange={(e) => setParam("since", e.currentTarget.value)}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-surface-700-300 text-xs font-medium">To</span>
			<input
				type="date"
				class="input text-sm"
				value={until}
				min={since || undefined}
				onchange={(e) => setParam("until", e.currentTarget.value)}
			/>
		</label>
		{#if filtered}
			<div class="flex items-end @lg/view:col-span-2 @min-[900px]/view:col-span-3">
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={clearAll}
				>
					<Icons.FilterX size={16} />
					Clear filters
				</button>
			</div>
		{/if}
	</form>

	{#if selected}
		<section
			class="panel-card mb-4 flex flex-col gap-3 p-4"
			aria-labelledby="logbook-record-title"
		>
			<div class="flex flex-wrap items-start gap-3">
				<div class="min-w-0 flex-[1_1_16rem]">
					<h2 id="logbook-record-title" class="text-base font-semibold">
						{selected.summary}
					</h2>
					<p class="text-surface-600-400 mt-1 text-xs">
						{selected.actorName} · {fmtWhen(selected.at)} ·
						{objectName(selected.objectType, selected.objectLabel)}
						· <code class="text-[11px]">{selected.event}</code>
					</p>
				</div>
				<div class="flex shrink-0 items-center gap-2">
					{#if objectHref(selected)}
						<a class="btn btn-sm preset-tonal-surface" href={objectHref(selected)}>
							<Icons.ExternalLink size={16} />
							Open
						</a>
					{/if}
					{#if selected.objectType && !(type === selected.objectType && objectId === (selected.objectId ?? ""))}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface"
							onclick={() => {
								const next = new URLSearchParams()
								next.set("type", selected!.objectType)
								next.set("id", selected!.objectId ?? "")
								searchDraft = ""
								adminReplaceState(`?${next}`, {} as App.PageState)
							}}
						>
							<Icons.History size={16} />
							This object's history
						</button>
					{/if}
					<button
						type="button"
						class="btn-icon btn-icon-sm hover:preset-tonal-surface"
						aria-label="Close the record"
						onclick={() => (selectedId = null)}
					>
						<Icons.X size={16} />
					</button>
				</div>
			</div>

			{#if selected.changes.length}
				<ul class="flex flex-col gap-2" aria-label="Changed fields">
					{#each selected.changes as c (c.field)}
						<li
							class="bg-surface-100-900 flex flex-col gap-1 rounded-[10px] px-3 py-2 text-sm @lg/view:grid @lg/view:grid-cols-[minmax(8rem,14rem)_1fr] @lg/view:gap-3"
						>
							<span class="font-medium">{c.label}</span>
							{#if c.redacted}
								<span class="text-surface-600-400 flex items-center gap-1.5 text-xs">
									<Icons.LockKeyhole size={14} />
									Changed — the value is a secret and was not recorded.
								</span>
							{:else}
								<span class="flex min-w-0 flex-col gap-1 @min-[900px]/view:flex-row @min-[900px]/view:items-start @min-[900px]/view:gap-2">
									{#if c.before !== undefined}
										<span
											class="text-surface-600-400 min-w-0 text-xs break-words whitespace-pre-wrap line-through decoration-surface-500/60"
										>
											<span class="sr-only">Before: </span>{fmtValue(c.before)}
										</span>
										<Icons.ArrowRight
											size={14}
											class="text-surface-600-400 hidden shrink-0 @min-[900px]/view:block"
											aria-hidden="true"
										/>
									{/if}
									<span class="min-w-0 text-xs break-words whitespace-pre-wrap">
										<span class="sr-only">{c.before !== undefined ? "After: " : "Value: "}</span>{fmtValue(c.after)}
									</span>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-surface-600-400 text-sm">No field-level detail for this change.</p>
			{/if}
		</section>
	{/if}

	<AdminList
		rows={records}
		{columns}
		{loading}
		pageSize={25}
		defaultSort="when"
		defaultSortDir="desc"
		storageKey="serene-pub:adminView:history"
		emptyMessage={filtered
			? "Nothing matches these filters."
			: "No changes recorded yet. Changes made in the admin sections will appear here."}
		onRowClick={(r) => (selectedId = selectedId === r.id ? null : r.id)}
	>
		{#snippet cell(row, col)}
			{#if col.key === "when"}
				<time class="text-surface-700-300 text-xs whitespace-nowrap" datetime={row.at}>
					{fmtWhen(row.at)}
				</time>
			{:else if col.key === "who"}
				<span class="text-xs">{row.actorName}</span>
			{:else if col.key === "action"}
				{@const Icon = Icons[ACTION_ICON[row.action]] as any}
				<span
					class="{ACTION_TONE[row.action]} inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
				>
					<Icon size={12} aria-hidden="true" />
					{LOGBOOK_ACTION_LABELS[row.action]}
				</span>
			{:else if col.key === "object"}
				<span class="flex min-w-0 flex-col">
					<span class="truncate text-sm font-medium">
						{row.objectLabel || typeLabel(row.objectType)}
					</span>
					<span class="text-surface-600-400 text-[11px]">
						{typeLabel(row.objectType)}
					</span>
				</span>
			{:else if col.key === "summary"}
				<span class="text-sm" class:font-semibold={row.id === selectedId}>
					{row.summary}
				</span>
			{/if}
		{/snippet}
	</AdminList>

	{#if hasMore && !loading}
		<div class="mt-3 flex justify-center">
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={loadOlder}
				disabled={loadingOlder}
			>
				{#if loadingOlder}
					<Icons.LoaderCircle size={16} class="animate-spin" />
				{:else}
					<Icons.ChevronsDown size={16} />
				{/if}
				Load older changes
			</button>
		</div>
	{/if}
</div>
