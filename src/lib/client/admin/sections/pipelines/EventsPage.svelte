<script lang="ts">
	import { adminPage } from "$lib/client/admin/adminRouter.svelte"
	/**
	 * The events page (PLAN-turn-order §B2), in two layers.
	 *
	 * **Registry**: every event this instance knows — core's, then each
	 * installed package's — with its family, whether it touches a user's
	 * account, its payload shape, what causes it, the genres that list it, how
	 * many presets bind it, and a package event's owner and recording scope.
	 *
	 * **Event map**: B1's `eventMap` for a scope (a genre, a preset, or one
	 * session by `?session=`), laid out by ELK. Clicking an event selects its
	 * registry row; a pipeline opens its admin page; a plugin's listener opens
	 * the plugins page. The coverage matrix is B4's, not this page's.
	 *
	 * Admin-only: redirected here, refused again by the handler.
	 */
	import { getContext, onMount, tick } from "svelte"
	import * as Icons from "@lucide/svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import { adminGoto as goto, adminReplaceState as replaceState } from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import EventMapCanvas from "$lib/client/components/pipelines/events/EventMapCanvas.svelte"
	import { STANDARD_GENRE_ID } from "$lib/client/components/sessionForms/createSession.svelte"

	type Row = Sockets.Pipelines.EventMap.RegistryRow
	type Scope = Sockets.Pipelines.EventMap.Params

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const interest = getInterestContext()

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/* ── scope, mirrored in the address bar ─────────────────────────── */

	const initial =
		typeof window !== "undefined"
			? new URLSearchParams(adminPage.url.search)
			: new URLSearchParams()
	const intParam = (k: string) => {
		const n = Number(initial.get(k))
		return Number.isInteger(n) && n > 0 ? n : null
	}
	/**
	 * With nothing in the address, the map opens on Chat: every genre at once
	 * is every published pipeline, too dense to read. Clearing the picker
	 * draws them all, and the address says so (`genre=all`), so a reload
	 * keeps it.
	 */
	const ALL = "all"
	const unscoped = !["genre", "preset", "session"].some((k) => initial.has(k))
	const genreParam = initial.get("genre")
	let genreId = $state<string>(
		genreParam === ALL ? "" : (genreParam ?? (unscoped ? STANDARD_GENRE_ID : ""))
	)
	let presetId = $state<string>(intParam("preset")?.toString() ?? "")
	let sessionId = $state<number | null>(intParam("session"))
	let selectedId = $state<string | null>(initial.get("event"))

	$effect(() => {
		if (typeof window === "undefined") return
		const p = new URLSearchParams()
		if (genreId) p.set("genre", genreId)
		else if (!presetId && sessionId == null) p.set("genre", ALL)
		if (presetId) p.set("preset", presetId)
		if (sessionId != null) p.set("session", String(sessionId))
		if (selectedId) p.set("event", selectedId)
		const q = p.toString()
		try {
			replaceState(q ? `?${q}` : adminPage.url.pathname, {})
		} catch {}
	})

	const scope = $derived<Scope>({
		...(genreId ? { genreId } : {}),
		...(presetId ? { presetId: Number(presetId) } : {}),
		...(sessionId != null ? { sessionId } : {})
	})
	const scopeKey = (s: Scope | undefined) =>
		`${s?.genreId ?? ""}|${s?.presetId ?? ""}|${s?.sessionId ?? ""}`

	/* ── the one read ───────────────────────────────────────────────── */

	let events = $state<Row[]>([])
	let genres = $state<Array<{ genreId: string; name: string }>>([])
	let presets = $state<Array<{ id: number; name: string; genreId: string }>>(
		[]
	)
	let map = $state<Sockets.Pipelines.EventMap.Response["eventMap"] | null>(
		null
	)
	let loading = $state(true)
	let error = $state<string | null>(null)
	let notice = $state<string | null>(null)

	const onEventMap = (res: Sockets.Pipelines.EventMap.Response) => {
		if (res.error) {
			error = res.error
			loading = false
			return
		}
		// A reply for a scope the page has since left is dropped: the map
		// must match the pickers above it.
		if (scopeKey(res.scope) !== scopeKey(scope)) return
		events = res.events ?? []
		genres = res.genres ?? []
		presets = res.presets ?? []
		map = res.eventMap ?? null
		error = null
		loading = false
	}

	/**
	 * BARE interest: `pipelines:eventMap` is about the instance, not one
	 * session. The app-wide context, not `adminInterest`: `pipelines:` is a
	 * mixed family, so this is an ordinary key behind the page's own admin
	 * check. Re-asked whenever the scope moves.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const asked = scope
		loading = true
		return interest.requestWithInterest("pipelines:eventMap", asked, onEventMap)
	})

	/**
	 * Failures arrive on `:error` — declared like the other admin pages
	 * declare theirs; an error event is never gated (interest rule 1), so the
	 * declaration only routes it here.
	 */
	const onEventMapError = (res: Sockets.Pipelines.EventMap.Response) => {
		// A session scope the server cannot find is dropped with a notice,
		// not a dead page: the rest of the page still has something to show.
		if (res.scope?.sessionId != null && res.scope.sessionId === sessionId) {
			notice = res.error ?? null
			sessionId = null
			if (!genreId && !presetId) genreId = STANDARD_GENRE_ID
			return
		}
		error = res.error ?? "The event map could not be read."
		loading = false
	}
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return interest.declareInterest<"pipelines:eventMap:error">(
			"pipelines:eventMap:error",
			onEventMapError
		)
	})

	/* ── the registry ───────────────────────────────────────────────── */

	let query = $state("")
	const genreName = (id: string) =>
		genres.find((g) => g.genreId === id)?.name ?? id
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase()
		if (!q) return events
		return events.filter(
			(e) =>
				e.label.toLowerCase().includes(q) ||
				e.id.toLowerCase().includes(q) ||
				e.owner.toLowerCase().includes(q)
		)
	})
	const selected = $derived(events.find((e) => e.id === selectedId) ?? null)

	/**
	 * The selected event's neighbours on the drawn event map — the same
	 * places a map click opens, as links, so they are reachable without a
	 * pointer.
	 */
	const neighbours = $derived.by(() => {
		if (!map || !selectedId) return null
		const byId = new Map(map.nodes.map((n) => [n.id, n]))
		const pick = (ids: string[]) =>
			ids.map((id) => byId.get(id)).filter((n) => !!n)
		return {
			answeredBy: pick(
				map.edges
					.filter((e) => e.from === selectedId && e.kind === "binds")
					.map((e) => e.to)
			),
			causedBy: pick(
				map.edges
					.filter((e) => e.to === selectedId && e.kind === "causes")
					.map((e) => e.from)
			),
			heardBy: pick(
				map.edges
					.filter((e) => e.from === selectedId && e.kind === "listens")
					.map((e) => e.to)
			)
		}
	})
	const hrefOf = (node: Sockets.Pipelines.EventMap.MapNode): string | null =>
		node.kind === "spec"
			? `/admin/pipelines/${encodeURIComponent(node.id)}`
			: node.kind === "listener" && !node.id.startsWith("core:")
				? "/admin/plugins"
				: null

	async function selectEvent(id: string | null, scroll = false) {
		selectedId = selectedId === id && !scroll ? null : id
		if (scroll && id) {
			query = ""
			await tick()
			document
				.getElementById(rowDomId(id))
				?.scrollIntoView({ block: "nearest", behavior: "smooth" })
		}
	}
	const rowDomId = (id: string) =>
		`event-row-${id.replace(/[^a-z0-9]+/gi, "-")}`

	/** A map click (§B2): an event selects its row; the rest open their page. */
	function openNode(node: Sockets.Pipelines.EventMap.MapNode) {
		if (node.kind === "event") return selectEvent(node.id, true)
		const href = hrefOf(node)
		if (href) return goto(href)
	}

	/* ── the scope pickers ──────────────────────────────────────────── */

	const genreOptions = $derived(
		genres.map((g) => ({ value: g.genreId, label: g.name }))
	)
	const presetOptions = $derived(
		presets
			.filter((p) => !genreId || p.genreId === genreId)
			.map((p) => ({ value: String(p.id), label: p.name }))
	)
	/** A preset from another genre is dropped when the genre moves. */
	$effect(() => {
		if (!presetId || !genreId || !presets.length) return
		if (!presets.some((p) => String(p.id) === presetId && p.genreId === genreId))
			presetId = ""
	})

	const LEGEND = "text-surface-600-400 text-xs font-medium"
	const FAMILY_WORD = { data: "data", action: "action" }
</script>

<svelte:head>
	<title>Events · Admin · Serene Pub</title>
</svelte:head>

{#snippet eventRow(e: Row)}
	{@const isSel = e.id === selectedId}
	<button
		id={rowDomId(e.id)}
		type="button"
		class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors
			{isSel ? 'sidebar-row-active' : 'hover:bg-surface-200-800'}"
		aria-current={isSel ? "true" : undefined}
		onclick={() => selectEvent(e.id)}
	>
		<span class="min-w-0 flex-1">
			<span class="flex items-center gap-2">
				<span class="truncate text-sm font-medium">{e.label}</span>
				<span
					class="preset-tonal-surface shrink-0 rounded-full px-1.5 py-0.5 text-[11px]"
				>
					{FAMILY_WORD[e.family]}
				</span>
				{#if e.owner !== "core"}
					<span
						class="preset-tonal-secondary shrink-0 rounded-full px-1.5 py-0.5 text-[11px]"
						title="Declared by {e.owner}"
					>
						package
					</span>
				{/if}
			</span>
			<span class="text-surface-600-400 block truncate font-mono text-[11px]">
				{e.id}
			</span>
		</span>
		<span class="text-surface-600-400 shrink-0 text-xs whitespace-nowrap">
			{e.presets}
			{e.presets === 1 ? "preset" : "presets"}
		</span>
	</button>
{/snippet}

{#snippet fact(label: string, body: import("svelte").Snippet)}
	<div class="flex flex-col gap-0.5">
		<p class={LEGEND}>{label}</p>
		<div class="text-sm">{@render body()}</div>
	</div>
{/snippet}

{#snippet detail(e: Row)}
	<div class="panel-card flex flex-col gap-3">
		<div class="min-w-0">
			<h3 class="text-base font-semibold">{e.label}</h3>
			<p class="text-surface-600-400 font-mono text-[11px] break-all">{e.id}</p>
		</div>
		{#if e.description}
			<p class="text-surface-600-400 text-sm">{e.description}</p>
		{/if}
		<div class="grid gap-3 @lg/events:grid-cols-2">
			{#snippet family()}
				{e.family === "data"
					? "Data — something was written"
					: "Action — a request to run something"}
			{/snippet}
			{@render fact("Family", family)}
			{#snippet affects()}
				{e.affectsUser
					? "Yes — touches a user's account or assets"
					: "No"}
			{/snippet}
			{@render fact("Affects the user", affects)}
			{#snippet payload()}
				<span class="font-mono text-xs">{e.payload ?? "—"}</span>
			{/snippet}
			{@render fact("Payload shape", payload)}
			{#snippet owner()}
				{#if e.owner === "core"}
					Core
				{:else}
					<a class="anchor" href="/admin/plugins">{e.owner}</a>
				{/if}
			{/snippet}
			{@render fact("Declared by", owner)}
		</div>
		{#snippet caused()}
			{#if e.causedBy.length}
				<ul class="flex flex-col gap-0.5">
					{#each e.causedBy as c (c)}
						<li class="font-mono text-xs">{c}</li>
					{/each}
				</ul>
			{:else}
				<span class="text-surface-600-400">
					{e.family === "action"
						? "Nothing writes it — an action is asked for, not caused."
						: "No write declares it."}
				</span>
			{/if}
		{/snippet}
		{@render fact("Caused by", caused)}
		{#snippet genresList()}
			{#if e.genres.length}
				<ul class="flex flex-wrap gap-1.5">
					{#each e.genres as g (g.genreId)}
						<li
							class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
							title={g.genreId}
						>
							{genreName(g.genreId)}{g.required ? " · required" : ""}
						</li>
					{/each}
				</ul>
			{:else}
				<span class="text-surface-600-400">No genre lists it.</span>
			{/if}
		{/snippet}
		{@render fact("Genres", genresList)}
		{#snippet presetCount()}
			<a class="anchor" href="/admin/session-presets">
				{e.presets}
				{e.presets === 1 ? "preset binds" : "presets bind"} it
			</a>
		{/snippet}
		{@render fact("Presets", presetCount)}
		{#if e.recordedBy?.length}
			{#snippet scopeList()}
				<ul class="flex flex-col gap-1">
					{#each e.recordedBy as r (r.genreId)}
						<li>
							<span class="font-medium">{genreName(r.genreId)}</span>
							<span class="text-surface-600-400">—</span>
							{#if r.recordedBy === "any"}
								any pipeline in the genre
							{:else}
								<span class="font-mono text-xs">{r.recordedBy.join(", ")}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/snippet}
			{@render fact("Who may record it", scopeList)}
		{/if}
		{#if neighbours && (neighbours.answeredBy.length || neighbours.causedBy.length || neighbours.heardBy.length)}
			{#snippet onMap()}
				<dl class="flex flex-col gap-1.5">
					{#each [["Answered by", neighbours.answeredBy], ["Caused by", neighbours.causedBy], ["Heard by", neighbours.heardBy]] as const as [word, list] (word)}
						{#if list.length}
							<div>
								<dt class="text-surface-600-400 text-xs">{word}</dt>
								<dd class="flex flex-wrap gap-x-3 gap-y-1">
									{#each list as n (n.id)}
										{@const href = hrefOf(n)}
										{#if href}
											<a class="anchor" {href} title={n.id}>{n.label}</a>
										{:else}
											<span title={n.id}>{n.label}</span>
										{/if}
									{/each}
								</dd>
							</div>
						{/if}
					{/each}
				</dl>
			{/snippet}
			{@render fact("On the event map", onMap)}
		{/if}
	</div>
{/snippet}

<div class="@container/events mx-auto flex w-full max-w-[1120px] flex-col gap-4">
	<AdminPageHeader
		title="Events"
		purpose="Every event this instance knows, and which pipelines and listeners answer and cause each one."
	/>

	{#if notice}
		<p class="text-surface-600-400 text-sm" role="status">{notice}</p>
	{/if}
	{#if error}
		<p class="text-error-600-400 text-sm" role="alert">{error}</p>
	{:else if loading && !events.length}
		<p class="text-surface-600-400 flex items-center gap-2 text-sm">
			<Icons.Loader2 size={16} class="animate-spin" /> Loading…
		</p>
	{:else}
		<section
			class="grid items-start gap-4 @min-[900px]/events:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)]"
			aria-label="Event registry"
		>
			<div class="panel-card flex min-w-0 flex-col gap-2">
				<PanelFilterInput
					bind:value={query}
					placeholder="events"
					count={events.length}
				/>
				{#if filtered.length}
					<div class="flex max-h-[28rem] flex-col gap-0.5 overflow-y-auto">
						{#each filtered as e (e.id)}
							{@render eventRow(e)}
						{/each}
					</div>
				{:else}
					<p class="text-surface-600-400 p-3 text-sm">
						No event matches “{query}”.
					</p>
				{/if}
			</div>
			<div class="min-w-0">
				{#if selected}
					{@render detail(selected)}
				{:else}
					<div class="panel-card text-surface-600-400 text-sm">
						Choose an event to see what declares, causes and binds
						it — here or on the event map below.
					</div>
				{/if}
			</div>
		</section>

		<section class="panel-card flex flex-col gap-3 !p-0" aria-label="Event map">
			<div class="flex flex-wrap items-end gap-3 px-4 pt-4">
				<div class="min-w-0 flex-1">
					<h3 class="text-sm font-medium">Event map</h3>
					<p class="text-surface-600-400 text-xs">
						What is installed, not what is running. A preset or a
						session draws only the pipelines it runs.
					</p>
				</div>
				<Select
					label="Genre"
					options={genreOptions}
					bind:value={genreId}
					placeholder="Every genre"
					onValueChange={() => (sessionId = null)}
					clearable
					class="w-full @lg/events:w-52"
				/>
				<Select
					label="Preset"
					options={presetOptions}
					bind:value={presetId}
					placeholder="Any preset"
					onValueChange={() => (sessionId = null)}
					clearable
					emptyMessage="No preset for this genre."
					class="w-full @lg/events:w-52"
				/>
				{#if sessionId != null}
					<span
						class="preset-tonal-primary flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
					>
						Session {sessionId}
						<button
							type="button"
							class="hover:bg-surface-300-700 grid size-6 place-items-center rounded-full pointer-coarse:size-11"
							aria-label="Stop scoping the map to session {sessionId}"
							onclick={() => (sessionId = null)}
						>
							<Icons.X size={12} />
						</button>
					</span>
				{/if}
			</div>
			{#if map}
				<EventMapCanvas {map} {selectedId} onNodeClick={openNode} />
			{/if}
		</section>
	{/if}
</div>
