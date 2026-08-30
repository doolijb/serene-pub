<script lang="ts">
	/**
	 * The pipeline workspace (22, rebuilt): one pipeline, and the
	 * configurations written against it.
	 *
	 * The page is a shell now — the map, step list, and the tab panels live in
	 * `$lib/client/components/pipelines/workspace/` — and it owns exactly the
	 * things that have to be one thing: the draft (nothing writes until Save
	 * all, 22 §2.1), the configuration verbs (New / Duplicate / Rename /
	 * Delete), the seat's URL mirror (tab, step, configuration), and the
	 * socket wiring.
	 *
	 * The pipeline itself is the *backbone* — a fixed sequence a published
	 * version freezes. What people tune and keep is a **configuration**: a
	 * named set of values against that backbone. Shipped configurations
	 * refuse edits; Save all offers a copy instead. Structural editing —
	 * swapping a node, reordering, publishing — is the lens view (05 §1–§5)
	 * and remains undrafted: this page configures the published backbone.
	 */
	import { getContext, onDestroy, onMount, tick } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { beforeNavigate, goto, replaceState } from "$app/navigation"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import PipelineConfigOptions from "$lib/client/components/pipelines/PipelineConfigOptions.svelte"
	import PipelineMap from "$lib/client/components/pipelines/workspace/PipelineMap.svelte"
	import StepList from "$lib/client/components/pipelines/workspace/StepList.svelte"
	import RunsPanel from "$lib/client/components/pipelines/workspace/RunsPanel.svelte"
	import VersionsPanel from "$lib/client/components/pipelines/workspace/VersionsPanel.svelte"
	import ChangesPanel, {
		type ChangeRow
	} from "$lib/client/components/pipelines/workspace/ChangesPanel.svelte"
	import PresetPanel from "$lib/client/components/pipelines/workspace/PresetPanel.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	const slug = $derived(decodeURIComponent(page.params.slug ?? ""))

	let spec: Sockets.Pipelines.Detail.Response["spec"] | null = $state(null)
	let detail = $state<Sockets.Pipelines.NamespaceDetail | null>(null)
	let loading = $state(true)
	let selectedStep = $state<string | null>(null)

	/** Type names, so "mode: core:spec/create-chat" reads as "type: Chat". */
	let genreNames = $state<Map<string, string>>(new Map())
	const onModes = (res: Sockets.Sessions.Genres.Response) => {
		genreNames = new Map(res.genres.map((m) => [m.genreId, m.name]))
	}

	/**
	 * How wide the workspace actually is, measured — not a viewport
	 * breakpoint: this page sits inside a centre column whose width depends on
	 * which sidebars are open, so the window says almost nothing about the
	 * room this layout has.
	 */
	let workspaceEl = $state<HTMLElement | null>(null)
	let workspaceWidth = $state(0)
	$effect(() => {
		const el = workspaceEl
		if (!el || typeof ResizeObserver === "undefined") return
		const ro = new ResizeObserver(([entry]) => {
			workspaceWidth = Math.round(entry.contentRect.width)
		})
		ro.observe(el)
		return () => ro.disconnect()
	})

	const steps = $derived(detail?.steps ?? [])
	const active = $derived(
		steps.find((s) => s.key === selectedStep) ?? steps[0] ?? null
	)
	const graph = $derived.by(() => (spec ? (spec.graph ?? null) : null))
	const activeVersion = $derived.by(() => {
		const versions = spec ? spec.versions : []
		return versions.find((v) => v.isActive) ?? null
	})

	function selectStep(key: string) {
		selectedStep = key
	}

	/**
	 * A canvas click in the stacked layout selects a step whose inspector
	 * sits below the tall map — invisible, so the click reads as ignored.
	 * Bring the answer to the click.
	 */
	let inspectorEl = $state<HTMLElement | null>(null)
	function selectStepFromMap(key: string) {
		selectStep(key)
		if (!sideBySide)
			inspectorEl?.scrollIntoView({ behavior: "smooth", block: "start" })
	}

	/* ── configurations ─────────────────────────────────────────────── */

	let renaming = $state<{ id: number; name: string } | null>(null)
	let creating = $state<{ name: string; fromConfigId?: number } | null>(null)

	const selected = $derived(
		detail?.configs.find((c) => c.id === detail?.selectedConfig?.id) ?? null
	)

	function chooseConfig(value: string) {
		const configId = Number(value)
		if (!Number.isFinite(configId)) return
		socket.emit("pipelines:selectConfig", { slug, configId })
	}

	function startNew(duplicate: boolean) {
		const base = duplicate ? `${selected?.name ?? "Configuration"} copy` : ""
		creating = {
			name: base,
			...(duplicate && selected ? { fromConfigId: selected.id } : {})
		}
	}

	function commitNew() {
		if (!creating?.name.trim()) return
		socket.emit("pipelines:createConfig", {
			slug,
			name: creating.name.trim(),
			...(creating.fromConfigId != null
				? { fromConfigId: creating.fromConfigId }
				: {})
		})
		creating = null
	}

	function commitRename() {
		if (!renaming?.name.trim()) return
		socket.emit("pipelines:renameConfig", {
			slug,
			configId: renaming.id,
			name: renaming.name.trim()
		})
		renaming = null
	}

	function removeConfig() {
		if (!selected) return
		const ok = confirm(
			`Delete the configuration "${selected.name}"?\n\n` +
				`Anything currently using it falls back to this pipeline's ` +
				`default. This cannot be undone.`
		)
		if (!ok) return
		socket.emit("pipelines:deleteConfig", { slug, configId: selected.id })
	}

	/* ── wiring ─────────────────────────────────────────────────────── */

	const onDetail = (res: Sockets.Pipelines.Detail.Response) => {
		spec = res.spec ?? null
		loading = false
	}
	const onDetailError = (res: { error?: string }) => {
		loading = false
		if (res?.error) toaster.error({ title: res.error })
	}
	const onConfigError = (res: { error?: string }) => {
		if (res?.error) toaster.error({ title: res.error })
	}

	/**
	 * A configuration you just made is the one you want to be editing — the
	 * handler answers with the new id, and the client selects it.
	 */
	const onConfigCreated = (res: Sockets.Pipelines.CreateConfig.Response) => {
		if (res.error || res.configId == null) return
		if (res.pipeline && res.pipeline.slug !== slug) return
		socket.emit("pipelines:selectConfig", { slug, configId: res.configId })
		// The shipped-save path (22 §2.1): the draft was waiting for this
		// configuration to exist — land it there now.
		if (applyToCreated) {
			applyToCreated = false
			applyPending(res.configId)
		}
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("pipelines:detail", onDetail)
		socket.on("pipelines:detail:error", onDetailError)
		socket.on("pipelines:createConfig", onConfigCreated)
		socket.on("pipelines:createConfig:error", onConfigError)
		socket.on("pipelines:renameConfig:error", onConfigError)
		socket.on("pipelines:deleteConfig:error", onConfigError)
		socket.on("pipelines:setPresetActions:error", onConfigError)
		socket.on("pipelines:runs", onRuns)
		socket.on("pipelines:setOptions:error", onBatchError)
		socket.on("sessions:genres", onModes)
		socket.emit("pipelines:detail", { slug })
		socket.emit("pipelines:runs", { limit: 100 })
		socket.emit("sessions:genres", {})
	})

	onDestroy(() => {
		socket.off("pipelines:detail", onDetail)
		socket.off("pipelines:detail:error", onDetailError)
		socket.off("pipelines:createConfig", onConfigCreated)
		socket.off("pipelines:createConfig:error", onConfigError)
		socket.off("pipelines:renameConfig:error", onConfigError)
		socket.off("pipelines:deleteConfig:error", onConfigError)
		socket.off("pipelines:setPresetActions:error", onConfigError)
		socket.off("pipelines:runs", onRuns)
		socket.off("pipelines:setOptions:error", onBatchError)
		socket.off("sessions:genres", onModes)
	})

	/* ── the workspace tabs + URL state (22) ────────────────────────── */

	type Tab = "configure" | "changes" | "runs" | "versions" | "preset"
	const TAB_IDS: Tab[] = ["configure", "changes", "runs", "versions", "preset"]
	const initialParams =
		typeof window !== "undefined"
			? new URLSearchParams(window.location.search)
			: new URLSearchParams()
	const urlTab = initialParams.get("tab")
	let tab = $state<Tab>(
		TAB_IDS.includes(urlTab as Tab) ? (urlTab as Tab) : "configure"
	)
	// ?step= wins over "first step" — onLoaded only fills selectedStep when it
	// is still empty, so seeding it here is enough for deep links.
	if (initialParams.get("step")) selectedStep = initialParams.get("step")
	/** ?config= applied once, after the first view arrives. */
	let urlConfigId: number | null = Number(initialParams.get("config")) || null

	/**
	 * The address bar mirrors the seat — tab, step, configuration — without
	 * touching history (replaceState): back/forward should leave the page,
	 * not replay every step click.
	 */
	$effect(() => {
		if (typeof window === "undefined") return
		const p = new URLSearchParams(window.location.search)
		if (tab === "configure") p.delete("tab")
		else p.set("tab", tab)
		if (selectedStep) p.set("step", selectedStep)
		else p.delete("step")
		if (detail?.selectedConfig)
			p.set("config", String(detail.selectedConfig.id))
		const q = p.toString()
		try {
			replaceState(q ? `?${q}` : window.location.pathname, {})
		} catch {
			// Router not ready yet (first tick) — the next change syncs it.
		}
	})

	/* ── the draft (22 §2.1): nothing writes until Save ─────────────── */

	let pending = $state<Record<string, unknown>>({})
	let pendingClears = $state<string[]>([])
	const pendingCount = $derived(
		Object.keys(pending).length + pendingClears.length
	)

	/** The raw (un-overlaid) option row, for "was it truly overridden". */
	const rawOption = (id: string) =>
		detail?.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.id === id)

	function draftSet(option: Sockets.Pipelines.Option, value: unknown) {
		pending[option.id] = value
		pendingClears = pendingClears.filter((x) => x !== option.id)
	}

	function draftClear(option: Sockets.Pipelines.Option) {
		delete pending[option.id]
		// Only a value the server actually holds needs a clear write; dropping
		// a pending edit that never landed is just forgetting it.
		if (rawOption(option.id)?.overriddenHere) {
			if (!pendingClears.includes(option.id))
				pendingClears = [...pendingClears, option.id]
		}
	}

	function discardAll() {
		pending = {}
		pendingClears = []
	}

	/** Unsaved edits waiting on a step — the amber dot in both navigators. */
	const stepPendingByKey = (stepKey: string) => {
		const step = steps.find((s) => s.key === stepKey)
		if (!step) return 0
		return [...step.options, ...step.advanced].filter(
			(o) => o.id in pending || pendingClears.includes(o.id)
		).length
	}

	/**
	 * The whole draft in one request (22 §3): sets and clears together,
	 * answered with one refreshed view. A refusal mid-batch stops it and
	 * names what landed.
	 */
	function applyPending(configId?: number) {
		const n = pendingCount
		socket.emit("pipelines:setOptions", {
			slug,
			...(configId != null ? { configId } : {}),
			set: Object.entries(pending).map(([optionId, value]) => ({
				optionId,
				value
			})),
			clear: [...pendingClears]
		})
		pending = {}
		pendingClears = []
		toaster.success({
			title: `Saving ${n} change${n === 1 ? "" : "s"}…`
		})
	}

	const onBatchError = (res: Sockets.Pipelines.SetOptions.Response) => {
		if (res.error)
			toaster.error({
				title: "Save stopped by a refusal",
				description: `${res.applied ?? 0} change${
					(res.applied ?? 0) === 1 ? "" : "s"
				} landed before: ${res.error}`
			})
	}

	/** The shipped-configuration question, asked at save time (22 §2.1). */
	let shippedDialog = $state(false)
	let shippedNewName = $state("")
	/** Apply the draft into the configuration this id names, once it exists. */
	let applyToCreated = false

	function saveAll() {
		if (!pendingCount || !selected) return
		if (selected.readOnly) {
			shippedNewName = `${selected.name} copy`
			shippedDialog = true
			return
		}
		applyPending(selected.id)
	}

	function saveAsNewConfig() {
		if (!shippedNewName.trim() || !selected) return
		applyToCreated = true
		socket.emit("pipelines:createConfig", {
			slug,
			name: shippedNewName.trim(),
			fromConfigId: selected.id
		})
		shippedDialog = false
	}

	/** Leaving with a draft is asked about, same as the settings panels. */
	beforeNavigate((nav) => {
		if (!pendingCount) return
		if (
			!confirm(
				`You have ${pendingCount} unsaved change${
					pendingCount === 1 ? "" : "s"
				}. Leave without saving?`
			)
		)
			nav.cancel()
	})

	/** A different configuration is a different draft. */
	function chooseConfigGuarded(value: string) {
		if (
			pendingCount &&
			!confirm(
				`Switching configurations discards ${pendingCount} unsaved change${
					pendingCount === 1 ? "" : "s"
				}. Continue?`
			)
		)
			return
		discardAll()
		chooseConfig(value)
	}

	/* ── the Changes rows (22 §2.2) ─────────────────────────────────── */

	const changeRows = $derived.by((): ChangeRow[] => {
		if (!detail) return []
		const out: ChangeRow[] = []
		for (const s of detail.steps)
			for (const o of [...s.options, ...s.advanced]) {
				const isPend = o.id in pending
				const isClear = pendingClears.includes(o.id)
				if (!o.overriddenHere && !isPend && !isClear) continue
				out.push({
					option: o,
					stepKey: s.key,
					stepLabel: s.label,
					state: isClear
						? "pending-reset"
						: isPend
							? "pending"
							: "saved",
					current: isClear
						? (o.authorDefault ?? null)
						: isPend
							? pending[o.id]
							: o.value
				})
			}
		return out
	})

	/* ── find a setting (22 §2.3) ───────────────────────────────────── */

	let optionQuery = $state("")
	const searchResults = $derived.by(() => {
		const q = optionQuery.trim().toLowerCase()
		if (!q || !detail) return []
		const out: {
			stepKey: string
			stepLabel: string
			option: Sockets.Pipelines.Option
		}[] = []
		for (const s of detail.steps)
			for (const o of [...s.options, ...s.advanced])
				if (
					o.label.toLowerCase().includes(q) ||
					(o.description ?? "").toLowerCase().includes(q) ||
					o.facet.toLowerCase().includes(q)
				)
					out.push({ stepKey: s.key, stepLabel: s.label, option: o })
		return out.slice(0, 30)
	})

	/** Land on the exact option: right tab, right step, scrolled and lit. */
	async function jumpToOption(stepKey: string, optionId: string) {
		tab = "configure"
		selectStep(stepKey)
		optionQuery = ""
		await tick()
		const el = document.querySelector(`[data-option-id="${optionId}"]`)
		if (el instanceof HTMLElement) {
			el.scrollIntoView({ block: "center", behavior: "smooth" })
			el.classList.add("option-flash")
			setTimeout(() => el.classList.remove("option-flash"), 1600)
		}
	}

	/* ── runs (shared by the tab count and the panel) ───────────────── */

	type Run = Sockets.Pipelines.Runs.Response["runs"][number]
	let allRuns = $state<Run[]>([])
	let runsLoading = $state(true)
	const pipelineRuns = $derived(allRuns.filter((r) => r.specSlug === slug))
	const onRuns = (res: Sockets.Pipelines.Runs.Response) => {
		allRuns = res.runs
		runsLoading = false
	}

	/* ── nav view: compact list by default, the map on request ──────── */

	const NAV_VIEW_KEY = "serene-pub:pipeline-nav-view"
	let navView = $state<"list" | "map">("list")
	onMount(() => {
		try {
			const savedNav = localStorage.getItem(NAV_VIEW_KEY)
			if (savedNav === "list" || savedNav === "map") navView = savedNav
		} catch {}
	})
	function rememberNavView(next: "list" | "map") {
		navView = next
		try {
			localStorage.setItem(NAV_VIEW_KEY, next)
		} catch {}
	}

	/**
	 * Below this the map and the inspector cannot both be useful side by
	 * side: the map is the subject and takes the remainder; the inspector is
	 * a fixed accessory at 25rem.
	 */
	const SPLIT_AT = 400 + 460
	const sideBySide = $derived(navView === "map" && workspaceWidth >= SPLIT_AT)

	const LEGEND =
		"text-surface-600-400 text-[10px] font-bold tracking-[.15em] uppercase"

	const TABS: { id: Tab; label: string; icon: keyof typeof Icons }[] = [
		{ id: "configure", label: "Configure", icon: "SlidersHorizontal" },
		{ id: "changes", label: "Changes", icon: "Diff" },
		{ id: "runs", label: "Runs", icon: "History" },
		{ id: "versions", label: "Versions", icon: "GitCommitHorizontal" },
		{ id: "preset", label: "Used by", icon: "Ticket" }
	]
</script>

<div class="flex flex-col gap-4 p-4 pb-20">
	<header class="flex flex-wrap items-center gap-3">
		<Icons.Workflow size={24} class="shrink-0" />
		<div class="min-w-0 flex-1">
			<p class="text-surface-600-400 text-xs">
				<a href="/admin/pipelines" class="hover:underline">Pipelines</a>
				/ <strong>{spec?.name ?? slug}</strong>
			</p>
			<h1 class="truncate text-2xl font-semibold">
				{spec?.name ?? slug}
			</h1>
			<p
				class="text-surface-600-400 flex flex-wrap items-center gap-1.5 font-mono text-xs"
			>
				<span class="truncate">
					{slug}{activeVersion ? ` · v${activeVersion.semver}` : ""}
				</span>
				<!-- The catalogue claims (23 §4), worn where the version is. -->
				{#if detail?.taxonomy?.zone}
					<span
						class="preset-tonal-surface rounded-full px-1.5 py-0.5 font-sans text-[0.68rem]"
						>{detail.taxonomy.zone}</span
					>
				{/if}
				{#if detail?.taxonomy?.role}
					<span
						class="{detail.taxonomy.role === 'primary'
							? 'preset-tonal-primary'
							: detail.taxonomy.role === 'action'
								? 'preset-tonal-secondary'
								: detail.taxonomy.role === 'create'
									? 'preset-tonal-tertiary'
									: 'preset-tonal-surface'} rounded-full px-1.5 py-0.5 font-sans text-[0.68rem]"
						>{detail.taxonomy.role}</span
					>
				{/if}
				{#if detail?.taxonomy?.role === "create" && detail?.taxonomy?.genre}
					<!-- A create pipeline is its genre's required member (24 §3). -->
					<a
						class="preset-tonal-primary rounded-full px-1.5 py-0.5 font-sans text-[0.68rem] hover:underline"
						href="/admin/session-genres"
						title="This pipeline creates sessions of this genre"
					>
						genre: {genreNames.get(detail.taxonomy.genre) ??
							detail.taxonomy.genre}
					</a>
				{:else if detail?.taxonomy?.genre}
					<span
						class="preset-tonal-surface rounded-full px-1.5 py-0.5 font-sans text-[0.68rem]"
						title={detail.taxonomy.genre}
					>
						{genreNames.get(detail.taxonomy.genre) ??
							detail.taxonomy.genre}
					</span>
				{/if}
			</p>
		</div>
		<a class="btn btn-sm preset-tonal-surface" href="/admin/pipelines">
			<Icons.ArrowLeft size={16} /> Pipelines
		</a>
	</header>

	{#if loading}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{:else if !spec}
		<p class="text-surface-600-400 text-sm">
			There is no pipeline called <code class="font-mono">{slug}</code>
			on this instance.
		</p>
	{:else}
		<!-- ── configuration bar ─────────────────────────────────────── -->
		<section
			class="card preset-filled-surface-100-900 flex flex-wrap items-end gap-2 p-3"
			aria-label="Configuration"
		>
			<label class="min-w-[14rem] flex-1">
				<span class="text-surface-600-400 mb-1 block text-xs font-semibold">
					Configuration
				</span>
				<select
					class="select w-full"
					value={detail?.selectedConfig
						? String(detail.selectedConfig.id)
						: ""}
					onchange={(e) => chooseConfigGuarded(e.currentTarget.value)}
				>
					{#each detail?.configs ?? [] as c (c.id)}
						<option value={String(c.id)}>
							{c.isDefault ? "★ " : ""}{c.name}{c.readOnly
								? " (shipped)"
								: ""}
						</option>
					{/each}
				</select>
			</label>

			<div class="flex flex-wrap items-center gap-1">
				<button
					type="button"
					class="btn btn-sm preset-tonal-primary"
					onclick={() => startNew(false)}
				>
					<Icons.Plus size={16} /> New
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					disabled={!selected}
					title="Copy this configuration, values and all"
					onclick={() => startNew(true)}
				>
					<Icons.Copy size={16} /> Duplicate
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					disabled={!selected || selected.readOnly}
					title={selected?.readOnly
						? "Shipped configurations keep their name"
						: "Rename"}
					onclick={() =>
						selected &&
						(renaming = { id: selected.id, name: selected.name })}
				>
					<Icons.Pencil size={16} /> Rename
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					disabled={!selected || selected.readOnly}
					title={selected?.readOnly
						? "Shipped configurations stay — duplicate one instead"
						: "Delete"}
					onclick={removeConfig}
				>
					<Icons.Trash2 size={16} /> Delete
				</button>
			</div>
		</section>

		{#if creating}
			<div class="card preset-filled-surface-100-900-primary flex flex-wrap gap-2 p-3">
				<label class="min-w-[14rem] flex-1">
					<span class="mb-1 block text-xs font-semibold">
						{creating.fromConfigId != null
							? "Name for the copy"
							: "Name the new configuration"}
					</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="input w-full"
						autofocus
						bind:value={creating.name}
						onkeydown={(e) => e.key === "Enter" && commitNew()}
					/>
				</label>
				<div class="flex items-end gap-1">
					<button
						class="btn btn-sm preset-filled-primary-500"
						onclick={commitNew}
					>
						Create
					</button>
					<button
						class="btn btn-sm preset-tonal-surface"
						onclick={() => (creating = null)}
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}

		{#if renaming}
			<div class="card preset-filled-surface-100-900-primary flex flex-wrap gap-2 p-3">
				<label class="min-w-[14rem] flex-1">
					<span class="mb-1 block text-xs font-semibold">
						Rename configuration
					</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="input w-full"
						autofocus
						bind:value={renaming.name}
						onkeydown={(e) => e.key === "Enter" && commitRename()}
					/>
				</label>
				<div class="flex items-end gap-1">
					<button
						class="btn btn-sm preset-filled-primary-500"
						onclick={commitRename}
					>
						Save
					</button>
					<button
						class="btn btn-sm preset-tonal-surface"
						onclick={() => (renaming = null)}
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}

		<!-- ── the workspace tabs (22) ───────────────────────────────── -->
		<nav
			class="border-surface-300-700 flex flex-wrap gap-1 border-b pb-1"
			aria-label="Pipeline workspace sections"
		>
			{#each TABS as t (t.id)}
				{@const TabIcon = Icons[t.icon] as any}
				<button
					type="button"
					class="btn btn-sm {tab === t.id
						? 'preset-filled-primary-500'
						: 'preset-tonal-surface'}"
					aria-pressed={tab === t.id}
					onclick={() => (tab = t.id)}
				>
					<TabIcon size={15} />
					{t.label}
					{#if t.id === "changes" && changeRows.length}
						<span
							class="{tab === 'changes'
								? 'preset-filled-surface-50-950'
								: 'preset-tonal-secondary'} rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold"
						>
							{changeRows.length}
						</span>
					{:else if t.id === "runs" && pipelineRuns.length}
						<span
							class="{tab === 'runs'
								? 'preset-filled-surface-50-950'
								: 'preset-tonal-surface'} rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold"
						>
							{pipelineRuns.length}
						</span>
					{/if}
				</button>
			{/each}
		</nav>

		{#if tab === "configure"}
			<!-- ── configure toolbar: find a setting, choose the navigator ── -->
			<div class="flex flex-wrap items-center gap-2">
				<div class="relative max-w-md min-w-48 flex-1">
					<Icons.Search
						size={14}
						class="text-surface-600-400 absolute top-1/2 left-2.5 -translate-y-1/2"
					/>
					<input
						class="input pl-8 text-sm"
						placeholder="Find a setting across every step…"
						bind:value={optionQuery}
						aria-label="Find a setting"
					/>
					{#if searchResults.length}
						<div
							class="card bg-surface-100-900 absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto p-1 shadow-xl"
						>
							{#each searchResults as r (r.option.id)}
								<button
									type="button"
									class="hover:preset-tonal-primary flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
									onclick={() =>
										jumpToOption(r.stepKey, r.option.id)}
								>
									<span class="min-w-0 flex-1 truncate">
										{r.option.label}
									</span>
									<span
										class="text-surface-600-400 shrink-0 text-xs"
									>
										{r.stepLabel} · {r.option.facet}
									</span>
								</button>
							{/each}
						</div>
					{:else if optionQuery.trim()}
						<div
							class="card bg-surface-100-900 text-surface-600-400 absolute top-full right-0 left-0 z-30 mt-1 p-3 text-sm shadow-xl"
						>
							Nothing matches.
						</div>
					{/if}
				</div>

				<div
					class="border-surface-300-700 ml-auto flex overflow-hidden rounded-md border"
					role="group"
					aria-label="Step navigator"
				>
					<button
						type="button"
						class="btn btn-sm rounded-none {navView === 'list'
							? 'preset-filled-primary-500'
							: 'preset-tonal-surface'}"
						aria-pressed={navView === "list"}
						title="Compact step list"
						onclick={() => rememberNavView("list")}
					>
						<Icons.List size={15} /> List
					</button>
					<button
						type="button"
						class="btn btn-sm rounded-none {navView === 'map'
							? 'preset-filled-primary-500'
							: 'preset-tonal-surface'}"
						aria-pressed={navView === "map"}
						title="The full signal-path map"
						onclick={() => rememberNavView("map")}
					>
						<Icons.Network size={15} /> Map
					</button>
				</div>
			</div>

			<!-- ── backbone + inspector ──────────────────────────────────
			     List mode gives the inspector the width (the rail is a
			     navigator); map mode gives the map the width (the map is
			     the subject there). -->
			<div
				bind:this={workspaceEl}
				class="items-start gap-4 {navView === 'list'
					? workspaceWidth >= 720
						? 'grid grid-cols-[17rem_minmax(0,1fr)]'
						: 'flex flex-col'
					: sideBySide
						? 'grid grid-cols-[minmax(0,1fr)_25rem]'
						: 'flex flex-col'}"
			>
				<section aria-label="Steps" class="card preset-filled-surface-100-900 min-w-0">
					{#if navView === "map"}
						<PipelineMap
							{graph}
							{steps}
							activeKey={active?.key ?? null}
							pendingFor={stepPendingByKey}
							onSelect={selectStepFromMap}
						/>
					{:else}
						<div
							class="border-surface-300-700 flex items-baseline gap-2 border-b px-3 py-2"
						>
							<span class={LEGEND}>Steps</span>
						</div>
						<StepList
							{steps}
							activeKey={active?.key ?? null}
							pendingFor={stepPendingByKey}
							onSelect={selectStep}
						/>
					{/if}
				</section>

				<!-- Sticky: the inspector is a reference surface; one that
				     scrolls away while you read the graph it belongs to is one
				     you keep scrolling back to. -->
				<section
					bind:this={inspectorEl}
					aria-label="Settings"
					class="min-w-0 scroll-mt-4 {sideBySide ? 'sticky top-4' : ''}"
				>
					<div
						class="border-surface-300-700 mb-2 flex items-baseline gap-2 border-b pb-1"
					>
						<span class={LEGEND}>Step configuration</span>
					</div>

					{#if active}
						<div class="mb-2 flex items-baseline gap-2">
							<h2 class="text-lg font-semibold">{active.label}</h2>
							<span class="text-surface-600-400 text-xs">
								step {steps.findIndex(
									(s) => s.key === active.key
								) + 1} of {steps.length}
							</span>
						</div>
					{:else}
						<div
							class="card preset-filled-surface-100-900 text-surface-600-400 flex flex-col items-center gap-1 p-8 text-center text-sm"
						>
							<Icons.MousePointerClick
								size={20}
								class="opacity-60"
							/>
							<span class="text-base font-medium">
								No step selected
							</span>
							<span class="max-w-[40ch]">
								Pick any card in the signal path.
							</span>
						</div>
					{/if}

					{#if selected?.readOnly}
						<p
							class="text-surface-600-400 mb-2 flex items-center gap-1.5 text-xs"
						>
							<Icons.Lock size={12} class="shrink-0" />
							<span>
								<strong>{selected.name}</strong> is shipped —
								Save all will ask where your changes land.
							</span>
						</p>
					{/if}
					<PipelineConfigOptions
						{slug}
						stepKey={active?.key}
						granular
						showConfigPicker={false}
						showScopeNote={false}
						editsConfigId={selected && !selected.readOnly
							? selected.id
							: undefined}
						{pending}
						{pendingClears}
						onDraftSet={draftSet}
						onDraftClear={draftClear}
						onLoaded={(d) => {
							detail = d
							if (!selectedStep && d.steps.length)
								selectedStep = d.steps[0].key
							// ?config= deep link: applied once, then forgotten.
							if (
								urlConfigId != null &&
								d.selectedConfig?.id !== urlConfigId &&
								d.configs.some((c) => c.id === urlConfigId)
							) {
								const id = urlConfigId
								urlConfigId = null
								socket.emit("pipelines:selectConfig", {
									slug,
									configId: id
								})
							} else {
								urlConfigId = null
							}
						}}
					/>
				</section>
			</div>

			<p class="text-surface-600-400 flex items-start gap-2 text-xs">
				<Icons.Construction size={14} class="mt-0.5 shrink-0" />
				<span>
					Changing what a pipeline <em>does</em>
					— swapping a node, reordering, publishing a new version — is
					the lens view and is not drafted yet. This page configures the
					published backbone.
				</span>
			</p>
		{:else if tab === "changes"}
			<ChangesPanel
				rows={changeRows}
				onJump={jumpToOption}
				onQueueReset={draftClear}
			/>
		{:else if tab === "runs"}
			<p class="text-surface-600-400 text-sm">
				This pipeline's recent run receipts. A halt is not a failure — an
				aborted generation and an empty completion both halt, with the
				reason recorded.
			</p>
			<RunsPanel runs={pipelineRuns} loading={runsLoading} />
		{:else if tab === "versions"}
			<VersionsPanel versions={spec.versions} />
		{:else if tab === "preset"}
			<PresetPanel {slug} {detail} {selected} />
		{/if}
	{/if}
</div>

<!-- ── the draft bar: sticky, on every tab (22 §2.1) ──────────────────
     A draft off-screen is a draft forgotten; the bar rides the bottom of the
     viewport whichever tab is open, and nothing writes until Save all. -->
{#if pendingCount}
	<div
		class="draft-bar card preset-filled-surface-100-900-warning flex items-center gap-2 px-3 py-2 shadow-lg"
		role="status"
	>
		<Icons.CircleDot size={15} class="shrink-0" />
		<span class="text-sm font-semibold">
			{pendingCount} pending change{pendingCount === 1 ? "" : "s"}
		</span>
		<button
			class="btn btn-sm preset-tonal-surface"
			onclick={() => (tab = "changes")}
		>
			Review
		</button>
		<button class="btn btn-sm preset-filled-primary-500" onclick={saveAll}>
			<Icons.Save size={14} /> Save all
		</button>
		<button class="btn btn-sm preset-tonal-surface" onclick={discardAll}>
			Discard
		</button>
	</div>
{/if}

<!-- ── the shipped-configuration question, at save time (22 §2.1) ────── -->
{#if shippedDialog}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
	>
		<div
			class="card bg-surface-100-900 flex w-[28rem] max-w-full flex-col gap-3 p-4 shadow-xl"
			role="dialog"
			aria-label="Where should these changes land?"
		>
			<h3 class="text-base font-semibold">
				{selected?.name ?? "This configuration"} is shipped
			</h3>
			<p class="text-surface-600-400 text-sm">
				Shipped configurations stay as written — the server refuses edits
				into them. Your {pendingCount}
				change{pendingCount === 1 ? "" : "s"} land in a copy, which
				becomes the selected configuration:
			</p>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Name the new configuration</span>
				<input
					class="input"
					bind:value={shippedNewName}
					onkeydown={(e) => e.key === "Enter" && saveAsNewConfig()}
				/>
			</label>
			<button
				class="btn btn-sm preset-filled-primary-500"
				disabled={!shippedNewName.trim()}
				onclick={saveAsNewConfig}
			>
				<Icons.Copy size={14} /> Create and save there
			</button>
			<button
				class="btn btn-sm preset-tonal-surface"
				onclick={() => (shippedDialog = false)}
			>
				Cancel
			</button>
		</div>
	</div>
{/if}

<style>
	/* The landing flash for a search/diff jump (22 §2.3). */
	:global(.option-flash) {
		animation: option-flash 1.5s ease-out;
		border-radius: 0.375rem;
	}
	@keyframes option-flash {
		0%,
		40% {
			box-shadow: 0 0 0 2px var(--color-primary-500);
		}
		100% {
			box-shadow: 0 0 0 2px transparent;
		}
	}
	.draft-bar {
		position: fixed;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		max-width: calc(100vw - 2rem);
	}
</style>
