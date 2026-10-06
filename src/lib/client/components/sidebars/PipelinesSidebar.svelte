<script lang="ts">
	/**
	 * The pipeline view (05 §0a) — the panel that eventually replaces Prompt Configs.
	 *
	 * "A flat list of the things SP does for you — replying in session, summarizing,
	 * extracting lorebook entries — each with a handful of options."
	 *
	 * ## Genre → Preset → Edit (owner request 2026-09-28)
	 *
	 * The view opens on the genres, the way the sampling view opens on its
	 * categories: a person looking for "the prompt my Chat sessions use"
	 * thinks in genres and presets, not in pipeline slugs. A genre lists its
	 * session presets; a preset opens the options of every pipeline it
	 * reaches — its event bindings, then under **Actions** every action it
	 * includes, the default rule's too (`effectiveIncludedActions`, resolved
	 * on the server) — each one the same `PipelineConfigOptions` this view
	 * always rendered. Every pipeline on the
	 * instance stays one click away under **All pipelines**, the flat list of
	 * every pipeline slug. Where you are is held at module scope
	 * (`pipelinesSidebarNav`), so closing and reopening the view lands you
	 * back there.
	 *
	 * ## Why there is no field list in this file
	 *
	 * SamplingSidebar carries a hand-written `fieldMeta` map naming every
	 * slider's label, min, max and step. It has to be edited every time a field
	 * is added, and it can never show a plugin's fields at all. Here the server sends declarations — label, control, range,
	 * options, current value, and which layer that value came from — and this file
	 * renders whatever arrives. A plugin that ships a pipeline appears in this
	 * panel with no change to this file, which is the entire point of slot
	 * declarations living in the type descriptor (12 §2).
	 *
	 * ## What it deliberately does not know
	 *
	 * Node keys, node count, order, structure. An option is an opaque id and a
	 * label. Structural editing lives on the management page behind an admin
	 * check, and a panel that leaked topology would make that boundary cosmetic.
	 * A preset's BINDINGS are edited on its admin page for the same reason; this
	 * view shows which pipelines a preset reaches and links there.
	 *
	 * ## Scope is a fact, not a question
	 *
	 * The server decides where an edit lands from where the panel was opened —
	 * the configuration itself from the list, session scope from inside a
	 * session you own (05 §0a), and there only for a pipeline that session
	 * runs (owner Q7) — and says so in the view's `scope`. This shows it
	 * rather than asking, because a scope picker asks the user to understand
	 * the resolution chain before they can change a prompt.
	 *
	 * ## Nobody but an administrator owns a configuration (R8)
	 *
	 * Which is why there are no configuration verbs on this panel and never
	 * were: an administrator curates the set, and what reaches here is a
	 * *selection* — for a session you are in, or, outside one, a statement of
	 * which configuration the instance is on. The Admin links (the toolbar's
	 * gear, a card's "Manage pipeline") are the whole of the admin's extra
	 * surface, and they are links, not disabled controls.
	 */
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { getContext, tick } from "svelte"
	import { SvelteSet, SvelteMap } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import ViewToolbar from "$lib/client/components/panels/ViewToolbar.svelte"
	import { toolbarButtonClass } from "$lib/client/components/panels/toolbarButton"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import PipelineConfigOptions from "$lib/client/components/pipelines/PipelineConfigOptions.svelte"
	import { sessionScopeFor } from "$lib/client/components/pipelines/settingsGroups"
	import DocPeek from "$lib/client/components/docs/DocPeek.svelte"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import { eventDisplayName } from "$lib/client/utils/eventName"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import {
		genreRows,
		libraryRows,
		pipelinesSidebarNav as nav,
		presetPipelineGroups,
		presetsOfGenre,
		type PresetPipeline
	} from "./pipelinesSidebarNav.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
		/** Set when the panel is opened from inside a session. */
		sessionId?: number
	}

	let { onclose = $bindable(), sessionId }: Props = $props()

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const isAdmin = $derived(!!userCtx.user?.isAdmin)

	/** Desk: genres stand on the left, the level they open on the right. */
	const viewMode = new ViewModeTracker()

	type Genre = Sockets.Sessions.Genres.Response["genres"][number]
	type Preset = Sockets.SessionAdmin.PresetRow

	let genres = $state<Genre[] | null>(null)
	let presets = $state<Preset[] | null>(null)
	let list = $state<Sockets.Pipelines.Namespace[] | null>(null)
	/** The All pipelines list's filter box: name, slug or genre, any case. */
	let libraryFilter = $state("")
	/** Each row with its genre beside its name — the one list here that mixes genres. */
	const filteredLibrary = $derived(
		list ? libraryRows(list, genres, libraryFilter) : []
	)
	/** The preset this session was started on, when opened inside one. */
	let sessionPresetId = $state<number | null>(null)
	/**
	 * The pipelines the session in view runs (owner Q7): only these open at
	 * the session's scope; any other is the configuration's. Null until
	 * known, and no panel mounts before then — a panel asks once, on mount.
	 */
	let sessionRuns = $state<Set<string> | null>(null)
	const panelsReady = $derived(sessionId == null || sessionRuns !== null)
	const runs = $derived(sessionRuns ?? new Set<string>())

	const loading = $derived(genres === null || presets === null)

	/** The offered genres, with their preset counts. */
	const rows = $derived(genreRows(genres ?? [], presets ?? []))

	const location = $derived(nav.location)

	const currentGenre = $derived(
		nav.genreId ? rows.find((g) => g.genreId === nav.genreId) : undefined
	)
	const genrePresets = $derived(
		nav.genreId ? presetsOfGenre(nav.genreId, presets ?? []) : []
	)
	const currentPreset = $derived(
		location.level === "edit"
			? presets?.find((p) => p.id === location.presetId)
			: undefined
	)
	/**
	 * The preset's pipelines in the Edit level's two groups — its own, then
	 * the ones it reaches through an action. The actions include those the
	 * default rule adds (`includedActions: null`), resolved by the server.
	 */
	const currentGroups = $derived(
		currentPreset
			? presetPipelineGroups(currentPreset, list ?? [])
			: { pipelines: [], actions: [] }
	)
	const currentPipelines = $derived([
		...currentGroups.pipelines,
		...currentGroups.actions
	])
	const currentPipelineName = $derived(
		location.level === "pipeline"
			? (list?.find((ns) => ns.slug === location.slug)?.name ??
					location.slug)
			: ""
	)
	/** Which genre's — the pipeline was picked from a list of several. */
	const currentPipelineGenre = $derived(
		location.level === "pipeline"
			? (libraryRows(list ?? [], genres).find(
					(r) => r.slug === location.slug
				)?.genre ?? null)
			: null
	)

	/**
	 * Which of a preset's pipelines are open. Keyed by preset, so each preset
	 * remembers what you opened in it.
	 */
	const expanded = new SvelteMap<number, SvelteSet<string>>()
	function expandedFor(presetId: number): SvelteSet<string> {
		let set = expanded.get(presetId)
		if (!set) {
			set = new SvelteSet<string>()
			expanded.set(presetId, set)
		}
		return set
	}
	$effect(() => {
		// A preset with ONE pipeline opens it: a single closed door is one
		// more click before the work. With several, they start closed — the
		// list is the answer to "which one", and a shipped preset's first
		// binding (its turn order) would otherwise push the reply off screen.
		const p = currentPreset
		if (p && currentPipelines.length === 1 && !expanded.has(p.id))
			expandedFor(p.id).add(currentPipelines[0].slug)
	})
	function toggle(presetId: number, slug: string) {
		const set = expandedFor(presetId)
		if (set.has(slug)) set.delete(slug)
		else set.add(slug)
	}

	/**
	 * A turn-order pipeline answers nine events; its row names the first few
	 * and counts the rest, with the whole list in the tooltip.
	 */
	const EVENTS_SHOWN = 3
	function eventsLine(events: string[]): string {
		const shown = events.slice(0, EVENTS_SHOWN).map(eventDisplayName)
		const rest = events.length - shown.length
		return shown.join(" · ") + (rest > 0 ? ` · ${rest} more` : "")
	}

	/**
	 * Each loaded pipeline's detail, for the configuration note — which
	 * configuration the panel shows against which one the preset names.
	 */
	const details = new SvelteMap<string, Sockets.Pipelines.NamespaceDetail>()
	function configName(slug: string, id: number): string | null {
		return details.get(slug)?.configs.find((c) => c.id === id)?.name ?? null
	}

	/* ── navigation, with focus following it ─────────────────────────── */

	let root: HTMLElement | undefined = $state()

	/**
	 * Move, then put focus where the eye goes. In compact the button that
	 * was pressed is gone with its pane, and focus left on nothing drops a
	 * keyboard user back at the top of the document.
	 */
	async function go(move: () => void, focus: string) {
		move()
		await tick()
		root?.querySelector<HTMLElement>(focus)?.focus()
	}
	const esc = (s: string) =>
		typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s
	const HEAD = "[data-pane-head] button"

	function openGenre(genreId: string) {
		go(() => nav.openGenre(genreId), HEAD)
	}
	function openPreset(presetId: number) {
		go(() => nav.openPreset(presetId), HEAD)
	}

	const socket = useTypedSocket()
	/**
	 * "Make default for <Genre>" (owner note 27, 2026-10-02): the preset new
	 * sessions of this genre start from. One record — the preset row's
	 * `is_default`, one per genre — written through the same
	 * `sessionPresets:update` the Admin preset page sends; the server clears
	 * the genre's other default and re-sends `sessionPresets:list`, which is
	 * what moves the mark here.
	 */
	function makeDefault(p: Preset) {
		socket.emit("sessionPresets:update", { id: p.id, isDefault: true })
		toaster.success({
			title: `${p.name} is now the default for ${currentGenre?.name ?? "this genre"}`
		})
	}
	function openLibrary() {
		go(() => nav.openLibrary(), HEAD)
	}
	function openPipeline(slug: string) {
		go(() => nav.openPipeline(slug), HEAD)
	}
	function back() {
		const l = nav.location
		const focus =
			l.level === "edit"
				? `[data-preset="${l.presetId}"]`
				: l.level === "pipeline"
					? `[data-pipeline="${esc(l.slug)}"]`
					: l.level === "presets"
						? `[data-genre="${esc(l.genreId)}"]`
						: "[data-library]"
		go(() => nav.back(), focus)
	}

	/* ── reads ───────────────────────────────────────────────────────── */

	const onGenres = (res: Sockets.Sessions.Genres.Response) => {
		genres = res.genres ?? []
	}
	const onPresets = (res: Sockets.SessionAdmin.Presets.Response) => {
		presets = res.presets ?? []
	}
	const onList = (res: Sockets.Pipelines.List.Response) => {
		list = res.pipelinesList
	}
	const onPresetStatus = (res: Sockets.Sessions.PresetStatus.Response) => {
		if (res.sessionId === sessionId) sessionPresetId = res.presetId
	}
	const onSessionPipelines = (res: Sockets.Sessions.Pipelines.Response) => {
		if (res.sessionId === sessionId)
			sessionRuns = new Set(res.pipelines.map((p) => p.slug))
	}

	/**
	 * Four reads, each declared ahead of its request (ruling 3). All BARE —
	 * none is in `SCOPED_EVENTS`; `sessions:presetStatus` carries its
	 * session id and is filtered on it above. All held while the view is
	 * open: `sessionPresets:list` and `pipelines:list` are cascade targets,
	 * so a preset or pipeline changed elsewhere re-sends them.
	 *
	 * The genres are the Start form's (`sessions:genres`, the offered set)
	 * and the presets the picker's (`sessionPresets:list`, which gives a
	 * non-admin only what they may start) — this view shows what a session
	 * could be started on, and nothing else.
	 */
	$effect(() => requestWithInterest("sessions:genres", {}, onGenres))
	$effect(() => requestWithInterest("sessionPresets:list", {}, onPresets))
	$effect(() => requestWithInterest("pipelines:list", {}, onList))
	$effect(() => {
		if (sessionId == null) return
		return requestWithInterest(
			"sessions:presetStatus",
			{ sessionId },
			onPresetStatus
		)
	})
	$effect(() => {
		if (sessionId == null) return
		return requestWithInterest(
			"sessions:pipelines",
			{ sessionId },
			onSessionPipelines
		)
	})

	/** A genre or preset that vanished while we were away steps back. */
	$effect(() => {
		nav.repair({
			genreIds: genres ? rows.map((g) => g.genreId) : null,
			presetIds: presets ? presets.map((p) => p.id) : null
		})
	})

	const hasDetail = $derived(location.level !== "genres")
	const libraryOpen = $derived(viewMode.mode === "desk" && nav.inLibrary)
</script>

<div class="flex min-h-0 flex-1 flex-col" use:viewMode.observe bind:this={root}>
	<PanelSplit
		mode={viewMode.mode}
		{hasDetail}
		listWidth="300px"
		emptyMessage="Pick a genre to see its presets."
		list={genrePane}
		detail={detailPane}
	/>
</div>

{#snippet detailPane()}
	{#if location.level === "presets"}
		{@render presetsPane()}
	{:else if location.level === "edit"}
		{@render editPane()}
	{:else if location.level === "library"}
		{@render libraryPane()}
	{:else if location.level === "pipeline"}
		{@render pipelinePane(location.slug)}
	{/if}
{/snippet}

<!-- ── 1. Genres ─────────────────────────────────────────────────────── -->
{#snippet genrePane()}
	<div class="text-foreground flex h-full flex-col gap-3">
		<!-- The view toolbar (STYLE-GUIDE §6.3; notes 25). Presets and
		     pipelines are made and wired in Admin, so there is no New: an
		     administrator's way there is the secondary icon button. -->
		{#if isAdmin}
			<ViewToolbar label="Pipelines">
				{#snippet actions()}
					<a
						class={toolbarButtonClass()}
						href="/admin/session-presets"
						title="Manage session presets in Admin"
						aria-label="Manage session presets in Admin"
					>
						<Icons.Settings2 size={16} aria-hidden="true" />
					</a>
				{/snippet}
			</ViewToolbar>
		{/if}
		<p class="text-surface-600-400 text-sm">
			Select a genre to see its presets and the pipelines they run.
		</p>

		{#if loading}
			<p class="text-surface-600-400 text-sm">Loading…</p>
		{:else if !rows.length}
			<EmptyState
				icon={Icons.Shapes}
				message="No genres are offered on this pub yet."
			/>
		{:else}
			{#each rows as g (g.genreId)}
				{@const isOpen =
					viewMode.mode === "desk" && nav.genreId === g.genreId}
				{@const defaultName = presetsOfGenre(
					g.genreId,
					presets ?? []
				).find((p) => p.isDefault)?.name}
				<!-- The sampling view's category card, row for row. -->
				<button
					type="button"
					data-genre={g.genreId}
					class="card group w-full cursor-pointer rounded-xl p-4 text-left transition-all {isOpen
						? 'sidebar-row-active'
						: 'preset-filled-surface-100-900 hover:preset-tonal-primary'}"
					aria-current={isOpen ? "true" : undefined}
					onclick={() => openGenre(g.genreId)}
				>
					<div class="flex items-start gap-3">
						<div
							class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
						>
							<Icons.Shapes size={20} aria-hidden="true" />
						</div>
						<div class="min-w-0 flex-1">
							<div
								class="flex items-center justify-between gap-2"
							>
								<span class="font-semibold">{g.name}</span>
								<Icons.ChevronRight
									size={16}
									aria-hidden="true"
									class="text-surface-600-400 shrink-0 transition-transform group-hover:translate-x-0.5"
								/>
							</div>
							{#if g.description}
								<p
									class="text-surface-600-400 mt-0.5 line-clamp-2 text-sm"
								>
									{g.description}
								</p>
							{/if}
							<div
								class="text-surface-600-400 mt-2 flex items-center gap-3 text-xs"
							>
								<span>
									{g.presetCount}
									{g.presetCount === 1 ? "preset" : "presets"}
								</span>
								{#if defaultName}
									<span
										class="text-success-600 dark:text-success-400 flex min-w-0 items-center gap-1 font-medium"
									>
										<Icons.CheckCircle
											size={12}
											aria-hidden="true"
										/>
										<span class="truncate">
											{defaultName}
										</span>
									</span>
								{/if}
							</div>
						</div>
					</div>
				</button>
			{/each}
		{/if}

		<!-- Every pipeline, whichever preset uses it — the flat list of every
		     pipeline slug, always reachable. -->
		<button
			type="button"
			data-library
			class="card group w-full cursor-pointer rounded-xl p-4 text-left transition-all {libraryOpen
				? 'sidebar-row-active'
				: 'preset-filled-surface-100-900 hover:preset-tonal-primary'}"
			aria-current={libraryOpen ? "true" : undefined}
			onclick={openLibrary}
		>
			<div class="flex items-start gap-3">
				<div
					class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
				>
					<Icons.Workflow size={20} aria-hidden="true" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold">All pipelines</span>
						<Icons.ChevronRight
							size={16}
							aria-hidden="true"
							class="text-surface-600-400 shrink-0 transition-transform group-hover:translate-x-0.5"
						/>
					</div>
					<p class="text-surface-600-400 mt-0.5 text-sm">
						Every pipeline on this pub, whichever preset uses
						it.
					</p>
					{#if list}
						<div class="text-surface-600-400 mt-2 text-xs">
							{list.length}
							{list.length === 1 ? "pipeline" : "pipelines"}
						</div>
					{/if}
				</div>
			</div>
		</button>
	</div>
{/snippet}

<!-- ── 2. Presets ────────────────────────────────────────────────────── -->
{#snippet presetsPane()}
	<div class="text-foreground">
		<div class="mb-3" data-pane-head>
			<PanelNavHeader
				title={currentGenre?.name ?? "Presets"}
				onBack={back}
				backLabel="Genres"
			/>
		</div>

		{#if presets === null}
			<p class="text-surface-600-400 text-sm">Loading…</p>
		{:else if !genrePresets.length}
			<EmptyState
				icon={Icons.Ticket}
				message="This genre has no presets you can use yet."
			/>
		{:else}
			<p class="text-surface-600-400 mb-2 flex items-start gap-2 text-sm">
				<span class="min-w-0 flex-1">
					Every preset of this genre. New sessions start from the
					default; pick a preset to see the pipelines it runs.
				</span>
				<DocPeek
					href={docsHref("pipelines", "a-genres-default-preset")}
					topic="presets and the default"
				/>
			</p>
			<div class="flex flex-col gap-2">
				{#each genrePresets as p (p.id)}
					<div
						class="card preset-filled-surface-100-900 flex w-full flex-col rounded-xl"
					>
						<button
							type="button"
							data-preset={p.id}
							class="hover:preset-tonal-primary group flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors"
							onclick={() => openPreset(p.id)}
						>
							<Icons.Ticket
								size={18}
								class="shrink-0 opacity-70"
								aria-hidden="true"
							/>
							<span class="min-w-0 flex-1">
								<span
									class="flex min-w-0 flex-wrap items-center gap-1.5"
								>
									<span class="truncate font-medium">
										{p.name}
									</span>
									{#if p.isDefault}
										<span
											class="preset-tonal-primary rounded-full px-1.5 py-0.5 text-[11px]"
											title="New {currentGenre?.name ??
												''} sessions start from this preset."
										>
											Default
										</span>
									{/if}
									{#if p.isImmutable}
										<span
											class="preset-tonal-surface rounded-full px-1.5 py-0.5 text-[11px]"
											title="Shipped with Serene Pub or a plugin. Its bindings are read-only."
										>
											Built-in
										</span>
									{/if}
									{#if !p.enabled}
										<span
											class="preset-tonal-surface rounded-full px-1.5 py-0.5 text-[11px]"
											title="Not offered when starting a session. An administrator can switch it on in Admin."
										>
											Hidden
										</span>
									{/if}
									{#if sessionPresetId === p.id}
										<span
											class="preset-tonal-success rounded-full px-1.5 py-0.5 text-[11px]"
										>
											This session
										</span>
									{/if}
								</span>
								{#if p.description}
									<span
										class="text-surface-600-400 block truncate text-xs"
									>
										{p.description}
									</span>
								{/if}
							</span>
							<Icons.ChevronRight
								size={16}
								class="text-surface-600-400 shrink-0 transition-transform group-hover:translate-x-0.5"
								aria-hidden="true"
							/>
						</button>
						{#if isAdmin && !p.isDefault && p.enabled}
							<div class="flex justify-end px-3 pb-2">
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface"
									onclick={() => makeDefault(p)}
								>
									<Icons.Star size={14} aria-hidden="true" />
									Make default for {currentGenre?.name ??
										"this genre"}
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<!-- ── 3. Edit ───────────────────────────────────────────────────────── -->
{#snippet editPane()}
	<div class="text-foreground">
		<div class="mb-3" data-pane-head>
			<PanelNavHeader
				title={currentPreset?.name ?? "Preset"}
				onBack={back}
				backLabel={currentGenre?.name ?? "Presets"}
			>
				{#snippet subtitle()}
					{#if currentPreset?.description}
						<p class="text-surface-600-400 text-sm">
							{currentPreset.description}
						</p>
					{/if}
				{/snippet}
			</PanelNavHeader>
		</div>

		{#if !currentPreset}
			<p class="text-surface-600-400 text-sm">Loading…</p>
		{:else}
			{@const p = currentPreset}
			{#if isAdmin}
				<!-- The view toolbar (§6.3): the pipeline cards save as they
				     are changed, so there is no primary; Admin is a secondary
				     icon button, where it sits in every view. -->
				<ViewToolbar label="Preset" class="mb-3">
					{#snippet actions()}
						<a
							class={toolbarButtonClass()}
							href="/admin/session-presets/{p.id}"
							title="Manage this preset in Admin: which pipeline answers each event, its configurations, and whether it is offered"
							aria-label="Manage this preset in Admin"
						>
							<Icons.Settings2 size={16} aria-hidden="true" />
						</a>
					{/snippet}
				</ViewToolbar>
			{/if}
			{#if p.staleBindings?.length}
				<div
					class="preset-tonal-warning mb-3 flex items-start gap-2 rounded-xl p-2 text-sm"
					role="note"
				>
					<Icons.TriangleAlert
						size={16}
						class="mt-0.5 shrink-0"
						aria-hidden="true"
					/>
					<span>
						{p.staleBindings.length === 1
							? "One of this preset's pipelines is missing"
							: `${p.staleBindings.length} of this preset's pipelines are missing`},
						so sessions on it use the genre's own instead.
					</span>
				</div>
			{/if}

			{#if !currentPipelines.length}
				<p class="text-surface-600-400 py-6 text-center text-sm">
					This preset binds no pipelines of its own. Its sessions run
					the genre's defaults.
				</p>
			{:else}
				<p
					class="text-surface-600-400 mb-3 flex items-start gap-2 text-sm"
				>
					<span class="min-w-0 flex-1">
						The pipelines sessions on this preset run. Open one to
						change its prompts and settings, grouped by agent.
					</span>
					<DocPeek
						href={docsHref("pipelines", "agents")}
						topic="a pipeline's settings"
					/>
				</p>
				{#if currentGroups.pipelines.length}
					<div class="flex flex-col gap-3">
						{#each currentGroups.pipelines as pp (pp.slug)}
							{@render pipelineCard(p.id, pp)}
						{/each}
					</div>
				{/if}
				{#if currentGroups.actions.length}
					<!-- The actions sessions on this preset offer — those it
					     names and those it includes by the default rule, as the
					     server resolves them (`effectiveIncludedActions`). -->
					<div role="group" aria-labelledby="preset-{p.id}-actions">
						<h3
							id="preset-{p.id}-actions"
							class="mt-5 mb-1 text-sm font-medium"
						>
							Actions
						</h3>
						<p class="text-surface-600-400 mb-3 text-sm">
							What people can use in sessions on this preset.
						</p>
						<div class="flex flex-col gap-3">
							{#each currentGroups.actions as pp (pp.slug)}
								{@render pipelineCard(p.id, pp)}
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		{/if}
	</div>
{/snippet}

<!-- One pipeline of a preset: a row that opens its options. -->
{#snippet pipelineCard(presetId: number, pp: PresetPipeline)}
	{@const open = !!expanded.get(presetId)?.has(pp.slug)}
	{@const detail = details.get(pp.slug)}
	{@const presetConfig =
		pp.configId != null ? configName(pp.slug, pp.configId) : null}
	{@const regionId = `preset-${presetId}-${pp.slug}`}
	<section class="panel-card !p-0">
		<div class="flex items-start">
			<button
				type="button"
				class="hover:bg-surface-200-800 flex min-w-0 flex-1 items-start gap-3 rounded-[12px] p-3 text-left"
				aria-expanded={open}
				aria-controls={regionId}
				onclick={() => toggle(presetId, pp.slug)}
			>
				<Icons.Workflow
					size={18}
					class="mt-0.5 shrink-0 opacity-70"
					aria-hidden="true"
				/>
				<span class="min-w-0 flex-1">
					<span class="block truncate font-medium">
						{pp.name}
					</span>
					<span
						class="text-surface-600-400 block text-xs"
						title={pp.events.length > EVENTS_SHOWN
							? pp.events.map(eventDisplayName).join(" · ")
							: undefined}
					>
						{#if pp.events.length}
							{eventsLine(pp.events)}
						{/if}
						{#if pp.events.length && pp.actions.length}
							·
						{/if}
						{#if pp.actions.length}
							{pp.actions.length === 1 ? "Action" : "Actions"}: {pp.actions.join(
								", "
							)}
						{/if}
					</span>
				</span>
				<Icons.ChevronDown
					size={16}
					class="text-surface-600-400 mt-0.5 shrink-0 transition-transform {open
						? 'rotate-180'
						: ''}"
					aria-hidden="true"
				/>
			</button>
		</div>
		{#if open}
			<div id={regionId} class="px-3 pb-3">
				{#if presetConfig && detail?.selectedConfig && detail.selectedConfig.id !== pp.configId}
					<!-- The panel edits the configuration the
					     instance (or this session) has
					     selected; say so when the preset
					     names a different one. -->
					<p class="preset-tonal-surface mb-3 rounded-lg p-2 text-xs">
						Sessions started on this preset run “{presetConfig}”.
						The options below are “{detail.selectedConfig.name}”.
					</p>
				{/if}
				{#if panelsReady}
					<PipelineConfigOptions
						slug={pp.slug}
						sessionId={sessionScopeFor(pp.slug, sessionId, runs)}
						sessionDoesNotRun={sessionId != null &&
							!runs.has(pp.slug)}
						onLoaded={(d) => details.set(pp.slug, d)}
					/>
				{/if}
				{#if isAdmin}
					<a
						class="btn btn-sm preset-tonal-surface mt-3 w-full"
						href="/admin/pipelines/{encodeURIComponent(pp.slug)}"
					>
						<Icons.Settings2 size={16} aria-hidden="true" /> Manage pipeline
					</a>
				{/if}
			</div>
		{/if}
	</section>
{/snippet}

<!-- ── All pipelines ─────────────────────────────────────────────────── -->
{#snippet libraryPane()}
	<div class="text-foreground">
		<div class="mb-3" data-pane-head>
			<PanelNavHeader
				title="All pipelines"
				onBack={back}
				backLabel="Genres"
			/>
		</div>
		{#if list?.length}
			<ViewToolbar label="All pipelines" class="mb-3">
				{#snippet filter()}
					<PanelFilterInput
						bind:value={libraryFilter}
						placeholder="pipelines"
						singular="pipeline"
						count={list?.length ?? 0}
					/>
				{/snippet}
			</ViewToolbar>
		{/if}
		{#if list === null}
			<p class="text-surface-600-400 text-sm">Loading…</p>
		{:else if !list.length}
			<EmptyState
				icon={Icons.Workflow}
				message="No pipelines are published on this pub yet."
			/>
		{:else}
			<div class="flex flex-col gap-2">
				{#if !filteredLibrary.length}
					<p class="text-surface-600-400 text-sm">
						No pipeline matches “{libraryFilter.trim()}”.
					</p>
				{/if}
				{#each filteredLibrary as ns (ns.slug)}
					<button
						type="button"
						data-pipeline={ns.slug}
						class="card preset-filled-surface-100-900 hover:preset-tonal-primary group flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors"
						onclick={() => openPipeline(ns.slug)}
					>
						<Icons.Workflow
							size={18}
							class="shrink-0 opacity-70"
							aria-hidden="true"
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">
								{ns.name}
							</span>
							<!-- The genre leads the meta line: names carry
							     none (NOMENCLATURE §2), and it is what tells
							     four genres' Reply apart. -->
							<span
								class="text-surface-600-400 block truncate text-xs"
								data-pipeline-genre={ns.genre ?? undefined}
							>
								{ns.genre
									? `${ns.genre} · `
									: ""}v{ns.version}{ns.enabled ? "" : " · disabled"}
							</span>
						</span>
						<Icons.ChevronRight
							size={16}
							class="text-surface-600-400 shrink-0 transition-transform group-hover:translate-x-0.5"
							aria-hidden="true"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet pipelinePane(slug: string)}
	<div class="text-foreground">
		<div class="mb-3" data-pane-head>
			<PanelNavHeader
				title={currentPipelineName}
				onBack={back}
				backLabel="All pipelines"
			>
				{#snippet subtitle()}
					{#if currentPipelineGenre}
						<p class="text-surface-600-400 text-sm">
							{currentPipelineGenre}
						</p>
					{/if}
				{/snippet}
			</PanelNavHeader>
		</div>

		{#if isAdmin}
			<ViewToolbar label="Pipeline" class="mb-3">
				{#snippet actions()}
					<a
						class={toolbarButtonClass()}
						href="/admin/pipelines/{encodeURIComponent(slug)}"
						title="Manage this pipeline in Admin"
						aria-label="Manage this pipeline in Admin"
					>
						<Icons.Settings2 size={16} aria-hidden="true" />
					</a>
				{/snippet}
			</ViewToolbar>
		{/if}

		{#if panelsReady}
			<PipelineConfigOptions
				{slug}
				sessionId={sessionScopeFor(slug, sessionId, runs)}
				sessionDoesNotRun={sessionId != null && !runs.has(slug)}
			/>
		{/if}
	</div>
{/snippet}
