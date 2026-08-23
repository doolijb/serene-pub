<script lang="ts">
	/**
	 * One pipeline, and the configurations written against it.
	 *
	 * ## What this screen is for
	 *
	 * The sidebar is deliberately simple — it is for someone who does not need
	 * to know what a pipeline is, so it shows the prompt, the model, and puts
	 * everything else away. This is the other end of that trade: every setting
	 * the pipeline declares, granular, per node, with nothing hidden.
	 *
	 * ## Backbone and configuration
	 *
	 * The pipeline itself is the *backbone* — a fixed sequence of steps that a
	 * published version freezes. What people actually tune and keep is a
	 * **configuration**: a named set of values written against that backbone.
	 * So the flow on this page is a navigator, not the subject. Picking a step
	 * points the inspector at it; the configuration selector above decides
	 * which set of values the inspector is editing.
	 *
	 * That is also why New / Duplicate / Rename / Delete live here and not in
	 * the sidebar. Duplicating the configuration you like and changing one
	 * thing is the whole workflow, and until now there was no verb for it —
	 * every experiment was a destructive edit of the thing you were happy with.
	 *
	 * ## Two orientations, because two habits
	 *
	 * Vertical reads as a checklist and suits a narrow window; horizontal reads
	 * as a signal chain and suits a wide one. Neither is the "real" one, so the
	 * choice is remembered per browser rather than guessed from the viewport —
	 * a layout that reflows out from under you while you work is worse than one
	 * that is occasionally the wrong shape.
	 *
	 * ## Structural editing is still not here
	 *
	 * Swapping a node, reordering, publishing a new version — the lens view
	 * (05 §1–§5) — remains undrafted. This page may name topology where the
	 * sidebar may not (05 §0a), which is what lets it show the flow at all, but
	 * it still only *configures* the published backbone. The versions table
	 * below says what is actually published, and it is deliberately the last
	 * thing on the page rather than the first.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import PipelineConfigOptions from "$lib/client/components/pipelines/PipelineConfigOptions.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	const slug = $derived(decodeURIComponent(page.params.slug ?? ""))

	let spec: Sockets.Pipelines.Detail.Response["spec"] | null = $state(null)
	let detail = $state<Sockets.Pipelines.NamespaceDetail | null>(null)
	let loading = $state(true)
	let selectedStep = $state<string | null>(null)
	let showVersions = $state(false)

	/**
	 * How wide the workspace actually is, measured.
	 *
	 * Not a viewport breakpoint: this page sits inside a centre column whose
	 * width depends on which sidebars are open and whether the content is
	 * widened, so the window says almost nothing about the room this layout
	 * has. `lg:` would put the flow beside the inspector on a wide screen with
	 * both sidebars open — where the column is half of what the class assumed.
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

	type Orientation = "vertical" | "horizontal"
	let orientation = $state<Orientation>("vertical")

	/**
	 * Below this the graph and the rail cannot both be useful side by side.
	 *
	 * The graph is the subject and takes the remainder; the rail is a fixed
	 * accessory. So the threshold is "is there enough left over for a graph
	 * once the rail has its 25rem" rather than an even split.
	 */
	const RAIL = 400
	const SPLIT_AT = RAIL + 460
	const sideBySide = $derived(
		orientation === "vertical" && workspaceWidth >= SPLIT_AT
	)

	const ORIENTATION_KEY = "serene-pub:pipeline-builder-orientation"

	/**
	 * Remembered per browser. Wrapped because a private window, cleared site
	 * data, or a browser set to block storage all throw on access rather than
	 * returning nothing — and a layout preference is not worth a blank page.
	 */
	function rememberOrientation(next: Orientation) {
		orientation = next
		try {
			localStorage.setItem(ORIENTATION_KEY, next)
		} catch {}
	}

	const steps = $derived(detail?.steps ?? [])

	const active = $derived(
		steps.find((s) => s.key === selectedStep) ?? steps[0] ?? null
	)

	/**
	 * What a step is worth opening for: how many settings it declares, and
	 * whether any of them is set at this scope rather than inherited.
	 *
	 * The dot is the useful half. A flow of seven identical cards tells you
	 * nothing about where the work is; a flow where two of them are marked
	 * tells you exactly which parts of this configuration are yours.
	 */
	const countsFor = (step: Sockets.Pipelines.Step) => {
		const all = [...step.options, ...step.advanced]
		return {
			total: all.length,
			overridden: all.filter((o) => o.overriddenHere).length
		}
	}

	function selectStep(key: string) {
		selectedStep = key
	}

	/** Arrow keys walk the flow, in whichever direction it is drawn. */
	function onFlowKey(event: KeyboardEvent) {
		const forward = orientation === "vertical" ? "ArrowDown" : "ArrowRight"
		const back = orientation === "vertical" ? "ArrowUp" : "ArrowLeft"
		if (event.key !== forward && event.key !== back) return
		event.preventDefault()
		const i = steps.findIndex((s) => s.key === active?.key)
		const next = event.key === forward ? i + 1 : i - 1
		if (next >= 0 && next < steps.length) selectStep(steps[next].key)
	}

	/* ── the map ────────────────────────────────────────────────────── */

	type GraphNode = NonNullable<
		NonNullable<Sockets.Pipelines.Detail.Response["spec"]>["graph"]
	>["nodes"][number]

	// `$derived.by` with an explicit guard: a bare `spec?.graph` narrows `spec`
	// to `never` here, the same way `activeVersion` did.
	const graph = $derived.by(() => (spec ? (spec.graph ?? null) : null))

	/**
	 * The flow as rows, where a row is either one node or one block.
	 *
	 * Nodes arrive in position order and a block's members are contiguous
	 * within it, so a single pass is enough. Chains inside a block become
	 * columns — that is what "these run together" looks like — and a block with
	 * one chain still gets its frame, because `map` over one batch is still a
	 * map and drawing it as a plain node would hide that it repeats.
	 */
	type Row =
		| { kind: "node"; node: GraphNode }
		| {
				kind: "block"
				id: string
				blockKind: string
				chains: { chain: string; nodes: GraphNode[] }[]
		  }

	const rows = $derived.by((): Row[] => {
		const out: Row[] = []
		for (const node of graph?.nodes ?? []) {
			if (!node.blockId) {
				out.push({ kind: "node", node })
				continue
			}
			const last = out.at(-1)
			const block =
				last?.kind === "block" && last.id === node.blockId
					? last
					: (out.push({
							kind: "block",
							id: node.blockId,
							blockKind: node.blockKind ?? "async",
							chains: []
						}),
						out.at(-1) as Extract<Row, { kind: "block" }>)
			const chainKey = node.blockChain ?? ""
			const chain = block.chains.find((c) => c.chain === chainKey)
			if (chain) chain.nodes.push(node)
			else block.chains.push({ chain: chainKey, nodes: [node] })
		}
		return out
	})

	/** Node keys this node reads from — shown on the selected node only. */
	const feedsInto = (key: string) =>
		(graph?.edges ?? [])
			.filter((e) => e.to === key)
			.map((e) => e.from ?? e.fromBlock)
			.filter((v, i, a): v is string => !!v && a.indexOf(v) === i)

	const nodeIsActive = (n: GraphNode) =>
		!!n.stepKey && n.stepKey === active?.key

	const blockOf = (id: string) =>
		(graph?.blocks ?? []).find((b) => b.id === id)

	/** `gather` → `Gather`; the block's own id is the only name it has. */
	const humanizeBlockName = (id: string) =>
		id
			.split(".")
			.at(-1)!
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.replace(/^./, (c) => c.toUpperCase())

	const humanizeCamelLabel = (v: string) =>
		v
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.replace(/^./, (c) => c.toUpperCase())

	/** The counts line: how many lanes, and how many of them run at once. */
	const blockMeta = (id: string, fallbackKind: string, lanes: number) => {
		const b = blockOf(id)
		const kind = b?.kind ?? fallbackKind
		if (kind === "map")
			return [
				b?.over ? `over ${b.over}` : null,
				b?.max ? `max ${b.max}` : null
			]
				.filter(Boolean)
				.join(" · ")
		const at = b?.mode === "sequential" ? "in order" : `${lanes} at once`
		return `${lanes} ${lanes === 1 ? "lane" : "lanes"} · ${at}`
	}

	/**
	 * Which blocks are opened out in the flow.
	 *
	 * Collapsed by default, and that is the point. A block was expanded always,
	 * so the column had to be as wide as the widest one in the pipeline whether
	 * or not you were looking at it — four cards at 69px, or a flow column that
	 * changed width depending on which pipeline you opened. A block is one node
	 * in the flow until you ask it to be more.
	 *
	 * Selecting a block opens it too: the settings pane lists its members, and
	 * a list of things you cannot see in the flow is a worse answer than
	 * showing them.
	 */

	let expanded = $state<Record<string, boolean>>({})

	/**
	 * What the signal path adds up to, said once at the top.
	 *
	 * A count line answers "is this the small one or the big one" before any
	 * reading, which is the question a stack of cards makes you scroll to
	 * settle.
	 */
	const counts = $derived.by(() => {
		const nodes = graph?.nodes ?? []
		const blocks = graph?.blocks ?? []
		const lanes = new Set(
			nodes
				.filter((n) => n.blockId)
				.map((n) => `${n.blockId}/${n.blockChain}`)
		)
		return {
			steps: nodes.length,
			fanOuts: blocks.filter((b) => b.kind === "async").length,
			maps: blocks.filter((b) => b.kind === "map").length,
			lanes: lanes.size
		}
	})

	const countLine = $derived(
		[
			`${counts.steps} steps`,
			counts.fanOuts
				? `${counts.fanOuts} fan-out${counts.fanOuts === 1 ? "" : "s"}`
				: null,
			counts.maps
				? `${counts.maps} map${counts.maps === 1 ? "" : "s"}`
				: null,
			counts.lanes
				? `${counts.lanes} lane${counts.lanes === 1 ? "" : "s"}`
				: null
		]
			.filter(Boolean)
			.join(" · ")
	)

	/** The mockup's caption treatment, in one place so it cannot drift. */
	const LEGEND = "text-muted text-[10px] font-bold tracking-[.15em] uppercase"

	/**
	 * The narrowest a branch may get before the group scrolls instead.
	 *
	 * Branches share the pane equally above this; below it they stop shrinking
	 * and the group takes a scrollbar. Fixed-width branches were the earlier
	 * try, and four of them overflowed a 764px pane so the fourth was simply
	 * not there until you found the scrollbar.
	 */
	const LANE_MIN = 10

	/**
	 * The same floor, transposed.
	 *
	 * A horizontal spine forks *downward*: branches become rows, so what has to
	 * stop shrinking is their height. Taller than `LANE_MIN` is wide because a
	 * row carries its label above the cards rather than beside them.
	 */
	const LANE_MIN_ROW = 5

	const allBlockIds = $derived((graph?.blocks ?? []).map((b) => b.id))
	const anyCollapsed = $derived(allBlockIds.some((id) => !isOpen(id)))
	function setAllExpanded(open: boolean) {
		for (const id of allBlockIds) expanded[id] = open
	}

	/**
	 * What each colour means, from the kinds actually in this pipeline.
	 *
	 * Listing all seven regardless would explain a `tool` rail to somebody
	 * looking at a pipeline that has none.
	 */
	const KIND_MEANING: Record<string, string> = {
		input: "the trigger",
		query: "reads data",
		task: "transforms",
		provider: "calls a model",
		consumer: "writes data"
	}
	const legendKinds = $derived(
		[...new Set((graph?.nodes ?? []).map((n) => n.kind))].filter(
			(k) => k in KIND_MEANING
		)
	)
	const isOpen = (id: string) => expanded[id] ?? blockIsActive(id)

	const blockIsActive = (id: string) => {
		const k = blockOf(id)?.stepKey
		return !!k && k === active?.key
	}

	/** A block's own settings, counted like a node's so the badge matches. */
	const blockCounts = (id: string) => {
		const step = steps.find((s) => s.key === blockOf(id)?.stepKey)
		return step ? countsFor(step) : null
	}

	function selectNode(n: GraphNode) {
		if (n.stepKey) selectStep(n.stepKey)
	}

	/**
	 * Kind → a colour, carried as a stripe down the card's leading edge.
	 *
	 * The stripe rather than a tinted card: a wash of colour on every card
	 * makes a column of them read as decoration, while an edge reads as a
	 * key — and it leaves the card's own surface free to mean selected.
	 * Mapped onto the theme's palette rather than hex, so it follows a theme
	 * change instead of fighting one.
	 */
	const KIND_STRIPE: Record<string, string> = {
		input: "bg-surface-400-600",
		query: "bg-success-500",
		task: "bg-primary-500",
		provider: "bg-warning-500",
		consumer: "bg-error-500"
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
		const base = duplicate
			? `${selected?.name ?? "Configuration"} copy`
			: ""
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
		// A configuration can be pointed at by chats and users. Deleting it
		// does not break them — the selection falls back to the pipeline's
		// default — but that is exactly the kind of thing worth saying before
		// rather than after.
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
	 * A configuration you just made is the one you want to be editing.
	 *
	 * Creating it and leaving the selector on the old one means the very next
	 * thing you change lands in the configuration you were trying to leave
	 * alone — the exact accident duplicating exists to avoid. Same shape as the
	 * prompt clone flow: the handler answers with the new id, and the client
	 * selects it.
	 */
	const onConfigCreated = (res: Sockets.Pipelines.CreateConfig.Response) => {
		if (res.error || res.configId == null) return
		if (res.pipeline && res.pipeline.slug !== slug) return
		socket.emit("pipelines:selectConfig", { slug, configId: res.configId })
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		try {
			const saved = localStorage.getItem(ORIENTATION_KEY)
			if (saved === "vertical" || saved === "horizontal")
				orientation = saved
		} catch {}

		socket.on("pipelines:detail", onDetail)
		socket.on("pipelines:detail:error", onDetailError)
		socket.on("pipelines:createConfig", onConfigCreated)
		socket.on("pipelines:createConfig:error", onConfigError)
		socket.on("pipelines:renameConfig:error", onConfigError)
		socket.on("pipelines:deleteConfig:error", onConfigError)
		socket.emit("pipelines:detail", { slug })
	})

	onDestroy(() => {
		socket.off("pipelines:detail", onDetail)
		socket.off("pipelines:detail:error", onDetailError)
		socket.off("pipelines:createConfig", onConfigCreated)
		socket.off("pipelines:createConfig:error", onConfigError)
		socket.off("pipelines:renameConfig:error", onConfigError)
		socket.off("pipelines:deleteConfig:error", onConfigError)
	})

	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString() : "—"

	const activeVersion = $derived.by(() => {
		const versions = spec ? spec.versions : []
		return versions.find((v) => v.isActive) ?? null
	})
</script>

{#snippet stepCard(step: Sockets.Pipelines.Step, index: number)}
	{@const counts = countsFor(step)}
	{@const isActive = step.key === active?.key}
	<button
		type="button"
		class="group card flex w-full items-center gap-3 p-3 text-left transition-all
			{isActive
			? 'preset-filled-primary-500 shadow-lg'
			: 'preset-tonal hover:preset-tonal-primary'}
			{orientation === 'horizontal' ? 'min-w-[13rem]' : ''}"
		aria-current={isActive ? "step" : undefined}
		onclick={() => selectStep(step.key)}
	>
		<span
			class="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold
				{isActive ? 'preset-filled-surface-50-950' : 'preset-tonal-surface'}"
			aria-hidden="true"
		>
			{index + 1}
		</span>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-medium">{step.label}</span>
			<span class="flex items-center gap-1.5 text-xs opacity-70">
				{#if step.kind}
					<!--
						What the step *is*, not just what it is called.
						"Assemble" and "Generate text" read alike until you know
						one of them costs a model request.
					-->
					<span class="truncate font-mono">{step.kind}</span>
					<span aria-hidden="true">·</span>
				{/if}
				<span class="truncate">
					{counts.total}
					{counts.total === 1 ? "setting" : "settings"}
				</span>
			</span>
		</span>
		{#if counts.overridden}
			<span
				class="preset-filled-secondary-500 rounded-full px-2 py-0.5 text-[10px] font-semibold"
				title="{counts.overridden} set here, not inherited"
			>
				{counts.overridden}
			</span>
		{/if}
	</button>
{/snippet}

{#snippet mapNode(n: GraphNode)}
	{@const step = steps.find((s) => s.key === n.stepKey)}
	{@const counts = step ? countsFor(step) : null}
	<button
		type="button"
		disabled={!n.stepKey}
		title={n.stepKey
			? undefined
			: `${n.label} declares nothing to configure`}
		class="card border-surface-300-700 flex w-full items-stretch overflow-hidden border p-0 text-left transition-colors
			{nodeIsActive(n)
			? 'preset-filled-primary-500'
			: `bg-surface-50-950 ${n.stepKey ? 'hover:bg-surface-100-900' : 'opacity-55'}`}"
		aria-current={nodeIsActive(n) ? "step" : undefined}
		onclick={() => selectNode(n)}
	>
		<!-- The kind, as an edge rather than a wash: a column of tinted cards
		     reads as decoration, an edge reads as a key. -->
		<span
			aria-hidden="true"
			class="w-[3px] shrink-0 {KIND_STRIPE[n.kind] ??
				'bg-surface-400-600'}"
		></span>
		<span class="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2">
			<span class="min-w-0 flex-1">
				<!-- The badge rides with the name. Right-aligned in a 544px
				     card it detached from the thing it counts. -->
				<span class="flex min-w-0 items-center gap-2">
					<span class="truncate text-sm font-medium">{n.label}</span>
					{#if counts?.overridden}
						<span
							class="preset-filled-secondary-500 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
							title="{counts.overridden} set here, not inherited"
						>
							{counts.overridden} override{counts.overridden === 1
								? ""
								: "s"}
						</span>
					{/if}
				</span>
				<span class="flex items-center gap-1.5 text-xs opacity-70">
					<span class="truncate font-mono">{n.kind}</span>
					{#if counts}
						<span aria-hidden="true">·</span>
						<span class="truncate">{counts.total}</span>
					{/if}
				</span>
			</span>
			{#if n.toggleable}
				<span
					class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold
						{n.enabledDefault ? 'preset-tonal-surface' : 'preset-tonal-error'}"
					title={n.enabledDefault
						? "Optional — on by default"
						: "Optional — off by default"}
				>
					opt
				</span>
			{/if}
		</span>
	</button>
{/snippet}

{#snippet forkBar(count: number, kind: "fork" | "join")}
	<!--
		The split and the merge.
		
		Positioned with the same `calc` the branch grid uses, so the rule lands
		on branch centres whatever width the pane happens to give them. Fixed
		pitch was the earlier version and it broke the moment the branches
		stopped being a fixed size — which they had to, because four fixed
		branches did not fit and the fourth vanished behind a scrollbar.
	-->
	{@const cell = `(100% - ${count - 1}rem) / ${count}`}
	<!--
		Transposed for a horizontal spine rather than reused as-is. The two
		layouts are the same drawing rotated: a vertical spine forks sideways,
		so the rule spans the branches horizontally and each stub drops into a
		column; a horizontal spine forks downward, so the rule spans them
		vertically and each stub runs out into a row.

		Left un-transposed, the bars rendered in horizontal as a stray rule
		above the branches and a row of disconnected ticks below them —
		geometry for an axis the layout was no longer using.
	-->
	{#if orientation === "vertical"}
		<div class="relative h-4" aria-hidden="true">
			{#if count > 1}
				<div
					class="bg-surface-300-700 absolute h-px"
					style="left:calc({cell} / 2);right:calc({cell} / 2);{kind ===
					'fork'
						? 'top:0'
						: 'bottom:0'}"
				></div>
			{/if}
			{#each Array(count) as _, i (i)}
				<div
					class="bg-surface-300-700 absolute top-0 bottom-0 w-px"
					style="left:calc({cell} * {i} + {i}rem + {cell} / 2)"
				></div>
			{/each}
		</div>
	{:else}
		<div class="relative w-4 shrink-0" aria-hidden="true">
			{#if count > 1}
				<div
					class="bg-surface-300-700 absolute w-px"
					style="top:calc({cell} / 2);bottom:calc({cell} / 2);{kind ===
					'fork'
						? 'left:0'
						: 'right:0'}"
				></div>
			{/if}
			{#each Array(count) as _, i (i)}
				<div
					class="bg-surface-300-700 absolute right-0 left-0 h-px"
					style="top:calc({cell} * {i} + {i}rem + {cell} / 2)"
				></div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet connector()}
	<!-- Direction of travel. A stack of cards does not say "then". -->
	<div
		aria-hidden="true"
		class="flex shrink-0 items-center justify-center
			{orientation === 'vertical' ? 'h-4 w-full' : 'h-full w-4'}"
	>
		<svg
			class="text-surface-400-600"
			width={orientation === "vertical" ? 10 : 16}
			height={orientation === "vertical" ? 16 : 10}
			viewBox={orientation === "vertical" ? "0 0 10 16" : "0 0 16 10"}
			fill="none"
		>
			{#if orientation === "vertical"}
				<path
					d="M5 0 V11 M1.5 8 L5 12 L8.5 8"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{:else}
				<path
					d="M0 5 H11 M8 1.5 L12 5 L8 8.5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/if}
		</svg>
	</div>
{/snippet}

{#snippet flow()}
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
	<div
		role="tablist"
		aria-label="Pipeline steps"
		tabindex="-1"
		onkeydown={onFlowKey}
		class={orientation === "vertical"
			? "flex w-full flex-col"
			: "flex w-max items-stretch pb-2"}
	>
		{#each rows as row, i (row.kind === "node" ? row.node.key : row.id)}
			<!--
				The connector shares a container with the card it leads into, so
				the two centre on the same measure. They were siblings of the
				flow instead: the arrow centred on the pane's full width and the
				card on its 38rem measure, so the spine visibly stepped sideways
				at every card.
			-->
			<div
				class={orientation === "vertical"
					? `flex flex-col ${row.kind === "node" ? "w-full max-w-[38rem]" : "w-full"}`
					: "flex shrink-0 items-stretch"}
			>
				<!--
					The connector keeps the spine's measure even on a row that
					does not — a fork is wider than a card, and without this the
					arrow leading into one sat 65px right of every other arrow.
				-->
				{#if i > 0}
					<div
						class={orientation === "vertical"
							? "w-full max-w-[38rem]"
							: "flex shrink-0 items-center"}
					>
						{@render connector()}
					</div>
				{/if}

				{#if row.kind === "node"}
					<!--
						A single step keeps a measure — a card stretched across
						a wide pane is a long line to read. A fork does not: its
						width is whatever its branches need, which is why the
						cap is on the row and not on the spine.
					-->
					<div
						class={orientation === "horizontal"
							? "min-w-[12rem]"
							: ""}
					>
						{@render mapNode(row.node)}
					</div>
				{:else}
					{@const bCounts = blockCounts(row.id)}
					{@const open = isOpen(row.id)}
					{@const members = row.chains.flatMap((c) => c.nodes)}
					{@const n = row.chains.length}
					<!--
					A fork and a join, not a box with a list in it.

					The spine splits into one branch per lane, each running its
					own chain at its own length, and converges again below. That
					is the shape of the thing: four cards in a column read as
					four steps in sequence however they are labelled, and no
					amount of numbering or dividers undoes that.

					Branches keep a real width and the group scrolls sideways
					when there are more than fit — the failure the first attempt
					made was letting them share whatever the pane had left, so
					four came out at 69px each.
				-->
					<div class="flex flex-col">
						<div
							class="border-surface-300-700 flex items-stretch self-start rounded-md border border-l-2 {row.blockKind ===
							'async'
								? 'border-l-success-500'
								: 'border-l-tertiary-500'}"
						>
							<button
								type="button"
								class="px-2 opacity-70 hover:opacity-100"
								aria-expanded={open}
								aria-label={open
									? `Collapse ${row.blockKind} group`
									: `Expand ${row.blockKind} group, ${members.length} steps`}
								onclick={() => (expanded[row.id] = !open)}
							>
								<Icons.ChevronDown
									size={14}
									class="transition-transform {open
										? ''
										: '-rotate-90'}"
								/>
							</button>
							<button
								type="button"
								disabled={!blockOf(row.id)?.stepKey}
								class="flex min-w-0 items-center gap-2 rounded-r-md py-1.5 pr-3 text-left transition-colors
								{blockIsActive(row.id)
									? 'preset-filled-primary-500'
									: 'hover:preset-tonal-primary'}"
								aria-current={blockIsActive(row.id)
									? "step"
									: undefined}
								onclick={() => {
									const k = blockOf(row.id)?.stepKey
									if (k) selectStep(k)
								}}
							>
								<span class={LEGEND}>
									{row.blockKind === "async"
										? "Fan-out"
										: row.blockKind}
								</span>
								<span class="truncate text-xs font-semibold">
									{humanizeBlockName(row.id)}
								</span>
								<span class="text-muted shrink-0 text-[11px]">
									{blockMeta(row.id, row.blockKind, n)}
								</span>
								{#if bCounts?.overridden}
									<span
										class="preset-filled-secondary-500 rounded-full px-2 py-0.5 text-[10px] font-semibold"
									>
										{bCounts.overridden}
									</span>
								{/if}
							</button>
						</div>

						{#if open}
							<div class="overflow-x-auto">
								<!-- Capped with the branch grid, so the rules span
							     the branches rather than the pane. -->
								<div
									class={orientation === "vertical"
										? `flex min-w-full flex-col ${n === 1 ? "max-w-[38rem]" : ""}`
										: "flex items-stretch"}
								>
									{@render forkBar(n, "fork")}
									<!-- A grid so every branch is the same width by
								     construction, which is what lets the fork
								     rule be positioned arithmetically. -->
									<!-- A lone branch keeps the spine's measure:
								     stretched across the pane it read as a
								     different kind of thing from the steps
								     above and below it. -->
									<!--
									Rows rather than columns when the spine runs
									sideways. Still a grid, and for the same
									reason: equal tracks by construction are
									what let the fork rule be positioned
									arithmetically instead of measured.
								-->
									<div
										class={orientation === "vertical"
											? `grid items-stretch gap-4 ${n === 1 ? "max-w-[38rem]" : ""}`
											: "grid flex-1 items-stretch gap-4"}
										style={orientation === "vertical"
											? `grid-template-columns:repeat(${n}, minmax(${LANE_MIN}rem, 1fr))`
											: `grid-template-rows:repeat(${n}, minmax(${LANE_MIN_ROW}rem, auto))`}
									>
										{#each row.chains as c, li (c.chain)}
											<!--
											The label stays above the cards in
											both layouts — a branch name turned
											on its side is not a name anybody
											reads — so the branch is a column
											either way. What changes is the
											chain inside it, which has to run
											along the spine.
										-->
											<div
												class={orientation ===
												"vertical"
													? "flex min-w-0 flex-col"
													: "flex min-w-0 flex-col justify-center"}
											>
												<div
													class="mb-1 flex items-baseline gap-1.5"
												>
													<span
														class="text-muted font-mono text-[9px]"
													>
														{String(
															li + 1
														).padStart(2, "0")}
													</span>
													<span
														class="{LEGEND} truncate"
													>
														{humanizeCamelLabel(
															c.chain
														)}
													</span>
												</div>
												<!--
												`contents` in a vertical spine,
												so the cards stay direct
												children of the branch column
												and nothing about that layout
												moves. In a horizontal one they
												need a row of their own — and
												the tail line goes inside it,
												because `flex-1` has to grow
												along the spine while the branch
												itself is a column either way.
											-->
												<div
													class={orientation ===
													"vertical"
														? "contents"
														: "flex flex-1 items-center gap-2"}
												>
													{#if row.blockKind === "map"}
														<!--
													One declared node standing
													for many runs, drawn as a
													stack. It names the
													collection and states the
													ceiling without pretending
													to know the count — the
													actual number is not
													knowable until the run.
												-->
														<!--
													The under-layers are real
													elements, not `::before`
													with a negative z-index —
													that put them behind the
													pane's own background and
													they never showed.
												-->
														<div class="relative">
															<div
																aria-hidden="true"
																class="border-surface-300-700 bg-surface-200-800 absolute rounded border"
																style="inset:8px -10px -8px 10px"
															></div>
															<div
																aria-hidden="true"
																class="border-surface-300-700 bg-surface-200-800 absolute rounded border"
																style="inset:4px -5px -4px 5px"
															></div>
															<div
																class="relative"
															>
																{#each c.nodes as node, j (node.key)}
																	{#if j > 0}{@render connector()}{/if}
																	{@render mapNode(
																		node
																	)}
																{/each}
															</div>
														</div>
														<p
															class="text-muted mt-3 font-mono text-[10.5px]"
														>
															<span
																class="text-warning-500"
															>
																× one per {blockOf(
																	row.id
																)?.over ??
																	"item"}
															</span>
															{#if blockOf(row.id)?.max}
																· up to {blockOf(
																	row.id
																)?.max}
															{/if}
														</p>
													{:else}
														{#each c.nodes as node, j (node.key)}
															{#if j > 0}{@render connector()}{/if}
															{@render mapNode(
																node
															)}
														{/each}
													{/if}
													{#if orientation === "horizontal"}
														<!-- Out to the join. -->
														<div
															aria-hidden="true"
															class="bg-surface-300-700 h-px min-w-4 flex-1 self-center"
														></div>
													{/if}
												</div>
												{#if orientation === "vertical"}
													<!-- Down to the join. A short
												     branch gets a longer line,
												     which is what "these finish
												     at different times but
												     converge" looks like. -->
													<div
														aria-hidden="true"
														class="bg-surface-300-700 min-h-4 w-px flex-1 self-center"
													></div>
												{/if}
											</div>
										{/each}
									</div>
									{@render forkBar(n, "join")}
								</div>
							</div>
						{:else}
							<div
								class="flex flex-wrap items-center gap-1 py-2 pl-3"
							>
								{#each members as m (m.key)}
									<span
										aria-hidden="true"
										class="h-1.5 w-5 rounded-full {KIND_STRIPE[
											m.kind
										] ?? 'bg-surface-400-600'}"
									></span>
								{/each}
								<span class="text-muted ml-1 text-[11px]">
									{members.length}
									{members.length === 1 ? "step" : "steps"} collapsed
								</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		{#if !rows.length}
			<!-- Falls back rather than showing nothing: a version published
			     before the graph payload existed still has steps to configure. -->
			{#each steps as step, i (step.key)}
				{#if i > 0}{@render connector()}{/if}
				{@render stepCard(step, i)}
			{/each}
		{/if}
	</div>
{/snippet}

<div class="flex flex-col gap-4 p-4">
	<header class="flex flex-wrap items-center gap-3">
		<Icons.Workflow size={24} class="shrink-0" />
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-2xl font-semibold">
				{spec?.name ?? slug}
			</h1>
			<p class="text-muted truncate font-mono text-xs">
				{slug}{activeVersion ? ` · v${activeVersion.semver}` : ""}
			</p>
		</div>

		<!-- Labelled groups rather than a row of loose buttons: two segmented
		     controls with no captions leave the reader working out which pair
		     does what. -->
		<div class="flex flex-wrap items-end gap-5">
			<div class="flex flex-col gap-1">
				<span class={LEGEND}>Flow</span>
				<div
					class="border-surface-300-700 flex overflow-hidden rounded-md border"
					role="group"
					aria-label="Flow direction"
				>
					<button
						type="button"
						class="btn btn-sm rounded-none {orientation ===
						'vertical'
							? 'preset-filled-primary-500'
							: 'preset-tonal-surface'}"
						aria-pressed={orientation === "vertical"}
						title="Vertical — reads as a checklist"
						onclick={() => rememberOrientation("vertical")}
					>
						<Icons.Rows3 size={15} /> Vertical
					</button>
					<button
						type="button"
						class="btn btn-sm rounded-none {orientation ===
						'horizontal'
							? 'preset-filled-primary-500'
							: 'preset-tonal-surface'}"
						aria-pressed={orientation === "horizontal"}
						title="Horizontal — reads as a signal chain"
						onclick={() => rememberOrientation("horizontal")}
					>
						<Icons.Columns3 size={15} /> Horizontal
					</button>
				</div>
			</div>

			{#if allBlockIds.length}
				<div class="flex flex-col gap-1">
					<span class={LEGEND}>Lanes</span>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						onclick={() => setAllExpanded(anyCollapsed)}
					>
						{#if anyCollapsed}
							<Icons.ChevronsUpDown size={15} /> Expand all
						{:else}
							<Icons.ChevronsDownUp size={15} /> Collapse all
						{/if}
					</button>
				</div>
			{/if}
		</div>

		<a class="btn btn-sm preset-tonal-surface" href="/pipelines">
			<Icons.ArrowLeft size={16} /> Pipelines
		</a>
	</header>

	{#if loading}
		<p class="text-muted text-sm">Loading…</p>
	{:else if !spec}
		<p class="text-muted text-sm">
			There is no pipeline called <code class="font-mono">{slug}</code>
			on this instance.
		</p>
	{:else}
		<!-- ── configuration bar ─────────────────────────────────────── -->
		<section
			class="card preset-tonal flex flex-wrap items-end gap-2 p-3"
			aria-label="Configuration"
		>
			<label class="min-w-[14rem] flex-1">
				<span class="text-muted mb-1 block text-xs font-semibold">
					Configuration
				</span>
				<select
					class="select w-full"
					value={detail?.selectedConfig
						? String(detail.selectedConfig.id)
						: ""}
					onchange={(e) => chooseConfig(e.currentTarget.value)}
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
			<div class="card preset-tonal-primary flex flex-wrap gap-2 p-3">
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
			<div class="card preset-tonal-primary flex flex-wrap gap-2 p-3">
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

		<!-- ── backbone + inspector ──────────────────────────────────── -->
		<!--
			The pipeline is the subject. It takes the remaining width; the rail
			is a fixed accessory beside it. This was the other way round — a
			352px graph next to an 812px settings pane — which made the thing
			being configured the smaller half of its own editor.
		-->
		<div
			bind:this={workspaceEl}
			class="items-start gap-4 {sideBySide
				? 'grid grid-cols-[minmax(0,1fr)_25rem]'
				: 'flex flex-col'}"
		>
			<section
				aria-label="Steps"
				class="card bg-surface-100-900 border-surface-300-700 min-w-0 border"
			>
				<div
					class="border-surface-300-700 flex items-baseline gap-2 border-b px-3 py-2"
				>
					<span class={LEGEND}>Signal path</span>
					<span class="flex-1"></span>
					<span class="text-muted font-mono text-[10.5px]">
						{countLine}
					</span>
				</div>
				<!-- Scrolls sideways rather than reflowing: nesting depth and
				     the horizontal flow both need room the pane may not have,
				     and shrinking cards to fit is what made them unreadable. -->
				<div class="overflow-x-auto p-3">
					{@render flow()}
				</div>
			</section>

			<!-- Sticky: the rail is a reference surface, and a settings panel
			     that scrolls away while you read the graph it belongs to is a
			     panel you keep scrolling back to. -->
			<section
				aria-label="Settings"
				class="min-w-0 {sideBySide ? 'sticky top-4' : ''}"
			>
				<div
					class="border-surface-300-700 mb-2 flex items-baseline gap-2 border-b pb-1"
				>
					<span class={LEGEND}>Step configuration</span>
				</div>

				{#if !active}
					<!-- The panel keeps its position whether or not anything is
					     selected, so the fields always land in the same place
					     rather than the page reflowing around a selection. -->
					<div
						class="card preset-tonal text-muted flex flex-col items-center gap-1 p-8 text-center text-sm"
					>
						<Icons.MousePointerClick size={20} class="opacity-60" />
						<span class="text-base font-medium">
							No step selected
						</span>
						<span class="max-w-[40ch]">
							Pick any card in the signal path.
						</span>
					</div>
				{/if}

				{#if active}
					<div class="mb-2 flex items-baseline gap-2">
						<h2 class="text-lg font-semibold">{active.label}</h2>
						<span class="text-muted text-xs">
							step {steps.findIndex((s) => s.key === active.key) +
								1} of {steps.length}
						</span>
					</div>
				{/if}

				{#if selected?.readOnly}
					<!--
						A shipped configuration cannot be rewritten, so an edit
						here does not go into it — it becomes an override that
						applies whichever configuration is selected. That is a
						legitimate thing to want and a terrible thing to do by
						accident, so it is said plainly with the fix one click
						away, rather than left for someone to infer from a value
						that followed them somewhere they did not expect.
					-->
					<div
						class="card preset-tonal-warning mb-3 flex flex-col gap-2 p-3 text-sm"
					>
						<span class="flex min-w-0 items-start gap-2">
							<Icons.Lock size={16} class="mt-0.5 shrink-0" />
							<span class="min-w-0 flex-1">
								<strong>{selected.name}</strong>
								 is shipped with Serene Pub, so changes cannot be
								saved into it. Anything you change here becomes an
								instance-wide override that applies to every configuration.
							</span>
						</span>
						<button
							type="button"
							class="btn btn-sm preset-filled-primary-500"
							onclick={() => startNew(true)}
						>
							<Icons.Copy size={16} /> Duplicate to edit
						</button>
					</div>
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
					onLoaded={(d) => {
						detail = d
						if (!selectedStep && d.steps.length)
							selectedStep = d.steps[0].key
					}}
				/>

				{#if legendKinds.length}
					<div
						class="border-surface-300-700 mt-3 flex flex-col gap-1 border-t pt-2"
					>
						<span class={LEGEND}>Legend</span>
						{#each legendKinds as k (k)}
							<span class="flex items-center gap-2 text-xs">
								<span
									aria-hidden="true"
									class="h-3 w-[3px] shrink-0 rounded-full {KIND_STRIPE[
										k
									] ?? 'bg-surface-400-600'}"
								></span>
								<span class="font-medium">
									{humanizeCamelLabel(k)}
								</span>
								<span class="text-muted">
									{KIND_MEANING[k]}
								</span>
							</span>
						{/each}
					</div>
				{/if}
			</section>
		</div>

		<!-- ── what is actually published ────────────────────────────── -->
		<details class="card preset-tonal p-3" bind:open={showVersions}>
			<summary
				class="text-muted cursor-pointer text-sm font-semibold select-none"
			>
				Published versions ({spec.versions.length})
			</summary>
			<p class="text-muted mt-2 text-sm">
				Publishing moves a pointer; it never overwrites. A run in flight
				keeps the version it started on, so a receipt's claim to
				describe a particular version stays true.
			</p>
			<div class="mt-2 overflow-x-auto">
				<table class="table w-full text-sm">
					<thead>
						<tr>
							<th class="text-left">Version</th>
							<th class="text-left">Status</th>
							<th class="text-right">Nodes</th>
							<th class="text-left">Published</th>
							<th class="text-left">Canonical hash</th>
						</tr>
					</thead>
					<tbody>
						{#each spec.versions as v (v.id)}
							<tr>
								<td class="whitespace-nowrap">
									{v.semver}
									{#if v.isActive}
										<span
											class="preset-tonal-success ml-1 rounded-full px-2 py-0.5 text-xs"
										>
											active
										</span>
									{/if}
								</td>
								<td>{v.status}</td>
								<td class="text-right">{v.nodeCount}</td>
								<td class="whitespace-nowrap">
									{when(v.publishedAt)}
								</td>
								<td
									class="text-muted max-w-[14rem] truncate font-mono text-xs"
									title={v.canonicalHash}
								>
									{v.canonicalHash}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>

		<p class="text-muted flex items-start gap-2 text-xs">
			<Icons.Construction size={14} class="mt-0.5 shrink-0" />
			<span>
				Changing what a pipeline <em>does</em>
				 — swapping a node, reordering, publishing a new version — is the
				lens view and is not drafted yet. This page configures the published
				backbone.
			</span>
		</p>
	{/if}
</div>
