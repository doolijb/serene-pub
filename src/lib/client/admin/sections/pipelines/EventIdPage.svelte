<script lang="ts">
	/**
	 * Admin › Pipelines › Events › <event> (PLAN-turn-order §B2; note 37,
	 * Django admin): one event's read-only **change view**. Fieldsets: the
	 * event's facts, what causes it, the genres that list it (an inline), the
	 * presets whose event bindings name it (an inline — bindings are edited on
	 * each preset's change form, so there is no "Add another"), and the
	 * **event map** drawn around it, scoped by Genre / Preset pickers (and
	 * `?session=`) mirrored in this page's query.
	 *
	 * The map opens on the address's scope, else the event's first genre,
	 * else Chat — every genre at once is every published pipeline, too dense
	 * to read. Clearing the genre draws them all and the address says so
	 * (`genre=all`). A map click on another event opens its change view; a
	 * pipeline its workspace; a plugin's listener the plugins page.
	 *
	 * Read-only: events arrive with code. Admin-only: redirected here,
	 * refused again by every handler.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		adminGoto as goto,
		adminPage,
		adminReplaceState as replaceState
	} from "$lib/client/admin/adminRouter.svelte"
	import {
		getAdminInterestContext,
		getInterestContext,
		requestWithInterest
	} from "$lib/client/sockets/interest.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField from "$lib/client/components/admin/AdminField.svelte"
	import AdminInline from "$lib/client/components/admin/AdminInline.svelte"
	import type { AdminChangelistColumn } from "$lib/client/components/admin/changelist"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import EventMapCanvas from "$lib/client/components/pipelines/events/EventMapCanvas.svelte"
	import { STANDARD_GENRE_ID } from "$lib/client/components/sessionForms/createSession.svelte"
	import {
		defaultScope,
		mapNeighbours,
		nodeHref,
		presetsBinding,
		scopeFromQuery,
		scopeQuery,
		type PresetBinding
	} from "./eventsAdmin"

	type Row = Sockets.Pipelines.EventMap.RegistryRow
	type MapNode = Sockets.Pipelines.EventMap.MapNode
	type Params = Sockets.Pipelines.EventMap.Params

	const userCtx: { user: SelectUser } = getContext("userCtx")
	/** `pipelines:` is a MIXED family: ordinary keys behind the admin check. */
	const interest = getInterestContext()
	/** `sessionPresets:` is restricted: the admin half of the registry. */
	const adminInterest = getAdminInterestContext()

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/** The router decodes the param; the id carries `:` and `/`. */
	const id = $derived(adminPage.params.id ?? "")

	/* ── the map's scope, mirrored in the address ───────────────────── */

	// svelte-ignore state_referenced_locally
	const initial = scopeFromQuery(typeof window !== "undefined" ? adminPage.url.search : "")
	/** False until the scope is known: from the address, or the event's default. */
	let resolved = $state(initial != null)
	let genreId = $state(initial?.genreId ?? STANDARD_GENRE_ID)
	let presetId = $state(initial?.presetId ?? "")
	let sessionId = $state<number | null>(initial?.sessionId ?? null)
	const scope = $derived({ genreId, presetId, sessionId })

	$effect(() => {
		if (typeof window === "undefined" || !resolved) return
		const q = scopeQuery(scope).toString()
		try {
			replaceState(q ? `?${q}` : adminPage.url.pathname, {})
		} catch {}
	})

	const params = $derived<Params>({
		...(genreId ? { genreId } : {}),
		...(presetId ? { presetId: Number(presetId) } : {}),
		...(sessionId != null ? { sessionId } : {})
	})
	const paramsKey = (s: Params | undefined) =>
		`${s?.genreId ?? ""}|${s?.presetId ?? ""}|${s?.sessionId ?? ""}`

	/* ── reads ───────────────────────────────────────────────────────── */

	let events = $state<Row[]>([])
	let genres = $state<Array<{ genreId: string; name: string }>>([])
	let scopePresets = $state<Array<{ id: number; name: string; genreId: string }>>([])
	let map = $state<Sockets.Pipelines.EventMap.Response["eventMap"] | null>(null)
	let presets = $state<Sockets.SessionAdmin.PresetRow[]>([])
	let configs = $state<Sockets.Pipelines.ConfigsIndex.Row[]>([])
	let loading = $state(true)
	let error = $state<string | null>(null)
	let notice = $state<string | null>(null)

	const row = $derived(events.find((e) => e.id === id) ?? null)

	const onEventMap = (res: Sockets.Pipelines.EventMap.Response) => {
		if (res.error) {
			error = res.error
			loading = false
			return
		}
		// A reply for a scope the page has since left is dropped: the map
		// must match the pickers above it.
		if (paramsKey(res.scope) !== paramsKey(params)) return
		events = res.events ?? []
		genres = res.genres ?? []
		scopePresets = res.presets ?? []
		error = null
		loading = false
		if (!resolved) {
			// The address named no scope: open on the event's own genre.
			const d = defaultScope(
				events.find((e) => e.id === id),
				STANDARD_GENRE_ID
			)
			resolved = true
			if (d.genreId !== genreId) {
				genreId = d.genreId
				return
			}
		}
		map = res.eventMap ?? null
	}

	/**
	 * Failures arrive on `:error`. A session scope the server cannot find is
	 * dropped with a notice, not a dead page.
	 */
	const onEventMapError = (res: Sockets.Pipelines.EventMap.Response) => {
		if (res.scope?.sessionId != null && res.scope.sessionId === sessionId) {
			notice = res.error ?? null
			sessionId = null
			if (!genreId && !presetId) genreId = STANDARD_GENRE_ID
			return
		}
		error = res.error ?? "The event could not be read."
		loading = false
	}

	/** BARE: the registry and the map are about the instance. Re-asked when the scope moves. */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return interest.requestWithInterest("pipelines:eventMap", params, onEventMap)
	})
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"pipelines:eventMap:error">(
				"pipelines:eventMap:error",
				onEventMapError
			),
			// STANDING: re-sent after every preset write, so the inline stays true.
			adminInterest.requestWithInterest("sessionPresets:list", {}, (res) => {
				presets = res.presets
			}),
			requestWithInterest("pipelines:configsIndex", {}, (res) => {
				configs = res.configs
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/* ── what the fieldsets show ─────────────────────────────────────── */

	const genreName = (gid: string) => genres.find((g) => g.genreId === gid)?.name ?? gid
	const specName = (slug: string) => configs.find((c) => c.specSlug === slug)?.specName ?? slug
	const configName = (b: PresetBinding) =>
		b.config == null
			? "Shipped default"
			: (configs.find((c) => c.id === b.config)?.name ?? `Configuration ${b.config}`)

	type GenreLine = { genreId: string; required: boolean; recordedBy?: string[] | "any" }
	const genreLines = $derived<GenreLine[]>(
		(row?.genres ?? []).map((g) => ({
			...g,
			recordedBy: row?.recordedBy?.find((r) => r.genreId === g.genreId)?.recordedBy
		}))
	)
	const genreColumns = $derived<AdminChangelistColumn<GenreLine>[]>([
		{ key: "genre", label: "Genre", primary: true, text: (g) => genreName(g.genreId) },
		{ key: "standing", label: "Standing", text: (g) => (g.required ? "Required" : "Optional") },
		...(row?.recordedBy
			? [
					{
						key: "recordedBy",
						label: "Who may record it",
						text: (g: GenreLine) =>
							g.recordedBy === "any"
								? "Any pipeline in the genre"
								: g.recordedBy?.length
									? g.recordedBy.join(", ")
									: "—"
					}
				]
			: [])
	])

	const bindings = $derived(presetsBinding(presets, id))
	const bindingColumns: AdminChangelistColumn<PresetBinding>[] = [
		{ key: "preset", label: "Preset", primary: true, text: (b) => b.presetName },
		{ key: "genre", label: "Genre", text: (b) => genreName(b.genreId) },
		{ key: "pipeline", label: "Pipeline", custom: true },
		{ key: "config", label: "Configuration", text: configName }
	]

	const neighbours = $derived(mapNeighbours(map, id))
	const hasNeighbours = $derived(
		neighbours.answeredBy.length + neighbours.causedBy.length + neighbours.heardBy.length > 0
	)
	const hrefOf = (node: MapNode) => nodeHref(node, scope)

	/** A map click: another event opens its change view; the rest their page. */
	function openNode(node: MapNode) {
		if (node.kind === "event" && node.id === id) return
		const href = hrefOf(node)
		if (href) void goto(href)
	}

	/* ── the scope pickers ──────────────────────────────────────────── */

	const genreOptions = $derived(genres.map((g) => ({ value: g.genreId, label: g.name })))
	const presetOptions = $derived(
		scopePresets
			.filter((p) => !genreId || p.genreId === genreId)
			.map((p) => ({ value: String(p.id), label: p.name }))
	)
	/** A preset from another genre is dropped when the genre moves. */
	$effect(() => {
		if (!presetId || !genreId || !scopePresets.length) return
		if (!scopePresets.some((p) => String(p.id) === presetId && p.genreId === genreId))
			presetId = ""
	})

	const FAMILY_WORD = {
		data: "Data — something was written",
		action: "Action — a request to run something"
	}
</script>

{#snippet pipelineCell(b: PresetBinding)}
	<a class="anchor" href="/admin/pipelines/{encodeURIComponent(b.spec)}" title={b.spec}>
		{specName(b.spec)}
	</a>
{/snippet}

{#if loading && !events.length}
	<div class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm" role="status">
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading event…
	</div>
{:else if error && !events.length}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-error-600-400 text-sm" role="alert">{error}</p>
		<a href="/admin/pipelines/events" class="btn btn-sm preset-tonal-surface">All events</a>
	</div>
{:else if !row}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">
			There is no event <span class="font-mono">{id}</span>.
		</p>
		<a href="/admin/pipelines/events" class="btn btn-sm preset-tonal-surface">All events</a>
	</div>
{:else}
	<div class="@container/event flex min-w-0 flex-col gap-3">
		<AdminPageHeader
			title={row.label}
			purpose="What declares, causes and binds this event. Read-only: events arrive with core and packages."
		>
			{#if notice}
				<p class="text-surface-600-400 text-sm" role="status">{notice}</p>
			{/if}
			{#if error}
				<p class="text-error-600-400 text-sm" role="alert">{error}</p>
			{/if}
		</AdminPageHeader>

		<AdminFieldset title="Event">
			<div class="grid gap-4 @lg/event:grid-cols-2">
				<AdminField id="event-id" label="Id" value={row.id} class="[&_p]:font-mono [&_p]:text-xs [&_p]:break-all" />
				<AdminField id="event-family" label="Family" value={FAMILY_WORD[row.family]} />
				<AdminField
					id="event-affects"
					label="Affects the user"
					value={row.affectsUser ? "Yes — touches a user's account or assets" : "No"}
				/>
				<AdminField
					id="event-payload"
					label="Payload shape"
					value={row.payload}
					class="[&_p]:font-mono [&_p]:text-xs"
				/>
				<div class="flex min-w-0 flex-col gap-1.5" data-field="event-owner">
					<span class="text-surface-600-400 text-xs" id="event-owner-label">Declared by</span>
					<p class="text-surface-950-50 text-sm" aria-labelledby="event-owner-label">
						{#if row.owner === "core"}
							Core
						{:else}
							<a class="anchor" href="/admin/plugins">{row.owner}</a>
						{/if}
					</p>
				</div>
			</div>
			<AdminField id="event-description" label="Description" value={row.description} />
		</AdminFieldset>

		<AdminFieldset
			title="Caused by"
			description="The writes that raise this event."
		>
			{#if row.causedBy.length}
				<ul class="flex flex-col gap-1">
					{#each row.causedBy as c (c)}
						<li class="font-mono text-xs break-all">{c}</li>
					{/each}
				</ul>
			{:else}
				<p class="text-surface-600-400 text-sm">
					{row.family === "action"
						? "Nothing writes it — an action is asked for, not caused."
						: "No write declares it."}
				</p>
			{/if}
		</AdminFieldset>

		<AdminInline
			title="Genres"
			description="The genres that list this event, and whether each requires its presets to bind it."
			rows={genreLines}
			rowKey={(g) => g.genreId}
			columns={genreColumns}
			rowHref={(g) => `/admin/session-genres/${encodeURIComponent(g.genreId)}`}
			emptyMessage="No genre lists it."
		/>

		<AdminInline
			title="Bound by presets"
			description="The presets whose event bindings name this event. Bindings are edited on each preset's change form."
			rows={bindings}
			rowKey={(b) => b.presetId}
			columns={bindingColumns}
			rowHref={(b) => `/admin/session-presets/${b.presetId}`}
			emptyMessage="No preset binds it."
		>
			{#snippet cell(b, col)}
				{#if col.key === "pipeline"}{@render pipelineCell(b)}{/if}
			{/snippet}
		</AdminInline>

		<section class="panel-card flex flex-col gap-3 !p-0" aria-labelledby="event-map-title">
			<div class="flex flex-wrap items-end gap-3 px-4 pt-4">
				<div class="min-w-0 flex-[1_1_14rem]">
					<h2 id="event-map-title" class="text-surface-950-50 text-sm font-medium">Event map</h2>
					<p class="text-surface-600-400 mt-0.5 text-xs">
						What is installed, not what is running. A preset or a session draws only the pipelines
						it runs.
					</p>
				</div>
				<Select
					label="Genre"
					options={genreOptions}
					bind:value={genreId}
					placeholder="Every genre"
					onValueChange={() => (sessionId = null)}
					clearable
					class="w-full @lg/event:w-52"
				/>
				<Select
					label="Preset"
					options={presetOptions}
					bind:value={presetId}
					placeholder="Any preset"
					onValueChange={() => (sessionId = null)}
					clearable
					emptyMessage="No preset for this genre."
					class="w-full @lg/event:w-52"
				/>
				{#if sessionId != null}
					<span class="preset-tonal-primary flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs">
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
			{#if hasNeighbours}
				<dl class="flex flex-col gap-1.5 px-4" aria-label="On the event map">
					{#each [["Answered by", neighbours.answeredBy], ["Caused by", neighbours.causedBy], ["Heard by", neighbours.heardBy]] as const as [word, list] (word)}
						{#if list.length}
							<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
								<dt class="text-surface-600-400 text-xs">{word}</dt>
								<dd class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
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
			{:else if map && !map.nodes.some((n) => n.id === id)}
				<p class="text-surface-600-400 px-4 text-sm">
					This event is not on the map for this scope.
				</p>
			{/if}
			{#if map}
				<EventMapCanvas {map} selectedId={id} onNodeClick={openNode} />
			{:else}
				<p class="text-surface-600-400 flex items-center gap-2 px-4 pb-4 text-sm">
					<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" /> Drawing the map…
				</p>
			{/if}
		</section>
	</div>
{/if}
