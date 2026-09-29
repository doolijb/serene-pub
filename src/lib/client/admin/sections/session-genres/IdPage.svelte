<script lang="ts">
	/**
	 * The genre hub (admin IA 2026-08-28; grown by B4, R66) — one genre's whole
	 * world, and the place its app-wide decisions are made:
	 *
	 * - the genre's switch: off stops new sessions only (Q-B4a);
	 * - its event surface, each event linking to the events page;
	 * - its presets, each with its own switch, and Enable all / Disable all
	 *   (Q-B4d);
	 * - the coverage matrix — events × presets, what each preset binds —
	 *   read-only, linking to each preset's editor (Q-B4b);
	 * - the swap contributions plugins make to its pipelines, each with the
	 *   admin's switch (`plugins.disabled_swaps`, Q-B4c).
	 *
	 * Every fact is a SELECT made elsewhere; every write is an existing verb
	 * or one of the hub's two (`setPresetsEnabled`, `setSwapEnabled`), and
	 * each answers by re-sending this page's detail.
	 */
	import { getContext, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import { ADMIN_SPLIT } from "$lib/client/components/admin/AdminSplit.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const split = getContext<{ mode: "desk" | "compact" } | undefined>(
		ADMIN_SPLIT
	)
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b): `sessionGenres:`
	// is a RESTRICTED interest family, and this context exists only inside the
	// admin tree, which already turns non-admins away.
	const interest = getAdminInterestContext()
	const genreId = $derived(decodeURIComponent(page.params.id ?? ""))

	let detail = $state<Sockets.SessionAdmin.GenreDetail.Response | null>(null)
	let loading = $state(true)
	/** The last write's refusal or report, said where the switch is. */
	let notice = $state<string | null>(null)

	/**
	 * `sessionGenres:detail` is not scoped, and the hub's writes re-send it
	 * to every open hub: a detail for another genre is not this page's.
	 */
	const onDetail = (res: Sockets.SessionAdmin.GenreDetail.Response) => {
		if (res.genre && res.genre.genreId !== untrack(() => genreId)) return
		detail = res
		loading = false
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	const onPresetsEnabled = (
		res: Sockets.SessionAdmin.SetPresetsEnabled.Response
	) => {
		if (res.genreId !== untrack(() => genreId)) return
		notice = res.refused.length
			? `${res.refused.map((r) => `${r.name}: ${r.reason}`).join(" · ")}`
			: null
	}
	/**
	 * A refused switch has already moved on screen; asking for the detail
	 * again puts it back where the server left it.
	 */
	const resync = () =>
		socket.emit("sessionGenres:detail", { genreId: untrack(() => genreId) })
	const onPresetError = (res: { error?: string }) => {
		notice = res.error ?? null
		resync()
	}
	const onSwapError = (res: Sockets.SessionAdmin.SetSwapEnabled.Response) => {
		notice = res.error ?? null
		resync()
	}

	/**
	 * This genre's detail, asked for and listened for in one, with its
	 * refusal on the same handler — the not-found body is what the page
	 * renders — and the acks of the hub's writes. BARE: none is scoped.
	 *
	 * `genreId` is read untracked: the page asks once, on mount.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"sessionGenres:detail:error">(
				"sessionGenres:detail:error",
				onDetail
			),
			interest.declareInterest<"sessionGenres:setPresetsEnabled">(
				"sessionGenres:setPresetsEnabled",
				onPresetsEnabled
			),
			interest.declareInterest<"sessionPresets:update:error">(
				"sessionPresets:update:error",
				onPresetError
			),
			interest.declareInterest<"sessionGenres:setSwapEnabled:error">(
				"sessionGenres:setSwapEnabled:error",
				onSwapError
			),
			interest.requestWithInterest(
				"sessionGenres:detail",
				{ genreId: untrack(() => genreId) },
				onDetail
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/* ── writes ─────────────────────────────────────────────────────── */

	function setGenreEnabled(enabled: boolean) {
		notice = null
		socket.emit("sessionGenres:update", { slug: genreId, enabled })
	}
	function setDefaultPreset(raw: string) {
		notice = null
		socket.emit("sessionGenres:update", {
			slug: genreId,
			defaultPresetId: raw ? Number(raw) : null
		})
	}
	function setPresetEnabled(id: number, enabled: boolean) {
		notice = null
		socket.emit("sessionPresets:update", { id, enabled })
	}
	function setAllPresets(enabled: boolean) {
		notice = null
		socket.emit("sessionGenres:setPresetsEnabled", { genreId, enabled })
	}
	function setSwap(
		row: Sockets.SessionAdmin.GenreDetail.SwapRow,
		enabled: boolean
	) {
		notice = null
		socket.emit("sessionGenres:setSwapEnabled", {
			pluginId: row.pluginId,
			spec: row.spec,
			node: row.node,
			definition: row.definition,
			enabled,
			genreId
		})
	}

	/* ── the event surface ──────────────────────────────────────────── */

	type Slot = Sockets.SessionAdmin.GenreDetail.Slot
	const slotColumns: AdminColumn<Slot>[] = [
		{ key: "event", label: "Event", value: (s) => s.event },
		{
			key: "standing",
			label: "Standing",
			value: (s) => (s.required ? 0 : s.open ? 2 : 1)
		},
		{ key: "candidates", label: "Serving pipelines" }
	]
	const eventsPageHref = (event: string) =>
		`/admin/pipelines/events?genre=${encodeURIComponent(genreId)}&event=${encodeURIComponent(event)}`

	/* ── presets ────────────────────────────────────────────────────── */

	type Preset = Sockets.SessionAdmin.PresetRow
	const presetColumns: AdminColumn<Preset>[] = [
		{ key: "name", label: "Preset", value: (p) => p.name },
		{ key: "enabled", label: "Offered", value: (p) => (p.enabled ? 0 : 1) },
		{ key: "actions", label: "", class: "w-px text-right" }
	]

	/* ── the coverage matrix: events × presets (read-only, Q-B4b) ──── */

	/** Open slots take any number of pipelines, so no preset binds them. */
	const matrixSlots = $derived((detail?.slots ?? []).filter((s) => !s.open))
	const specName = (slug: string) => {
		for (const s of detail?.slots ?? [])
			for (const c of s.candidates) if (c.slug === slug) return c.name
		return slug
	}
	type Cell =
		| { kind: "bound"; spec: string; stale: boolean }
		| { kind: "missing" }
		| { kind: "unbound" }
	function cellOf(p: Preset, s: Slot): Cell {
		const b = p.bindings[s.event]
		if (b?.spec)
			return {
				kind: "bound",
				spec: b.spec,
				stale: !!p.staleBindings?.some((x) => x.event === s.event)
			}
		return s.required ? { kind: "missing" } : { kind: "unbound" }
	}

	/* ── swap contributions (Q-B4c) ─────────────────────────────────── */

	const swapGroups = $derived.by(() => {
		const groups = new Map<
			string,
			{
				specName: string
				spec: string
				node: string
				rows: Sockets.SessionAdmin.GenreDetail.SwapRow[]
			}
		>()
		for (const r of detail?.swaps ?? []) {
			const k = `${r.spec}#${r.node}`
			const g = groups.get(k) ?? {
				specName: r.specName,
				spec: r.spec,
				node: r.node,
				rows: []
			}
			g.rows.push(r)
			groups.set(k, g)
		}
		return [...groups.values()]
	})

	const LEGEND = "text-surface-600-400 text-xs font-medium"
	const SWITCH_CONTROL =
		"preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
</script>

<svelte:head>
	<title>{detail?.genre?.name ?? "Genre"} · Admin · Serene Pub</title>
</svelte:head>

<div class="flex flex-col">
	{#if split?.mode !== "desk"}
		<a
			href="/admin/session-genres"
			class="text-surface-600-400 hover:text-surface-950-50 mb-3 inline-flex items-center gap-1 self-start text-[13px]"
		>
			<Icons.ChevronLeft size={14} /> Back to genres
		</a>
	{/if}
	<div class="mb-4 flex flex-wrap items-center gap-3">
		<div class="min-w-0 flex-1">
			<h2
				class="text-surface-950-50 flex flex-wrap items-center gap-2 [font-family:var(--typo-heading--font-family)] text-base font-semibold"
			>
				{detail?.genre?.name ?? genreId}
				{#if detail?.genre?.family}
					<span
						class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs font-normal"
					>
						{detail.genre.family}
					</span>
				{/if}
			</h2>
			<p class="text-surface-600-400 font-mono text-xs">{genreId}</p>
		</div>
		<div class="flex flex-wrap gap-1.5">
			<a
				class="btn btn-sm preset-tonal-surface"
				href="/admin/pipelines/events?genre={encodeURIComponent(
					genreId
				)}"
			>
				<Icons.Zap size={14} /> Events
			</a>
			{#if detail?.genre?.createSpecSlug}
				<a
					class="btn btn-sm preset-tonal-surface"
					href="/admin/pipelines/{encodeURIComponent(
						detail.genre.createSpecSlug
					)}"
				>
					<Icons.Workflow size={14} /> Create pipeline
				</a>
			{/if}
			<a class="btn btn-sm preset-tonal-surface" href="/admin/plugins">
				<Icons.Puzzle size={14} /> Plugins
			</a>
		</div>
	</div>

	{#if loading}
		<p class="text-surface-600-400 flex items-center gap-2 text-sm">
			<Icons.Loader2 size={16} class="animate-spin" /> Loading…
		</p>
	{:else if !detail?.genre}
		<div class="panel-card text-surface-600-400 py-8 text-center text-sm">
			{detail?.error ?? "This genre no longer exists."}
		</div>
	{:else}
		{@const genre = detail.genre}
		<div class="flex flex-col gap-4">
			{#if genre.description}
				<p class="text-surface-700-300 max-w-[70ch] text-sm">
					{genre.description}
				</p>
			{/if}

			<section
				class="panel-card flex flex-col gap-2"
				aria-label="Availability"
			>
				<Switch
					name="genre-enabled"
					checked={genre.enabled}
					onCheckedChange={(e) => setGenreEnabled(e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="text-sm font-medium">
						People can start {genre.name} sessions
					</Switch.Label>
					<Switch.Control class={SWITCH_CONTROL}>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<p class="text-surface-600-400 text-xs">
					{genre.enabled
						? "The genre is offered when someone starts a session."
						: "Hidden from the picker, and new sessions are refused. Existing sessions keep running."}
					{detail.sessionCount}
					{detail.sessionCount === 1
						? "session uses"
						: "sessions use"} it.
				</p>
				{#if detail.presets.length}
					<Select
						label="Default preset"
						class="mt-1 w-full max-w-xs text-sm"
						options={[
							{ value: "", label: "None" },
							...detail.presets.map((p) => ({
								value: String(p.id),
								label: p.name
							}))
						]}
						value={genre.defaultPresetId != null
							? String(genre.defaultPresetId)
							: ""}
						onValueChange={(v) => setDefaultPreset(v)}
					/>
				{/if}
			</section>

			{#if notice}
				<p
					class="preset-tonal-warning rounded-lg p-2 text-sm"
					role="status"
				>
					{notice}
				</p>
			{/if}

			<section class="flex flex-col gap-2">
				<h3 class="text-base font-semibold">Event surface</h3>
				<p class="text-surface-600-400 text-sm">
					What this genre declares, and which published pipelines
					answer each event. A preset binds the events that are not
					open; required ones must be bound for a preset to be
					offered.
				</p>
				<AdminList
					rows={detail.slots}
					columns={slotColumns}
					searchText={(s) => s.event}
					searchPlaceholder="Search events…"
					defaultSort="standing"
					storageKey="serene-pub:adminView:genreSlots"
					emptyMessage="This genre declares no events — its declaration predates the event surface."
				>
					{#snippet cell(slot, col)}
						{#if col.key === "event"}
							<a
								class="anchor font-mono text-xs font-semibold"
								href={eventsPageHref(slot.event)}
								title="Open on the events page"
							>
								{slot.event}
							</a>
						{:else if col.key === "standing"}
							{#if slot.required}
								<span
									class="preset-tonal-primary rounded-full px-2 py-0.5 text-xs"
								>
									required
								</span>
							{:else if slot.open}
								<span
									class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs"
								>
									open
								</span>
							{:else}
								<span
									class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
								>
									optional
								</span>
							{/if}
						{:else if col.key === "candidates"}
							{#if slot.candidates.length}
								<span class="flex flex-wrap gap-1.5">
									{#each slot.candidates as c (c.slug)}
										<a
											class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs hover:underline"
											href="/admin/pipelines/{encodeURIComponent(
												c.slug
											)}"
											title={c.slug}
										>
											{c.name}
										</a>
									{/each}
								</span>
							{:else}
								<span class="text-surface-600-400 text-xs">
									nothing serves this yet
								</span>
							{/if}
						{/if}
					{/snippet}
				</AdminList>
			</section>

			<section class="flex flex-col gap-2">
				<div class="flex flex-wrap items-center gap-2">
					<h3 class="flex-1 text-base font-semibold">Presets</h3>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						disabled={!detail.presets.length}
						onclick={() => setAllPresets(true)}
					>
						Show all
					</button>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						disabled={!detail.presets.length}
						onclick={() => setAllPresets(false)}
					>
						Hide all
					</button>
					<a
						class="btn btn-sm preset-filled-primary-500"
						href="/admin/session-presets/new"
					>
						<Icons.Plus size={14} /> New preset
					</a>
				</div>
				<p class="text-surface-600-400 text-sm">
					A preset carries its pipelines, events and configurations
					together, so switching it off takes all of them out of the
					picker.
					{#if !genre.enabled}
						While the genre is off, none of them is offered,
						whatever its switch says.
					{/if}
				</p>
				<AdminList
					rows={detail.presets}
					columns={presetColumns}
					searchText={(p) => p.name}
					searchPlaceholder="Search presets…"
					defaultSort="name"
					storageKey="serene-pub:adminView:genrePresets"
					emptyMessage="No presets for this genre yet."
					onRowClick={(p) => goto(`/admin/session-presets/${p.id}`)}
				>
					{#snippet cell(p, col)}
						{#if col.key === "name"}
							<span class="font-semibold">{p.name}</span>
							{#if p.isDefault}
								<span
									class="preset-tonal-primary ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
								>
									default
								</span>
							{/if}
							{#if p.isImmutable}
								<span
									class="preset-tonal-surface ml-1 rounded-full px-1.5 py-0.5 text-[11px]"
								>
									built-in
								</span>
							{/if}
						{:else if col.key === "enabled"}
							<!-- The row navigates; the switch must not. -->
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<span
								onclick={(e) => e.stopPropagation()}
								onkeydown={(e) => e.stopPropagation()}
							>
								<Switch
									name="preset-enabled-{p.id}"
									checked={p.enabled}
									onCheckedChange={(e) =>
										setPresetEnabled(p.id, e.checked)}
									class="inline-flex items-center gap-2"
								>
									<Switch.Control class={SWITCH_CONTROL}>
										<Switch.Thumb />
									</Switch.Control>
									<Switch.Label class="text-xs">
										{p.enabled ? "offered" : "hidden"}
										<span class="sr-only">— {p.name}</span>
									</Switch.Label>
									<Switch.HiddenInput />
								</Switch>
							</span>
						{:else if col.key === "actions"}
							<a
								class="btn btn-sm preset-tonal-surface"
								href="/admin/session-presets/{p.id}"
								onclick={(e) => e.stopPropagation()}
							>
								<Icons.Pencil size={13} /> Edit
							</a>
						{/if}
					{/snippet}
				</AdminList>
			</section>

			{#if matrixSlots.length && detail.presets.length}
				<section
					class="flex flex-col gap-2"
					aria-labelledby="coverage-heading"
				>
					<h3 id="coverage-heading" class="text-base font-semibold">
						Coverage
					</h3>
					<p class="text-surface-600-400 text-sm">
						Which pipeline each preset runs for each event. To
						change one, edit the preset.
					</p>
					{#snippet coverageCell(c: Cell)}
						{#if c.kind === "bound"}
							<a
								class="anchor"
								href="/admin/pipelines/{encodeURIComponent(c.spec)}"
								title={c.spec}
							>
								{specName(c.spec)}
							</a>
							{#if c.stale}
								<span class="text-warning-600-400">· not installed</span>
							{/if}
						{:else if c.kind === "missing"}
							<span class="text-error-600-400">required, unbound</span>
						{:else}
							<span class="text-surface-600-400">—</span>
						{/if}
					{/snippet}
					<!-- The table needs ~700px of `content`; below that (the 400px
					     dock) each event reads as its own stacked block. -->
					<div
						class="panel-card hidden overflow-x-auto !p-0 @min-[700px]/content:block"
					>
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-surface-300-700 border-b">
									<th scope="col" class="px-3 py-2 {LEGEND}">
										Event
									</th>
									{#each detail.presets as p (p.id)}
										<th
											scope="col"
											class="px-3 py-2 {LEGEND} whitespace-nowrap"
										>
											<a
												class="anchor"
												href="/admin/session-presets/{p.id}"
											>
												{p.name}
											</a>
											{#if !p.enabled}
												<span
													class="text-surface-600-400 font-normal"
												>
													(hidden)
												</span>
											{/if}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each matrixSlots as s (s.event)}
									<tr
										class="border-surface-300-700 border-b last:border-0"
									>
										<th
											scope="row"
											class="px-3 py-2 font-mono text-xs font-medium"
										>
											<a
												class="anchor"
												href={eventsPageHref(s.event)}
											>
												{s.event}
											</a>
										</th>
										{#each detail.presets as p (p.id)}
											{@const c = cellOf(p, s)}
											<td
												class="px-3 py-2 text-xs whitespace-nowrap"
											>
												{@render coverageCell(c)}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<ul class="flex flex-col gap-2 @min-[700px]/content:hidden">
						{#each matrixSlots as s (s.event)}
							<li class="panel-card flex flex-col gap-2">
								<a
									class="anchor font-mono text-xs font-medium break-all"
									href={eventsPageHref(s.event)}
								>
									{s.event}
								</a>
								<dl class="flex flex-col gap-1.5">
									{#each detail.presets as p (p.id)}
										<div class="flex flex-col">
											<dt class={LEGEND}>
												<a
													class="anchor"
													href="/admin/session-presets/{p.id}">{p.name}</a
												>{#if !p.enabled}
													<span class="font-normal">
														(hidden)</span
													>{/if}
											</dt>
											<dd class="min-w-0 text-xs break-words">
												{@render coverageCell(cellOf(p, s))}
											</dd>
										</div>
									{/each}
								</dl>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section
				id="swaps"
				class="flex flex-col gap-2"
				aria-labelledby="swaps-heading"
			>
				<h3 id="swaps-heading" class="text-base font-semibold">
					Plugin swaps
				</h3>
				<p class="text-surface-600-400 text-sm">
					Steps a plugin offers as alternatives in this genre's
					pipelines. A switched-off swap contribution is not offered
					to any session, and a plugin's reinstall keeps your choice.
				</p>
				{#if swapGroups.length}
					{#each swapGroups as g (`${g.spec}#${g.node}`)}
						<div class="panel-card flex flex-col gap-2">
							<p class="text-sm">
								<a
									class="anchor font-medium"
									href="/admin/pipelines/{encodeURIComponent(
										g.spec
									)}"
								>
									{g.specName}
								</a>
								<span class="text-surface-600-400">· step</span>
								<span class="font-mono text-xs">{g.node}</span>
							</p>
							<ul class="flex flex-col gap-2">
								{#each g.rows as r (`${r.pluginId}#${r.definition}`)}
									<li>
										<Switch
											name="swap-{r.pluginId}-{r.definition}"
											checked={r.enabled}
											onCheckedChange={(e) =>
												setSwap(r, e.checked)}
											class="flex items-center justify-between gap-4"
										>
											<Switch.Label
												class="min-w-0 text-sm"
											>
												{r.name}
												<span
													class="text-surface-600-400 block text-xs"
												>
													from {r.pluginName}
												</span>
											</Switch.Label>
											<Switch.Control
												class={SWITCH_CONTROL}
											>
												<Switch.Thumb />
											</Switch.Control>
											<Switch.HiddenInput />
										</Switch>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				{:else}
					<p class="text-surface-600-400 text-sm">
						No installed plugin offers a swap for this genre's
						pipelines.
					</p>
				{/if}
			</section>

			<section class="panel-card">
				<p class={LEGEND}>Shape</p>
				<pre
					class="bg-surface-50-950 mt-2 overflow-x-auto rounded-[10px] p-2 font-mono text-[11px]">{JSON.stringify(
						genre.shape,
						null,
						2
					)}</pre>
			</section>
		</div>
	{/if}
</div>
