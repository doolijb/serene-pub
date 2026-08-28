<script lang="ts">
	/**
	 * The whole pipeline, drawn: every node, and every control-flow construct —
	 * fan-outs, maps, loops, routes — as forks, frames, stacks, and return
	 * edges. Extracted from the workspace page (22, rebuilt 23-era) so the map
	 * is one subject with one owner; the page composes it beside the inspector.
	 *
	 * The map owns its own presentation state: orientation (vertical reads as
	 * a checklist, horizontal as a signal chain — remembered per browser, never
	 * guessed from the viewport) and per-block expansion. Selection is the
	 * page's: clicking a node/block calls `onSelect` with its stepKey.
	 *
	 * This surface may name topology; the session sidebar may not (05 §0a).
	 */
	import * as Icons from "@lucide/svelte"

	type Graph = NonNullable<
		NonNullable<Sockets.Pipelines.Detail.Response["spec"]>["graph"]
	>
	type GraphNode = Graph["nodes"][number]
	type Orientation = "vertical" | "horizontal"

	interface Props {
		graph: Graph | null
		steps: Sockets.Pipelines.Step[]
		activeKey: string | null
		/** Unsaved-draft count for a step — the amber dot. */
		pendingFor: (stepKey: string) => number
		onSelect: (stepKey: string) => void
		/** Show the color/construct legend below the map. */
		legend?: boolean
	}

	let { graph, steps, activeKey, pendingFor, onSelect, legend = true }: Props =
		$props()

	/* ── remembered presentation ────────────────────────────────────── */

	const ORIENTATION_KEY = "serene-pub:pipeline-builder-orientation"
	let orientation = $state<Orientation>("vertical")
	$effect(() => {
		try {
			const saved = localStorage.getItem(ORIENTATION_KEY)
			if (saved === "vertical" || saved === "horizontal")
				orientation = saved
		} catch {}
	})
	function rememberOrientation(next: Orientation) {
		orientation = next
		try {
			localStorage.setItem(ORIENTATION_KEY, next)
		} catch {}
	}

	/** Open by default: the map exists to show the whole pipeline. */
	let expanded = $state<Record<string, boolean>>({})
	const isOpen = (id: string) => expanded[id] ?? true
	const allBlockIds = $derived((graph?.blocks ?? []).map((b) => b.id))
	const anyCollapsed = $derived(allBlockIds.some((id) => !isOpen(id)))
	function setAllExpanded(open: boolean) {
		for (const id of allBlockIds) expanded[id] = open
	}

	/* ── the flow as rows ───────────────────────────────────────────── */

	type Row =
		| { kind: "node"; node: GraphNode }
		| {
				kind: "block"
				id: string
				blockKind: string
				chains: { chain: string; nodes: GraphNode[] }[]
		  }

	// Nodes arrive in position order and a block's members are contiguous
	// within it, so a single pass is enough.
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

	const blockOf = (id: string) =>
		(graph?.blocks ?? []).find((b) => b.id === id)

	const countsFor = (step: Sockets.Pipelines.Step) => {
		const all = [...step.options, ...step.advanced]
		return {
			total: all.length,
			overridden: all.filter((o) => o.overriddenHere).length
		}
	}

	const nodeIsActive = (n: GraphNode) => !!n.stepKey && n.stepKey === activeKey
	const blockIsActive = (id: string) => {
		const k = blockOf(id)?.stepKey
		return !!k && k === activeKey
	}
	const blockCounts = (id: string) => {
		const step = steps.find((s) => s.key === blockOf(id)?.stepKey)
		return step ? countsFor(step) : null
	}

	function selectNode(n: GraphNode) {
		if (n.stepKey) onSelect(n.stepKey)
	}

	/* ── vocabulary ─────────────────────────────────────────────────── */

	/**
	 * A route branch's predicate, as the sentence its declaration is (20 §10):
	 * "when call = search" / "when hasText" / "otherwise".
	 */
	const routeWhen = (blockId: string, chain: string): string | null => {
		const r = blockOf(blockId)?.routes?.[chain]
		if (!r) return null
		if (r.default) return "otherwise"
		const subject = r.path ? r.path : "value"
		if (r.equals !== undefined)
			return `when ${subject} = ${JSON.stringify(r.equals)}`
		if (r.truthy) return `when ${subject}`
		return null
	}

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

	const BLOCK_LABEL: Record<string, string> = {
		async: "Fan-out",
		map: "For each",
		loop: "Loop",
		route: "Route"
	}

	const BLOCK_EDGE: Record<string, string> = {
		async: "border-l-success-500",
		map: "border-l-tertiary-500",
		loop: "border-l-warning-500",
		route: "border-l-secondary-500"
	}

	/** The counts line: what this construct does, said in its own terms. */
	const blockMeta = (id: string, fallbackKind: string, lanes: number) => {
		const b = blockOf(id)
		const kind = b?.kind ?? fallbackKind
		if (kind === "map")
			return [
				b?.over ? `over ${b.over}` : null,
				b?.max ? `up to ${b.max}×` : null,
				b?.mode === "sequential" ? "in order" : null
			]
				.filter(Boolean)
				.join(" · ")
		if (kind === "loop")
			return [
				b?.repeatWhile ? `while ${b.repeatWhile}` : "repeats",
				b?.max ? `up to ${b.max}×` : null,
				b?.mode === "sequential" ? "in order" : null
			]
				.filter(Boolean)
				.join(" · ")
		if (kind === "route")
			return [
				b?.on ? `on ${b.on}` : null,
				`${lanes} branch${lanes === 1 ? "" : "es"}`,
				"any subset may fire"
			]
				.filter(Boolean)
				.join(" · ")
		const at = b?.mode === "sequential" ? "in order" : `${lanes} at once`
		return `${lanes} ${lanes === 1 ? "lane" : "lanes"} · ${at}`
	}

	/**
	 * Kind → a colour, carried as a stripe down the card's leading edge — an
	 * edge reads as a key, a wash reads as decoration.
	 */
	const KIND_STRIPE: Record<string, string> = {
		input: "bg-surface-400-600",
		query: "bg-success-500",
		task: "bg-primary-500",
		provider: "bg-warning-500",
		consumer: "bg-error-500"
	}

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

	const BLOCK_MEANING: Record<string, string> = {
		async: "chains run side by side, results gathered",
		map: "runs its body once per item in a list",
		loop: "runs its body again until done (bounded)",
		route: "branches on a value — any subset may fire"
	}
	const legendBlocks = $derived(
		[...new Set((graph?.blocks ?? []).map((b) => b.kind))].filter(
			(k) => k in BLOCK_MEANING
		)
	)

	/* ── the count line ─────────────────────────────────────────────── */

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
			loops: blocks.filter((b) => b.kind === "loop").length,
			routes: blocks.filter((b) => b.kind === "route").length,
			lanes: lanes.size
		}
	})

	const countLine = $derived(
		[
			`${counts.steps} steps`,
			counts.fanOuts
				? `${counts.fanOuts} fan-out${counts.fanOuts === 1 ? "" : "s"}`
				: null,
			counts.maps ? `${counts.maps} map${counts.maps === 1 ? "" : "s"}` : null,
			counts.loops
				? `${counts.loops} loop${counts.loops === 1 ? "" : "s"}`
				: null,
			counts.routes
				? `${counts.routes} route${counts.routes === 1 ? "" : "s"}`
				: null,
			counts.lanes
				? `${counts.lanes} lane${counts.lanes === 1 ? "" : "s"}`
				: null
		]
			.filter(Boolean)
			.join(" · ")
	)

	const LEGEND =
		"text-surface-600-400 text-[10px] font-bold tracking-[.15em] uppercase"

	/**
	 * The narrowest a branch may get before the group scrolls instead —
	 * fixed-width branches overflowed; equal shares shrank to 69px.
	 */
	const LANE_MIN = 10
	/** The same floor, transposed for a horizontal spine (rows, not columns). */
	const LANE_MIN_ROW = 5

	/** Arrow keys walk the flow, in whichever direction it is drawn. */
	function onFlowKey(event: KeyboardEvent) {
		const forward = orientation === "vertical" ? "ArrowDown" : "ArrowRight"
		const back = orientation === "vertical" ? "ArrowUp" : "ArrowLeft"
		if (event.key !== forward && event.key !== back) return
		event.preventDefault()
		const configurable = steps
		const i = configurable.findIndex((s) => s.key === activeKey)
		const next = event.key === forward ? i + 1 : i - 1
		if (next >= 0 && next < configurable.length)
			onSelect(configurable[next].key)
	}
</script>

{#snippet mapNode(n: GraphNode)}
	{@const step = steps.find((s) => s.key === n.stepKey)}
	{@const c = step ? countsFor(step) : null}
	{@const pend = n.stepKey ? pendingFor(n.stepKey) : 0}
	<button
		type="button"
		disabled={!n.stepKey}
		title={n.stepKey ? undefined : `${n.label} declares nothing to configure`}
		class="card border-surface-300-700 flex w-full items-stretch overflow-hidden border p-0 text-left transition-colors
			{nodeIsActive(n)
			? 'preset-filled-primary-500'
			: `bg-surface-100-900 ${n.stepKey ? 'hover:bg-surface-100-900' : 'opacity-55'}`}"
		aria-current={nodeIsActive(n) ? "step" : undefined}
		onclick={() => selectNode(n)}
	>
		<span
			aria-hidden="true"
			class="w-[3px] shrink-0 {KIND_STRIPE[n.kind] ?? 'bg-surface-400-600'}"
		></span>
		<span class="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2">
			<span class="min-w-0 flex-1">
				<span class="flex min-w-0 items-center gap-2">
					<span class="truncate text-sm font-medium">{n.label}</span>
					{#if pend}
						<span
							class="bg-warning-500 size-2 shrink-0 rounded-full"
							title="{pend} unsaved change{pend === 1 ? '' : 's'}"
						></span>
					{/if}
					{#if c?.overridden}
						<span
							class="preset-filled-secondary-500 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
							title="{c.overridden} set here, not inherited"
						>
							{c.overridden} override{c.overridden === 1 ? "" : "s"}
						</span>
					{/if}
				</span>
				<span class="flex items-center gap-1.5 text-xs opacity-70">
					<span class="truncate font-mono">{n.kind}</span>
					{#if c}
						<span aria-hidden="true">·</span>
						<span class="truncate">{c.total}</span>
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
	<!-- The split and the merge, positioned with the same calc the branch grid
	     uses so the rule lands on branch centres at any width. -->
	{@const cell = `(100% - ${count - 1}rem) / ${count}`}
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

<div class="flex flex-col">
	<div
		class="border-surface-300-700 flex flex-wrap items-center gap-2 border-b px-3 py-2"
	>
		<span class={LEGEND}>Signal path</span>
		<span class="text-surface-600-400 font-mono text-[10.5px]">
			{countLine}
		</span>
		<span class="flex-1"></span>
		<div
			class="border-surface-300-700 flex overflow-hidden rounded-md border"
			role="group"
			aria-label="Flow direction"
		>
			<button
				type="button"
				class="btn btn-sm rounded-none {orientation === 'vertical'
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				aria-pressed={orientation === "vertical"}
				title="Vertical — reads as a checklist"
				onclick={() => rememberOrientation("vertical")}
			>
				<Icons.Rows3 size={15} />
			</button>
			<button
				type="button"
				class="btn btn-sm rounded-none {orientation === 'horizontal'
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				aria-pressed={orientation === "horizontal"}
				title="Horizontal — reads as a signal chain"
				onclick={() => rememberOrientation("horizontal")}
			>
				<Icons.Columns3 size={15} />
			</button>
		</div>
		{#if allBlockIds.length}
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
		{/if}
	</div>

	<div class="overflow-x-auto p-3">
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
				<!-- The connector shares a container with the card it leads
				     into, so the two centre on the same measure. -->
				<div
					class={orientation === "vertical"
						? `flex flex-col ${row.kind === "node" ? "w-full max-w-[38rem]" : "w-full"}`
						: "flex shrink-0 items-stretch"}
				>
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
						<!-- A fork and a join, not a box with a list in it. -->
						<div class="flex flex-col">
							<div
								class="border-surface-300-700 flex items-stretch self-start rounded-md border border-l-2 {BLOCK_EDGE[
									row.blockKind
								] ?? 'border-l-tertiary-500'}"
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
										if (k) onSelect(k)
									}}
								>
									<span class="{LEGEND} flex items-center gap-1">
										{#if row.blockKind === "loop" || row.blockKind === "map"}
											<Icons.Repeat
												size={11}
												aria-hidden="true"
											/>
										{:else if row.blockKind === "route"}
											<Icons.GitBranch
												size={11}
												aria-hidden="true"
											/>
										{/if}
										{BLOCK_LABEL[row.blockKind] ??
											row.blockKind}
									</span>
									<span class="truncate text-xs font-semibold">
										{humanizeBlockName(row.id)}
									</span>
									<span
										class="text-surface-600-400 shrink-0 text-[11px]"
									>
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
									<div
										class={orientation === "vertical"
											? `flex min-w-full flex-col ${n === 1 ? "max-w-[38rem]" : ""}`
											: "flex items-stretch"}
									>
										{@render forkBar(n, "fork")}
										<!-- A grid so every branch is the same
										     width by construction. -->
										<div
											class={orientation === "vertical"
												? `grid items-stretch gap-4 ${n === 1 ? "max-w-[38rem]" : ""}`
												: "grid flex-1 items-stretch gap-4"}
											style={orientation === "vertical"
												? `grid-template-columns:repeat(${n}, minmax(${LANE_MIN}rem, 1fr))`
												: `grid-template-rows:repeat(${n}, minmax(${LANE_MIN_ROW}rem, auto))`}
										>
											{#each row.chains as c, li (c.chain)}
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
															class="text-surface-600-400 font-mono text-[9px]"
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
														{#if row.blockKind === "route" && routeWhen(row.id, c.chain)}
															<span
																class="text-secondary-500 truncate font-mono text-[9px]"
															>
																{routeWhen(
																	row.id,
																	c.chain
																)}
															</span>
														{/if}
													</div>
													<div
														class={orientation ===
														"vertical"
															? "contents"
															: "flex flex-1 items-center gap-2"}
													>
														{#if row.blockKind === "map"}
															<!-- One declared node
															     standing for many
															     runs, drawn as a
															     stack. -->
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
																class="text-surface-600-400 mt-3 font-mono text-[10.5px]"
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
															<div
																aria-hidden="true"
																class="bg-surface-300-700 h-px min-w-4 flex-1 self-center"
															></div>
														{/if}
													</div>
													{#if orientation === "vertical"}
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
									{#if row.blockKind === "loop"}
										<!-- The return edge, said typographically. -->
										<div
											class="text-surface-600-400 flex items-center gap-1.5 pt-1 pb-0.5 pl-1 text-[10px]"
										>
											<Icons.CornerLeftUp
												size={11}
												aria-hidden="true"
											/>
											<span class="tracking-wide uppercase">
												repeats{blockOf(row.id)?.max
													? ` · up to ${blockOf(row.id)?.max}×`
													: ""}
											</span>
											<span
												aria-hidden="true"
												class="border-surface-400-600 h-0 flex-1 border-t border-dashed"
											></span>
										</div>
									{/if}
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
									<span
										class="text-surface-600-400 ml-1 text-[11px]"
									>
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
				<!-- A version published before the graph payload existed still
				     has steps to configure. -->
				{#each steps as step, i (step.key)}
					{@const c = countsFor(step)}
					{#if i > 0}{@render connector()}{/if}
					<button
						type="button"
						class="card flex w-full max-w-[38rem] items-center gap-3 p-3 text-left
							{step.key === activeKey
							? 'preset-filled-primary-500'
							: 'preset-tonal hover:preset-tonal-primary'}"
						onclick={() => onSelect(step.key)}
					>
						<span class="min-w-0 flex-1 truncate text-sm font-medium">
							{step.label}
						</span>
						<span class="text-xs opacity-70">{c.total} settings</span>
					</button>
				{/each}
			{/if}
		</div>
	</div>

	{#if legend && (legendKinds.length || legendBlocks.length)}
		<div
			class="border-surface-300-700 flex flex-wrap gap-x-5 gap-y-1 border-t px-3 py-2"
		>
			{#each legendKinds as k (k)}
				<span class="flex items-center gap-2 text-xs">
					<span
						aria-hidden="true"
						class="h-3 w-[3px] shrink-0 rounded-full {KIND_STRIPE[k] ??
							'bg-surface-400-600'}"
					></span>
					<span class="font-medium">{humanizeCamelLabel(k)}</span>
					<span class="text-surface-600-400">{KIND_MEANING[k]}</span>
				</span>
			{/each}
			{#each legendBlocks as k (k)}
				<span class="flex items-center gap-2 text-xs">
					<span
						aria-hidden="true"
						class="h-3 w-[3px] shrink-0 rounded-full {BLOCK_EDGE[
							k
						]?.replace('border-l-', 'bg-') ?? 'bg-surface-400-600'}"
					></span>
					<span class="font-medium">{BLOCK_LABEL[k] ?? k}</span>
					<span class="text-surface-600-400">{BLOCK_MEANING[k]}</span>
				</span>
			{/each}
		</div>
	{/if}
</div>
