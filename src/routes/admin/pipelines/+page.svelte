<script lang="ts">
	/**
	 * The pipeline browser — a master-detail explorer over everything
	 * published on this instance.
	 *
	 * Three panes when the room exists, measured on this component (the admin
	 * shell's center pane, never the viewport): a facet rail (the catalogue
	 * cut, 23 §4 — session types, roles, sources, status), the filtered spec
	 * list, and a preview of the selected spec — identity, versions,
	 * structure, configurations, run health — with the workspace one click
	 * away. With nothing selected the preview shows the instance overview:
	 * totals and the recent-runs feed, which is the honest answer to "did
	 * that use the pipeline".
	 *
	 * Facets are declared metadata, never parsed from slugs; unclassified is
	 * shown and labelled, never hidden. Admin-only, checked here and again in
	 * every handler.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto, replaceState } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	type Pipeline = Sockets.Pipelines.Namespace
	type Run = Sockets.Pipelines.Runs.Response["runs"][number]

	let list: Pipeline[] = $state([])
	let runs: Run[] = $state([])
	let loading = $state(true)

	/** genreId → display name (24 §3). */
	let genreNames = $state<Map<string, string>>(new Map())
	const onModes = (res: Sockets.Sessions.Genres.Response) => {
		genreNames = new Map(res.genres.map((m) => [m.genreId, m.name]))
	}

	/* ── selection + its detail ─────────────────────────────────────── */

	const initialParams =
		typeof window !== "undefined"
			? new URLSearchParams(window.location.search)
			: new URLSearchParams()
	let selectedSlug = $state<string | null>(initialParams.get("spec"))

	let specDetail = $state<Sockets.Pipelines.Detail.Response["spec"] | null>(
		null
	)
	let configDetail = $state<Sockets.Pipelines.NamespaceDetail | null>(null)
	let detailLoading = $state(false)

	const selected = $derived(
		list.find((p) => p.slug === selectedSlug) ?? null
	)

	function select(slug: string | null) {
		selectedSlug = selectedSlug === slug ? null : slug
		specDetail = null
		configDetail = null
		if (selectedSlug) {
			detailLoading = true
			socket.emit("pipelines:detail", { slug: selectedSlug })
			socket.emit("pipelines:get", { slug: selectedSlug })
		}
	}

	const onDetail = (res: Sockets.Pipelines.Detail.Response) => {
		if (res.spec?.slug !== selectedSlug) return
		specDetail = res.spec ?? null
		detailLoading = false
	}
	const onGet = (res: Sockets.Pipelines.Get.Response) => {
		if (res.pipeline?.slug !== selectedSlug) return
		configDetail = res.pipeline ?? null
	}

	/** The address bar mirrors the seat, without touching history. */
	$effect(() => {
		if (typeof window === "undefined") return
		const p = new URLSearchParams(window.location.search)
		if (selectedSlug) p.set("spec", selectedSlug)
		else p.delete("spec")
		const q = p.toString()
		try {
			replaceState(q ? `?${q}` : window.location.pathname, {})
		} catch {}
	})

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("pipelines:list", (res: Sockets.Pipelines.List.Response) => {
			list = res.pipelinesList
			loading = false
		})
		socket.on("pipelines:runs", (res: Sockets.Pipelines.Runs.Response) => {
			runs = res.runs
		})
		socket.on("pipelines:detail", onDetail)
		socket.on("pipelines:get", onGet)
		socket.on("sessions:genres", onModes)
		socket.emit("pipelines:list", {})
		socket.emit("pipelines:runs", { limit: 300 })
		socket.emit("sessions:genres", {})
		// A ?spec= deep link fetches its preview immediately.
		if (selectedSlug) {
			detailLoading = true
			socket.emit("pipelines:detail", { slug: selectedSlug })
			socket.emit("pipelines:get", { slug: selectedSlug })
		}
	})

	onDestroy(() => {
		socket.off("pipelines:list")
		socket.off("pipelines:runs")
		socket.off("pipelines:detail", onDetail)
		socket.off("pipelines:get", onGet)
		socket.off("sessions:genres", onModes)
	})

	/* ── the facets (23 §4): claims, never parsed slugs ─────────────── */

	const ROLE_ORDER: Record<string, number> = {
		create: 0,
		primary: 1,
		action: 2,
		maintenance: 3
	}

	let typeFilter = $state<string | null>(null)
	let roleFilter = $state<string | null>(null)
	let sourceFilter = $state<string | null>(null)
	let statusFilter = $state<"enabled" | "disabled" | null>(null)
	let query = $state("")

	/** The genre a spec serves — a declared claim, never parsed (24 §3). */
	const typeOf = (p: Pipeline) => p.taxonomy?.genre ?? null

	/**
	 * The publisher's namespace — the one classification the id itself
	 * carries by construction ("core:…", "acme.plugin:…").
	 */
	const sourceOf = (p: Pipeline) => p.slug.split(":")[0] || "unknown"

	const typeName = (id: string) => genreNames.get(id) ?? id

	const types = $derived(
		[...new Set(list.map(typeOf).filter(Boolean))] as string[]
	)
	const roles = $derived(
		(
			[
				...new Set(list.map((p) => p.taxonomy?.role ?? "unclassified"))
			] as string[]
		).sort((a, b) => (ROLE_ORDER[a] ?? 9) - (ROLE_ORDER[b] ?? 9))
	)
	const sources = $derived([...new Set(list.map(sourceOf))].sort())

	const matches = (p: Pipeline) =>
		(!typeFilter || typeOf(p) === typeFilter) &&
		(!roleFilter || (p.taxonomy?.role ?? "unclassified") === roleFilter) &&
		(!sourceFilter || sourceOf(p) === sourceFilter) &&
		(!statusFilter ||
			(statusFilter === "enabled" ? p.enabled : !p.enabled)) &&
		(!query.trim() ||
			`${p.name} ${p.slug} ${p.event ?? ""}`
				.toLowerCase()
				.includes(query.trim().toLowerCase()))

	const filtered = $derived(
		[...list].filter(matches).sort((a, b) => {
			const r =
				(ROLE_ORDER[a.taxonomy?.role ?? ""] ?? 9) -
				(ROLE_ORDER[b.taxonomy?.role ?? ""] ?? 9)
			return r !== 0 ? r : a.name.localeCompare(b.name)
		})
	)

	const countBy = (pred: (p: Pipeline) => boolean) =>
		list.filter(pred).length

	const anyFilter = $derived(
		!!(typeFilter || roleFilter || sourceFilter || statusFilter)
	)
	function clearFilters() {
		typeFilter = null
		roleFilter = null
		sourceFilter = null
		statusFilter = null
	}

	/* ── run health ─────────────────────────────────────────────────── */

	/** The last N outcomes for a slug, newest first (runs arrive desc). */
	const healthFor = (slug: string, n = 5) =>
		runs.filter((r) => r.specSlug === slug).slice(0, n)

	const okCount = $derived(runs.filter((r) => r.outcome === "ok").length)
	const enabledCount = $derived(list.filter((p) => p.enabled).length)

	const when = (iso: string) => new Date(iso).toLocaleString()
	const whenShort = (iso: string) =>
		new Date(iso).toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit"
		})

	/* ── layout: measured, never viewport ───────────────────────────── */

	let rootEl = $state<HTMLElement | null>(null)
	let width = $state(0)
	$effect(() => {
		const el = rootEl
		if (!el || typeof ResizeObserver === "undefined") return
		const ro = new ResizeObserver(([entry]) => {
			width = Math.round(entry.contentRect.width)
		})
		ro.observe(el)
		return () => ro.disconnect()
	})
	const threePane = $derived(width >= 1060)
	const twoPane = $derived(width >= 720 && width < 1060)
	const narrow = $derived(width > 0 && width < 720)

	const ROLE_CHIP: Record<string, string> = {
		create: "preset-tonal-tertiary",
		primary: "preset-tonal-primary",
		action: "preset-tonal-secondary",
		maintenance: "preset-tonal-surface"
	}

	const LEGEND =
		"text-surface-600-400 text-[10px] font-bold tracking-[.15em] uppercase"

	/* ── preview structure line ─────────────────────────────────────── */

	const structureLine = $derived.by(() => {
		const g = specDetail?.graph
		if (!g) return null
		const blocks = g.blocks ?? []
		const c = (kind: string) => blocks.filter((b) => b.kind === kind).length
		return [
			`${g.nodes.length} steps`,
			c("async") ? `${c("async")} fan-out${c("async") === 1 ? "" : "s"}` : null,
			c("map") ? `${c("map")} map${c("map") === 1 ? "" : "s"}` : null,
			c("loop") ? `${c("loop")} loop${c("loop") === 1 ? "" : "s"}` : null,
			c("route") ? `${c("route")} route${c("route") === 1 ? "" : "s"}` : null
		]
			.filter(Boolean)
			.join(" · ")
	})

	const activeVersion = $derived(
		specDetail?.versions.find((v) => v.isActive) ?? null
	)
</script>

{#snippet facetButton(
	label: string,
	count: number,
	on: boolean,
	toggle: () => void
)}
	<button
		type="button"
		class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors
			{on ? 'preset-filled-primary-500' : 'hover:preset-tonal-primary'}"
		aria-pressed={on}
		onclick={toggle}
	>
		<span class="min-w-0 flex-1 truncate">{label}</span>
		<span class="text-xs opacity-70">{count}</span>
	</button>
{/snippet}

{#snippet facets()}
	<div class="flex flex-col gap-4">
		{#if types.length}
			<div>
				<p class="{LEGEND} mb-1 px-2">Session genres</p>
				{#each types as t (t)}
					{@render facetButton(
						typeName(t),
						countBy((p) => typeOf(p) === t),
						typeFilter === t,
						() => (typeFilter = typeFilter === t ? null : t)
					)}
				{/each}
			</div>
		{/if}
		<div>
			<p class="{LEGEND} mb-1 px-2">Roles</p>
			{#each roles as r (r)}
				{@render facetButton(
					r,
					countBy((p) => (p.taxonomy?.role ?? "unclassified") === r),
					roleFilter === r,
					() => (roleFilter = roleFilter === r ? null : r)
				)}
			{/each}
		</div>
		{#if sources.length > 1}
			<div>
				<p class="{LEGEND} mb-1 px-2">Source</p>
				{#each sources as s (s)}
					{@render facetButton(
						s,
						countBy((p) => sourceOf(p) === s),
						sourceFilter === s,
						() => (sourceFilter = sourceFilter === s ? null : s)
					)}
				{/each}
			</div>
		{/if}
		<div>
			<p class="{LEGEND} mb-1 px-2">Status</p>
			{@render facetButton(
				"enabled",
				enabledCount,
				statusFilter === "enabled",
				() =>
					(statusFilter =
						statusFilter === "enabled" ? null : "enabled")
			)}
			{@render facetButton(
				"disabled",
				list.length - enabledCount,
				statusFilter === "disabled",
				() =>
					(statusFilter =
						statusFilter === "disabled" ? null : "disabled")
			)}
		</div>
		{#if anyFilter}
			<button
				class="text-surface-600-400 px-2 text-left text-xs underline"
				onclick={clearFilters}
			>
				Clear filters
			</button>
		{/if}
	</div>
{/snippet}

{#snippet healthDots(slug: string)}
	{@const h = healthFor(slug)}
	{#if h.length}
		<span
			class="flex items-center gap-0.5"
			title={h
				.map((r) => `${r.outcome} · ${whenShort(r.startedAt)}`)
				.join("\n")}
		>
			{#each h as r (r.runId)}
				<span
					class="size-1.5 rounded-full {r.outcome === 'ok'
						? 'bg-success-500'
						: 'bg-warning-500'}"
				></span>
			{/each}
		</span>
	{:else}
		<span class="text-surface-600-400 text-[10px]">no runs</span>
	{/if}
{/snippet}

{#snippet specRow(p: Pipeline)}
	{@const isSel = p.slug === selectedSlug}
	<button
		type="button"
		class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors
			{isSel ? 'preset-filled-primary-500' : 'hover:preset-tonal-primary'}"
		aria-pressed={isSel}
		onclick={() => select(p.slug)}
	>
		<span
			class="size-2 shrink-0 rounded-full {p.enabled
				? 'bg-success-500'
				: 'bg-surface-400-600'}"
			title={p.enabled ? "enabled" : "disabled"}
		></span>
		<span class="min-w-0 flex-1">
			<span class="flex items-center gap-2">
				<span class="truncate text-sm font-medium">{p.name}</span>
				{#if p.taxonomy?.role}
					<span
						class="{isSel
							? 'preset-filled-surface-50-950'
							: (ROLE_CHIP[p.taxonomy.role] ??
								'preset-tonal-surface')} shrink-0 rounded-full px-1.5 py-0.5 text-[0.62rem]"
					>
						{p.taxonomy.role}
					</span>
				{/if}
			</span>
			<span
				class="block truncate font-mono text-[11px] {isSel
					? 'opacity-80'
					: 'text-surface-600-400'}"
			>
				{p.slug} · v{p.version}
			</span>
		</span>
		<span class="shrink-0">{@render healthDots(p.slug)}</span>
	</button>
{/snippet}

{#snippet preview()}
	{#if !selected}
		<!-- The zero state: the instance overview. -->
		<div class="flex flex-col gap-3">
			<div class="grid grid-cols-2 gap-2">
				<div class="card preset-tonal p-3">
					<p class="{LEGEND}">Published</p>
					<p class="text-xl font-semibold">{list.length}</p>
				</div>
				<div class="card preset-tonal p-3">
					<p class="{LEGEND}">Enabled</p>
					<p class="text-xl font-semibold">
						{enabledCount} / {list.length}
					</p>
				</div>
				<div class="card preset-tonal col-span-2 p-3">
					<p class="{LEGEND}">Runs ok</p>
					<p class="text-xl font-semibold">
						{okCount} / {runs.length}
					</p>
				</div>
			</div>
			<div class="card preset-tonal p-3">
				<p class="{LEGEND} mb-2">Recent runs</p>
				{#if runs.length}
					<ul class="flex flex-col gap-1.5">
						{#each runs.slice(0, 12) as r (r.runId)}
							{@const p = list.find(
								(x) => x.slug === r.specSlug
							)}
							<li>
								<button
									type="button"
									class="hover:preset-tonal-primary flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs"
									onclick={() => select(r.specSlug)}
								>
									<span
										class="size-1.5 shrink-0 rounded-full {r.outcome ===
										'ok'
											? 'bg-success-500'
											: 'bg-warning-500'}"
									></span>
									<span class="min-w-0 flex-1 truncate">
										{p?.name ?? r.specSlug}
									</span>
									<span
										class="text-surface-600-400 shrink-0 whitespace-nowrap"
									>
										{whenShort(r.startedAt)}
									</span>
								</button>
							</li>
						{/each}
					</ul>
					<p class="text-surface-600-400 mt-2 text-[11px]">
						A session with no rows here was answered by the prompt
						builder — there is no third possibility.
					</p>
				{:else}
					<p class="text-surface-600-400 text-xs">
						No runs recorded yet.
					</p>
				{/if}
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#if narrow}
				<button
					class="btn btn-sm preset-tonal-surface self-start"
					onclick={() => select(null)}
				>
					<Icons.ArrowLeft size={14} /> All pipelines
				</button>
			{/if}

			<!-- identity -->
			<div class="card preset-tonal flex flex-col gap-2 p-3">
				<div class="flex items-start gap-2">
					<div class="min-w-0 flex-1">
						<h3 class="truncate text-base font-semibold">
							{selected.name}
						</h3>
						<p
							class="text-surface-600-400 truncate font-mono text-[11px]"
						>
							{selected.slug}
						</p>
					</div>
					{#if selected.enabled}
						<span
							class="preset-tonal-success shrink-0 rounded-full px-2 py-0.5 text-xs"
							>enabled</span
						>
					{:else}
						<span
							class="preset-tonal-warning shrink-0 rounded-full px-2 py-0.5 text-xs"
							>disabled</span
						>
					{/if}
				</div>
				<div class="flex flex-wrap items-center gap-1.5">
					{#if selected.taxonomy?.zone}
						<span
							class="preset-tonal-surface rounded-full px-1.5 py-0.5 text-[0.68rem]"
							>{selected.taxonomy.zone}</span
						>
					{/if}
					{#if selected.taxonomy?.role}
						<span
							class="{ROLE_CHIP[selected.taxonomy.role] ??
								'preset-tonal-surface'} rounded-full px-1.5 py-0.5 text-[0.68rem]"
							>{selected.taxonomy.role}</span
						>
					{/if}
					{#if selected.taxonomy?.role === "create" && selected.taxonomy?.genre}
						<a
							class="preset-tonal-primary rounded-full px-1.5 py-0.5 text-[0.68rem] hover:underline"
							href="/admin/session-genres"
							title="This pipeline creates sessions of this genre (24 §3)"
						>
							genre: {typeName(selected.taxonomy.genre)}
						</a>
					{:else if selected.taxonomy?.genre}
						<span
							class="preset-tonal-surface rounded-full px-1.5 py-0.5 text-[0.68rem]"
							title={selected.taxonomy.genre}
						>
							{typeName(selected.taxonomy.genre)}
						</span>
					{/if}
					{#if selected.event}
						<span
							class="text-surface-600-400 font-mono text-[0.68rem]"
							title="Trigger event"
						>
							on {selected.event}
						</span>
					{/if}
				</div>
				<div class="flex flex-wrap gap-1.5 pt-1">
					<a
						class="btn btn-sm preset-filled-primary-500"
						href="/admin/pipelines/{encodeURIComponent(
							selected.slug
						)}"
					>
						<Icons.Settings2 size={14} /> Open workspace
					</a>
					<a
						class="btn btn-sm preset-tonal-surface"
						href="/admin/pipelines/{encodeURIComponent(
							selected.slug
						)}?tab=runs"
					>
						<Icons.History size={14} /> Runs
					</a>
				</div>
			</div>

			{#if detailLoading}
				<p class="text-surface-600-400 text-sm">Loading…</p>
			{:else}
				<!-- versions + structure -->
				<div class="card preset-tonal flex flex-col gap-1.5 p-3">
					<p class="{LEGEND}">Published</p>
					<p class="text-sm">
						{#if activeVersion}
							<span class="font-mono font-semibold"
								>v{activeVersion.semver}</span
							>
							<span class="text-surface-600-400">
								active · {specDetail?.versions.length}
								version{specDetail?.versions.length === 1
									? ""
									: "s"}
								{#if activeVersion.publishedAt}
									· {when(activeVersion.publishedAt)}
								{/if}
							</span>
						{:else}
							<span class="text-surface-600-400"
								>No active version.</span
							>
						{/if}
					</p>
					{#if structureLine}
						<p class="text-surface-600-400 font-mono text-[11px]">
							{structureLine}
						</p>
					{/if}
					<a
						class="text-surface-600-400 text-xs underline"
						href="/admin/pipelines/{encodeURIComponent(
							selected.slug
						)}?tab=versions"
					>
						All versions
					</a>
				</div>

				<!-- configurations -->
				<div class="card preset-tonal flex flex-col gap-1.5 p-3">
					<p class="{LEGEND}">
						Configurations ({configDetail?.configs.length ?? "…"})
					</p>
					{#if configDetail}
						<ul class="flex flex-col gap-1">
							{#each configDetail.configs.slice(0, 8) as c (c.id)}
								<li
									class="flex items-center gap-1.5 text-sm"
								>
									{#if c.isDefault}
										<Icons.Star
											size={12}
											class="text-warning-500 shrink-0"
										/>
									{:else}
										<span class="w-3 shrink-0"></span>
									{/if}
									<a
										class="min-w-0 flex-1 truncate hover:underline"
										href="/admin/pipelines/{encodeURIComponent(
											selected.slug
										)}?config={c.id}"
									>
										{c.name}
									</a>
									{#if c.readOnly}
										<Icons.Lock
											size={11}
											class="text-surface-600-400 shrink-0"
										/>
									{/if}
									{#if !c.enabled}
										<span
											class="text-surface-600-400 shrink-0 text-[10px]"
											>hidden</span
										>
									{/if}
								</li>
							{/each}
						</ul>
						{#if configDetail.configs.length > 8}
							<p class="text-surface-600-400 text-xs">
								…and {configDetail.configs.length - 8} more.
							</p>
						{/if}
					{:else}
						<p class="text-surface-600-400 text-xs">Loading…</p>
					{/if}
				</div>

				<!-- run health -->
				<div class="card preset-tonal flex flex-col gap-1.5 p-3">
					<p class="{LEGEND}">Recent runs</p>
					{#if healthFor(selected.slug, 10).length}
						<ul class="flex flex-col gap-1">
							{#each healthFor(selected.slug, 10) as r (r.runId)}
								<li
									class="flex items-center gap-2 text-xs"
								>
									<span
										class="size-1.5 shrink-0 rounded-full {r.outcome ===
										'ok'
											? 'bg-success-500'
											: 'bg-warning-500'}"
									></span>
									<span class="min-w-0 flex-1 truncate">
										{r.outcome}{r.haltReason
											? ` · ${r.haltReason}`
											: ""}
									</span>
									<span
										class="text-surface-600-400 shrink-0 whitespace-nowrap"
									>
										{r.elapsedMs} ms · {whenShort(
											r.startedAt
										)}
									</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-surface-600-400 text-xs">
							No runs recorded for this pipeline yet.
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

<div bind:this={rootEl} class="flex flex-col gap-3">
	<header class="flex flex-wrap items-center gap-3">
		<div class="flex-1">
			<h2 class="flex items-center gap-2 text-lg font-semibold">
				<Icons.Workflow size={20} /> Pipelines
			</h2>
			<p class="text-surface-600-400 text-sm">
				Everything published on this instance. Scripts and plugins have
				their own admin sections.
			</p>
		</div>
		<a class="btn btn-sm preset-tonal-surface" href="/pipelines/library">
			<Icons.Library size={16} /> Library
		</a>
	</header>

	{#if loading}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{:else}
		{#if !threePane}
			<!-- The facet rail folds into chips when the room is not there. -->
			<div class="flex flex-wrap items-center gap-1.5">
				{#each types as t (t)}
					<button
						class="chip rounded-full px-2.5 py-1 text-xs {typeFilter ===
						t
							? 'preset-filled-primary-500'
							: 'preset-tonal-surface'}"
						onclick={() =>
							(typeFilter = typeFilter === t ? null : t)}
					>
						{typeName(t)}
					</button>
				{/each}
				{#if types.length}<span class="text-surface-600-400 px-0.5"
						>·</span
					>{/if}
				{#each roles as r (r)}
					<button
						class="chip rounded-full px-2.5 py-1 text-xs {roleFilter ===
						r
							? 'preset-filled-primary-500'
							: 'preset-tonal-surface'}"
						onclick={() =>
							(roleFilter = roleFilter === r ? null : r)}
					>
						{r}
					</button>
				{/each}
				{#if sources.length > 1}
					<select
						class="select w-auto py-1 text-xs"
						value={sourceFilter ?? ""}
						onchange={(e) =>
							(sourceFilter = e.currentTarget.value || null)}
						aria-label="Filter by source"
					>
						<option value="">any source</option>
						{#each sources as s (s)}
							<option value={s}>{s}</option>
						{/each}
					</select>
				{/if}
				{#if anyFilter}
					<button
						class="text-surface-600-400 text-xs underline"
						onclick={clearFilters}
					>
						clear
					</button>
				{/if}
			</div>
		{/if}

		<div
			class="items-start gap-4 {threePane
				? 'grid grid-cols-[13rem_minmax(0,1fr)_minmax(20rem,24rem)]'
				: twoPane
					? 'grid grid-cols-[minmax(0,1fr)_minmax(19rem,22rem)]'
					: 'flex flex-col'}"
		>
			{#if threePane}
				<aside
					class="card preset-tonal sticky top-4 max-h-[80vh] overflow-y-auto p-2"
					aria-label="Pipeline facets"
				>
					{@render facets()}
				</aside>
			{/if}

			{#if !narrow || !selectedSlug}
				<section
					class="card preset-tonal min-w-0 p-2"
					aria-label="Pipelines"
				>
					<div class="relative m-1 mb-2">
						<Icons.Search
							size={14}
							class="text-surface-600-400 absolute top-1/2 left-2.5 -translate-y-1/2"
						/>
						<input
							class="input pl-8 text-sm"
							placeholder="Search pipelines…"
							bind:value={query}
							aria-label="Search pipelines"
						/>
					</div>
					{#if filtered.length}
						<div class="flex flex-col gap-0.5">
							{#each filtered as p (p.slug)}
								{@render specRow(p)}
							{/each}
						</div>
					{:else if list.length}
						<p class="text-surface-600-400 p-3 text-sm">
							Nothing matches this cut —
							<button class="underline" onclick={clearFilters}>
								clear the filters</button
							>.
						</p>
					{:else}
						<p class="text-surface-600-400 p-3 text-sm">
							Nothing is published. Core publishes its own
							pipelines at startup, so an empty list usually means
							the type registry refused to sync — check the server
							log for a bootstrap warning.
						</p>
					{/if}
				</section>
			{/if}

			{#if !narrow || selectedSlug}
				<aside
					class="min-w-0 {threePane || twoPane
						? 'sticky top-4 max-h-[85vh] overflow-y-auto'
						: ''}"
					aria-label="Pipeline preview"
				>
					{@render preview()}
				</aside>
			{/if}
		</div>
	{/if}
</div>
