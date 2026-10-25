<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * The pipeline workspace (22, rebuilt): one pipeline — its steps, the
	 * values it runs with, its canvas, scripts, runs and versions.
	 *
	 * The page is a shell — the map, step list, and the tab panels live in
	 * `$lib/client/components/pipelines/workspace/` — and it owns exactly the
	 * things that have to be one thing: the draft (nothing writes until Save
	 * all, 22 §2.1), the seat's URL mirror (tab, step), and the socket wiring.
	 *
	 * It is the pipeline's change view (Django admin, STYLE-GUIDE §6.11):
	 * `AdminChangeForm` draws the trail, the header and the save row. Its
	 * settings are unsaved edits until Save (owner ruling 2026-10-02, "levers
	 * wait for Save").
	 *
	 * 🚧 **Named configurations are retired** (PLAN-layering R38, A20; lane 7,
	 * 2026-10-21): a pipeline's values come from one cascade — its declared
	 * defaults < the genre's defaults < a preset's changes < the session. What
	 * this page saves is **the genre's defaults** of every genre that
	 * registers the pipeline (`pipelines:setOptions` with no configuration);
	 * a preset changes them in Admin › Presets. ⏳ A pipeline nothing
	 * registers still reads the pub's own values, saved here the same way.
	 * **Where it runs** lists the genres and presets that register it.
	 */
	import { getContext, onMount, tick, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import {
		saveErrors,
		saveInSequence,
		saveSummary,
		type SaveStep
	} from "$lib/client/admin/sequentialSave"
	import { adminUnsavedEdits, adminGoto as goto, adminReplaceState as replaceState } from "$lib/client/admin/adminRouter.svelte"
	import { sameFormValue } from "$lib/client/forms/sameFormValue"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import PipelineConfigOptions from "$lib/client/components/pipelines/PipelineConfigOptions.svelte"
	import CanvasPanel from "$lib/client/components/pipelines/workspace/canvas/CanvasPanel.svelte"
	import {
		builderGroupsOf,
		builderStepsOf,
		optionsOf,
		portCardsOf
	} from "$lib/client/components/pipelines/settingsGroups"
	import PortCards from "$lib/client/components/pipelines/PortCards.svelte"
	import PipelineMap from "$lib/client/components/pipelines/workspace/PipelineMap.svelte"
	import StepList from "$lib/client/components/pipelines/workspace/StepList.svelte"
	import RunsPanel from "$lib/client/components/pipelines/workspace/RunsPanel.svelte"
	import VersionsPanel from "$lib/client/components/pipelines/workspace/VersionsPanel.svelte"
	import ChangesPanel, {
		type ChangeRow
	} from "$lib/client/components/pipelines/workspace/ChangesPanel.svelte"
	import PresetPanel from "$lib/client/components/pipelines/workspace/PresetPanel.svelte"
	import ScriptMap from "./ScriptMap.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import PanelTabStrip, {
		type PanelTab as PanelTabDef
	} from "$lib/client/components/panels/PanelTabStrip.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	const interest = getInterestContext()

	const slug = $derived(decodeURIComponent(page.params.slug ?? ""))

	let spec: Sockets.Pipelines.Detail.Response["spec"] | null = $state(null)
	let detail = $state<Sockets.Pipelines.NamespaceDetail | null>(null)
	let loading = $state(true)
	let selectedStep = $state<string | null>(null)
	/**
	 * An agent (settings group) picked instead of a step: the inspector shows
	 * its Receives and Carries out cards. Picking a step clears it.
	 */
	let selectedGroup = $state<string | null>(null)

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

	// The builder's steps, filed under the agent (settings group) each belongs
	// to — derived from the server's groups, never counted.
	const steps = $derived(detail ? builderStepsOf(detail.groups) : [])
	const active = $derived(
		steps.find((s) => s.key === selectedStep) ?? steps[0] ?? null
	)
	const agents = $derived(detail ? builderGroupsOf(detail.groups) : [])
	const activeGroup = $derived(
		selectedGroup
			? (agents.find((g) => g.key === selectedGroup) ?? null)
			: null
	)
	const stepHeadingOf = (key: string) =>
		steps.find((s) => s.key === key)?.heading
	/** The inspector's two cards — the agent's when one is picked, else the step's. */
	const portCards = $derived(
		activeGroup
			? portCardsOf(activeGroup, stepHeadingOf)
			: active
				? portCardsOf(active, stepHeadingOf)
				: null
	)
	const graph = $derived.by(() => (spec ? (spec.graph ?? null) : null))
	const activeVersion = $derived.by(() => {
		const versions = spec ? spec.versions : []
		return versions.find((v) => v.isActive) ?? null
	})

	function selectStep(key: string) {
		selectedStep = key
		selectedGroup = null
	}

	function selectGroup(key: string) {
		selectedGroup = key
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

	/** 🚧 Where it runs (lane 7): the genres and presets that register it. */
	let registeredIn = $state<Sockets.Pipelines.RegisteredIn.Place[]>([])

	/* ── wiring ─────────────────────────────────────────────────────── */

	const onDetail = (res: Sockets.Pipelines.Detail.Response) => {
		spec = res.spec ?? null
		loading = false
	}
	const onDetailError = (res: { error?: string }) => {
		loading = false
		if (res?.error) toaster.error({ title: res.error })
	}
	const onRegisteredIn = (res: Sockets.Pipelines.RegisteredIn.Response) => {
		if (res.slug === untrack(() => slug)) registeredIn = res.places ?? []
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
	})

	/**
	 * Everything this workspace reads, each key declared before the request
	 * that needs it goes out.
	 *
	 * `detail`, `registeredIn` and `runs` have one request site each and are
	 * asked for and listened for in one. All BARE: a pipeline workspace is not one session's anything.
	 *
	 * The app-wide interest context, not `adminInterest`: `pipelines:` is a
	 * MIXED family — most of its handlers answer every user — so these are
	 * ordinary keys, and the admin check here is the same one the redirect
	 * above makes. "sessions:genres" is asked for by the interest below.
	 *
	 * `slug` is read untracked: the original asked once, on mount, and
	 * re-pointing the request at a new slug without resetting this page's
	 * drafts is a change this conversion is not making.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const initialSlug = untrack(() => slug)
		const releases = [
			interest.declareInterest<"pipelines:detail:error">(
				"pipelines:detail:error",
				onDetailError
			),
			interest.requestWithInterest(
				"pipelines:registeredIn",
				{ slug: initialSlug },
				onRegisteredIn
			),
			interest.requestWithInterest(
				"pipelines:detail",
				{ slug: initialSlug },
				onDetail
			),
			interest.requestWithInterest(
				"pipelines:runs",
				{ limit: 100, specSlug: initialSlug },
				onRuns
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/**
	 * The genre list this workspace labels the spec with, asked for and listened
	 * for in one. BARE — the registry of types, not one session's anything.
	 *
	 * The app-wide interest context, not `adminInterest`: `sessions:` is not a
	 * restricted interest family, so this is an ordinary key, and the admin
	 * check is the same one the redirect above makes.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return interest.requestWithInterest("sessions:genres", {}, onModes)
	})

	/* ── the workspace tabs + URL state (22) ────────────────────────── */

	type Tab =
		| "configure"
		| "canvas"
		| "scripts"
		| "changes"
		| "runs"
		| "versions"
		| "preset"
	const TAB_IDS: Tab[] = [
		"configure",
		"canvas",
		"scripts",
		"changes",
		"runs",
		"versions",
		"preset"
	]
	const initialParams =
		typeof window !== "undefined"
			? new URLSearchParams(page.url.search)
			: new URLSearchParams()
	const urlTab = initialParams.get("tab")
	let tab = $state<Tab>(
		TAB_IDS.includes(urlTab as Tab) ? (urlTab as Tab) : "configure"
	)
	// ?step= wins over "first step" — onLoaded only fills selectedStep when it
	// is still empty, so seeding it here is enough for deep links.
	if (initialParams.get("step")) selectedStep = initialParams.get("step")
	if (initialParams.get("group")) selectedGroup = initialParams.get("group")
	/**
	 * ?option= (with ?step=): land on that option once the first view
	 * arrives — Admin › Scripts' *Where used* opens a chain this way.
	 */
	let urlOptionId: string | null = initialParams.get("option")

	/**
	 * The address bar mirrors the seat — tab and step — without
	 * touching history (replaceState): back/forward should leave the page,
	 * not replay every step click.
	 */
	$effect(() => {
		if (typeof window === "undefined") return
		const p = new URLSearchParams(page.url.search)
		if (tab === "configure") p.delete("tab")
		else p.set("tab", tab)
		if (selectedStep) p.set("step", selectedStep)
		else p.delete("step")
		if (selectedGroup) p.set("group", selectedGroup)
		else p.delete("group")
		// A landing, not a seat: once read it leaves the address. ⏳ `config`
		// named a configuration (retired, R38): an old link's is dropped.
		p.delete("option")
		p.delete("config")
		const q = p.toString()
		try {
			replaceState(q ? `?${q}` : page.url.pathname, {})
		} catch {
			// Router not ready yet (first tick) — the next change syncs it.
		}
	})

	/* ── the draft (22 §2.1): nothing writes until Save ─────────────── */

	let pending = $state<Record<string, unknown>>({})
	let pendingClears = $state<string[]>([])
	const optionCount = $derived(Object.keys(pending).length + pendingClears.length)
	const pendingCount = $derived(optionCount)

	/** The raw (un-overlaid) option row, for "was it truly overridden". */
	const rawOption = (id: string) =>
		(detail ? optionsOf(detail.groups) : []).find((o) => o.id === id)

	/**
	 * A value put back to what the pipeline holds is no edit: it leaves
	 * the draft rather than counting as a pending change (a slider dragged
	 * away and back, `"5"` typed over `5`).
	 */
	function draftSet(option: Sockets.Pipelines.Option, value: unknown) {
		pendingClears = pendingClears.filter((x) => x !== option.id)
		const raw = rawOption(option.id)
		if (raw && sameFormValue(value, raw.value)) {
			delete pending[option.id]
			return
		}
		pending[option.id] = value
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
		return step.options.filter(
			(o) => o.id in pending || pendingClears.includes(o.id)
		).length
	}

	/**
	 * The option edits in one request (22 §3): sets and clears together,
	 * answered — after the refreshed view — on the batch's own event. A
	 * refusal mid-batch stops it and names what landed; the edits stay, so
	 * Save again resends them (re-setting what landed changes nothing).
	 */
	function sendOptions() {
		const set = Object.entries($state.snapshot(pending)).map(([optionId, value]) => ({
			optionId,
			value
		}))
		const clear = [...pendingClears]
		return awaitReply({
			socket,
			event: "pipelines:setOptions",
			errorEvent: "pipelines:setOptions:error",
			// No configuration (retired, R38): the server writes the genre's
			// defaults of every genre that registers this pipeline.
			params: { slug, set, clear },
			match: (r) => r.slug === slug && r.configId == null,
			timeoutMs: 60_000
		}).then(
			() => {
				pending = {}
				pendingClears = []
			},
			(e: unknown) => {
				throw e
			}
		)
	}

	let saving = $state(false)
	let formErrors = $state<string[]>([])

	function land(intent: AdminSaveIntent) {
		if (intent === "save") void goto("/admin/pipelines")
	}

	async function save(intent: AdminSaveIntent) {
		if (saving) return
		formErrors = []
		if (!pendingCount) return land(intent)
		const steps: SaveStep[] = []
		if (optionCount) {
			const n = optionCount
			steps.push({
				label: `${n} setting${n === 1 ? "" : "s"}`,
				run: () => sendOptions()
			})
		}
		await finishSave(steps, intent)
	}

	async function finishSave(steps: SaveStep[], intent: AdminSaveIntent) {
		saving = true
		const outcome = await saveInSequence(steps)
		saving = false
		const name = spec?.name ?? slug
		if (outcome.refused.length || outcome.skipped.length) {
			formErrors = saveErrors(outcome)
			toaster.warning({ title: saveSummary(outcome, name) })
			return
		}
		toaster.success({ title: saveSummary(outcome, name) })
		land(intent)
	}

	/** Leaving with unsaved edits is asked about, through the Admin view's dialog. */
	adminUnsavedEdits(() => pendingCount > 0)

	/* ── the Changes rows (22 §2.2) ─────────────────────────────────── */

	const changeRows = $derived.by((): ChangeRow[] => {
		if (!detail) return []
		const out: ChangeRow[] = []
		for (const s of steps)
			for (const o of s.options) {
				const isPend = o.id in pending
				const isClear = pendingClears.includes(o.id)
				// `changed`, not `overriddenHere` (ruled 2026-09-10): this list
				// asks what the pipeline's values depart from its declared
				// defaults by. `overriddenHere` follows the write scope and
				// would start describing a session's overrides the day this
				// panel is opened from inside one.
				if (!o.changed && !isPend && !isClear) continue
				out.push({
					option: o,
					stepKey: s.key,
					agent: s.agent ?? "",
					stepLabel: s.heading,
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
		// Walks agent and step names as well as the settings' own.
		for (const s of steps)
			for (const o of s.options)
				if (
					o.label.toLowerCase().includes(q) ||
					(o.description ?? "").toLowerCase().includes(q) ||
					s.label.toLowerCase().includes(q)
				)
					out.push({ stepKey: s.key, stepLabel: s.label, option: o })
		return out.slice(0, 30)
	})

	/**
	 * A view arrived — from the Configure panel or the Scripts tab, which read
	 * the same `pipelines:get` view. The page keeps it, and the deep link
	 * (`?option=`) is applied once, then forgotten.
	 */
	function onConfigView(d: Sockets.Pipelines.NamespaceDetail) {
		detail = d
		const first = builderStepsOf(d.groups)[0]
		if (!selectedStep && first) selectedStep = first.key
		if (urlOptionId && selectedStep) {
			const optionId = urlOptionId
			urlOptionId = null
			void jumpToOption(selectedStep, optionId)
		}
	}

	/**
	 * From the Scripts tab: Configure mounts its own panel, which asks for the
	 * view afresh, so the landing waits for that view (`onConfigView`) rather
	 * than looking for a row that is not drawn yet.
	 */
	function openSeam(stepKey: string, optionId: string) {
		selectStep(stepKey)
		urlOptionId = optionId
		tab = "configure"
	}

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
		"text-surface-600-400 text-xs font-medium"

	const TABS: { id: Tab; label: string; icon: keyof typeof Icons }[] = [
		{ id: "configure", label: "Configure", icon: "SlidersHorizontal" },
		{ id: "canvas", label: "Canvas", icon: "Workflow" },
		{ id: "scripts", label: "Scripts", icon: "ScrollText" },
		{ id: "changes", label: "Changes", icon: "Diff" },
		{ id: "runs", label: "Runs", icon: "History" },
		{ id: "versions", label: "Versions", icon: "GitCommitHorizontal" },
		{ id: "preset", label: "Where it runs", icon: "Ticket" }
	]
	const workspaceTabs: PanelTabDef[] = $derived(
		TABS.map((t) => ({
			value: t.id,
			label: t.label,
			icon: Icons[t.icon] as any,
			count:
				t.id === "changes"
					? changeRows.length || undefined
					: t.id === "runs"
						? pipelineRuns.length || undefined
						: undefined
		}))
	)
</script>

<AdminChangeForm
	mode="change"
	title={spec?.name ?? slug}
	noun="pipeline"
	changelistHref="/admin/pipelines"
	changelistLabel="Pipelines"
	dirty={pendingCount > 0}
	{saving}
	canSave={pendingCount > 0 && !saving}
	addAnother={false}
	errors={formErrors}
	onSave={save}
>
	{#snippet headerExtra()}
			<p
				class="text-surface-600-400 flex flex-wrap items-center gap-1.5 font-mono text-xs"
			>
				<span class="truncate">
					{slug}{activeVersion ? ` · v${activeVersion.semver}` : ""}
				</span>
				<!-- The catalogue claims (23 §4), worn where the version is. -->
				{#if detail?.taxonomy?.zone}
					<Badge size="sm" class="font-sans">
						{detail.taxonomy.zone}
					</Badge>
				{/if}
				{#if detail?.taxonomy?.role}
					<span
						class="{detail.taxonomy.role === 'primary'
							? 'preset-tonal-primary'
							: detail.taxonomy.role === 'action'
								? 'preset-tonal-secondary'
								: detail.taxonomy.role === 'create'
									? 'preset-tonal-tertiary'
									: 'preset-tonal-surface'} rounded-full px-1.5 py-0.5 font-sans text-meta"
					>
						{detail.taxonomy.role}
					</span>
				{/if}
				{#if detail?.taxonomy?.role === "create" && detail?.taxonomy?.genre}
					<!-- A create pipeline is its genre's required member (24 §3). -->
					<a
						class="preset-tonal-primary rounded-full px-1.5 py-0.5 font-sans text-meta hover:underline"
						href="/admin/session-genres/{encodeURIComponent(
							detail.taxonomy.genre
						)}"
						title="This pipeline creates sessions of this genre"
					>
						genre: {genreNames.get(detail.taxonomy.genre) ??
							detail.taxonomy.genre}
					</a>
				{:else if detail?.taxonomy?.genre}
					<Badge size="sm" class="font-sans" title={detail.taxonomy.genre}>
						{genreNames.get(detail.taxonomy.genre) ??
							detail.taxonomy.genre}
					</Badge>
				{/if}
			</p>
			<!-- The workspace is a two-pane tool; in the dock it stacks and
			     still works, and this says where the room is. -->
			<p class="text-surface-600-400 text-chip @min-[700px]/content:hidden">
				Wider is easier: press the Focus button above.
			</p>
	{/snippet}
	{#snippet saveRowExtra()}
		{#if pendingCount}
			<span class="text-surface-600-400 text-xs">
				{pendingCount} change{pendingCount === 1 ? "" : "s"}
			</span>
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (tab = "changes")}>
				Review
			</button>
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={discardAll} disabled={saving}>
				Discard
			</button>
		{/if}
	{/snippet}

	{#if loading}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{:else if !spec}
		<p class="text-surface-600-400 text-sm">
			There is no pipeline called <code class="font-mono">{slug}</code>
			on this pub.
		</p>
	{:else}
		<!-- 🚧 Where its values come from (R38; lane 7): no configurations —
		     what this page saves is the genre's defaults of each genre that
		     registers it. -->
		<section class="panel-card flex flex-col gap-1" aria-label="Where its values come from" data-testid="pipeline-values-scope">
			<p class="text-sm">
				{#if registeredIn.some((p) => p.scope === "genre")}
					What you save here is the genre's defaults for
					{[...new Set(registeredIn.filter((p) => p.scope === "genre").map((p) => p.genreName))].join(", ")}.
					A preset changes them in Admin › Presets; a session's owner may change what the pipeline exposes.
				{:else if registeredIn.length}
					A preset registers this pipeline: what you save here is its genres' defaults, under each preset's own
					changes.
				{:else}
					Nothing registers this pipeline yet. What you save here is this pub's own values for it.
				{/if}
			</p>
			<button type="button" class="anchor self-start text-xs" onclick={() => (tab = "preset")}>Where it runs</button>
		</section>



		<!-- ── the workspace tabs (22) ───────────────────────────────── -->
		<!-- Six labelled tabs share the row. Below ~560px of `content` (the
		     400px dock) the icons drop so every label reads in full. -->
		<PanelTabStrip
			bind:value={tab}
			tabs={workspaceTabs}
			ariaLabel="Pipeline workspace sections"
			panelIdPrefix="pipeline-workspace"
			class="[&_[role=tab]>svg]:hidden @min-[560px]/content:[&_[role=tab]>svg]:block"
		/>
		<div
			id="pipeline-workspace-{tab}"
			role="tabpanel"
			aria-labelledby="pipeline-workspace-{tab}-tab"
			class="flex flex-col gap-4"
		>

		{#if tab === "configure"}
			<!-- ── configure toolbar: find a setting, choose the navigator ── -->
			<div class="flex flex-wrap items-center gap-2">
				<div class="relative max-w-md min-w-0 flex-1 basis-48">
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
							class="bg-surface-50-950 border-surface-200-800 absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-base border p-1"
						>
							{#each searchResults as r (r.option.id)}
								<button
									type="button"
									class="hover:bg-surface-200-800 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
									onclick={() =>
										jumpToOption(r.stepKey, r.option.id)}
								>
									<span class="min-w-0 flex-1 truncate">
										{r.option.label}
									</span>
									<span
										class="text-surface-600-400 shrink-0 text-xs"
									>
										{r.stepLabel}
									</span>
								</button>
							{/each}
						</div>
					{:else if optionQuery.trim()}
						<div
							class="bg-surface-50-950 border-surface-200-800 text-surface-600-400 absolute top-full right-0 left-0 z-30 mt-1 rounded-base border p-3 text-sm"
						>
							Nothing matches.
						</div>
					{/if}
				</div>

				<div
					class="border-surface-200-800 ml-auto flex overflow-hidden rounded-md border"
					role="group"
					aria-label="Step navigator"
				>
					<button
						type="button"
						class="btn btn-sm rounded-none {navView === 'list'
							? 'preset-pressed'
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
							? 'preset-pressed'
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
				<section
					aria-label="Steps"
					class="panel-card min-w-0 overflow-hidden !p-0"
				>
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
							class="border-surface-200-800 flex items-baseline gap-2 border-b px-3 py-2"
						>
							<span class={LEGEND}>Steps</span>
						</div>
						<StepList
							{steps}
							activeKey={activeGroup ? null : (active?.key ?? null)}
							activeGroup={activeGroup?.key ?? null}
							pendingFor={stepPendingByKey}
							onSelect={selectStep}
							onSelectGroup={selectGroup}
						/>
					{/if}
				</section>

				<!-- Sticky: the inspector is a reference surface; one that
				     scrolls away while you read the graph it belongs to is one
				     you keep scrolling back to. -->
				<section
					bind:this={inspectorEl}
					aria-label="Settings"
					class="min-w-0 scroll-mt-4 {sideBySide
						? 'sticky top-4'
						: ''}"
				>
					<div
						class="border-surface-200-800 mb-2 flex items-baseline gap-2 border-b pb-1"
					>
						<span class={LEGEND}>
							{activeGroup ? "Agent" : "Step configuration"}
						</span>
					</div>

					{#if activeGroup}
						<div class="mb-2 flex flex-col gap-0.5">
							<h2 class="text-lg font-semibold">
								{activeGroup.heading ?? "This pipeline"}
							</h2>
							{#if activeGroup.purpose}
								<FieldHelp>
									{activeGroup.purpose}
								</FieldHelp>
							{/if}
						</div>
					{:else if active}
						<div class="mb-2 flex items-baseline gap-2">
							<h2 class="text-lg font-semibold">
								{#if active.agent}
									<button
										type="button"
										class="hover:underline"
										title="Show what {active.agent} receives and carries out"
										onclick={() => selectGroup(active.group)}
									>
										{active.agent}</button
									> · {active.heading}
								{:else}
									{active.label}
								{/if}
							</h2>
						</div>
					{:else}
						<div
							class="panel-card text-surface-600-400 flex flex-col items-center gap-1 text-center text-sm"
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

					<PortCards cards={portCards} />

					{#if activeGroup}
						<p class="text-surface-600-400 text-sm">
							Pick a step for its settings.
						</p>
					{/if}

					<!-- Stays mounted while an agent is picked: it is what
					     loads the page's view (`onLoaded`). -->
					<div class:hidden={!!activeGroup}>

					<PipelineConfigOptions
						{slug}
						stepKey={active?.key}
						mode="builder"
						{pending}
						{pendingClears}
						onDraftSet={draftSet}
						onDraftClear={draftClear}
						onLoaded={onConfigView}
					/>
					</div>
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
		{:else if tab === "canvas"}
			<!-- The pipeline canvas (PLAN-pipeline-canvas-and-genre-authoring P1):
			     the line, the minimap and the drawer. Its Settings tab is this
			     page's draft, so a value changed there lands in the same save row. -->
			<CanvasPanel
				{slug}
				versions={spec?.versions ?? []}
				{graph}
				runs={pipelineRuns}
				{pending}
				{pendingClears}
				onDraftSet={draftSet}
				onDraftClear={draftClear}
				onLoaded={onConfigView}
			/>
		{:else if tab === "scripts"}
			<ScriptMap
				{slug}
				{detail}
				onLoaded={onConfigView}
				onJump={openSeam}
			/>
		{:else if tab === "changes"}
			<ChangesPanel
				rows={changeRows}
				onJump={jumpToOption}
				onQueueReset={draftClear}
			/>
		{:else if tab === "runs"}
			<FieldHelp>
				This pipeline's recent run receipts. A halt is not a failure —
				an aborted generation and an empty completion both halt, with
				the reason recorded.
			</FieldHelp>
			<RunsPanel runs={pipelineRuns} loading={runsLoading} />
		{:else if tab === "versions"}
			<VersionsPanel versions={spec.versions} />
		{:else if tab === "preset"}
			<PresetPanel {slug} places={registeredIn} />
		{/if}
		</div>
	{/if}

</AdminChangeForm>



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
</style>
