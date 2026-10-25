<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * The OPENING place of the Connections view — where models run. Each row
	 * is a connection: a service, a server somebody runs, or a runtime this
	 * pub manages. Its models live inside it (open it; its Models tab lists
	 * them, with Use). Making sessions work — the status strip, the jobs
	 * grid, the job sheet, the finder, Set up chat, the downloads tray, the
	 * Defaults ledger and Add a model by name — is the Models view's (rail
	 * key `models`), split out on 2026-10-11 (PLAN-models-connections-split).
	 *
	 * ## Connections are the list (notes 42, owner 2026-10-03)
	 *
	 * One row, or one card (`ConnectionCard`, the list/card pair on the find
	 * row), per endpoint with its type, its state and its model count, grouped
	 * by where the compute is (`groupConnections`).
	 *
	 * The toolbar is the shared `ViewToolbar` (STYLE-GUIDE §6.3): Add (the
	 * New menu — a connection, KoboldCPP, Ollama) on the action row; the
	 * filter, its popout and the list/card pair on the find row; the
	 * narrowing in force as a chip.
	 *
	 * ## Nothing connected yet
	 *
	 * The whole pane becomes "Where should the writing happen?" and its doors.
	 * The KoboldCPP door opens the Models view's Set up chat stepper through
	 * the panels digest (`connectionsDoor = "setup-chat"`); the other two open
	 * Add here.
	 *
	 * ## The filter's unit is the connection
	 *
	 * Same values (`IndexFilter`), because a `cap:` value is seeded from
	 * outside — Jump, the onboarding wizard, the panels digest — and a
	 * capability filter keeps CONNECTIONS that have at least one model able
	 * to serve it. In a popout rather than a pill row, matching the Characters
	 * view: the rows will not fit across 400px and a strip that scrolls
	 * sideways is a strip nobody reads the end of. A seeded `defaults` (the
	 * ledger, now in Models) reads as Everything here.
	 *
	 * ## Live status, asked for only where it applies
	 *
	 * A managed KoboldCPP's process, an Ollama host's version, the two local
	 * ONNX lanes — asked for once (`useLiveStatus`), and only when the list
	 * actually contains a connection of that kind. Every one of them may stay
	 * silent; a silent one leaves its clause out of the row's sentence rather
	 * than claiming anything (see `connectionRowStatus`).
	 *
	 * The view decides no sentences and no filtering: `connectionIndexFilter`
	 * and `connectionRowStatus` are pure and have their own tests.
	 */
	import { getContext, type Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { capabilityLabel } from "@serene-pub/sdk"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import { toolbarButtonClass } from "$lib/client/components/panels/toolbarButton"
	import ViewToolbar from "$lib/client/components/panels/ViewToolbar.svelte"
	import ListCardToggle from "$lib/client/components/panels/ListCardToggle.svelte"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import { createViewMode } from "$lib/client/utils/viewMode.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import AddMenu from "./AddMenu.svelte"
	import { canRunLocalRuntimes } from "./addMenuItems"
	import ConnectionRow from "./ConnectionRow.svelte"
	import { connectionTypeIcon } from "./connectionTypeIcon"
	import ConnectionCard from "./ConnectionCard.svelte"
	import {
		countConnections,
		filterConnections,
		indexTotals,
		parseIndexFilter,
		serviceLabel,
		type IndexFilter
	} from "./connectionIndexFilter"
	import {
		CONNECTION_SECTIONS,
		sectionForCapability
	} from "$lib/shared/constants/connectionSections"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { defaultsSummary } from "./defaultsSummary"
	import { defaultsForConnection, groupConnections } from "./connectionGroups"
	import { endpointKind } from "./modelManagement"
	import type { CapabilityDefaultRef } from "./modelSystemDefaults"
	import { useLiveStatus } from "./liveStatus.svelte"

	type Row = Sockets.Connections.List.Row & { id: number }

	interface Props {
		connectionsList: Sockets.Connections.List.Row[]
		capabilityDefaults?: Record<string, CapabilityDefaultRef | undefined>
		isLoading: boolean
		/** Connection ids with a sync in flight. */
		syncingIds: ReadonlySet<number>
		/** Every connection is being checked (the open-time sweep). */
		syncingAll: boolean
		/** Seeds the filter (e.g. the onboarding wizard's step, as `cap:<transform>`). */
		initialFilter?: string | null
		/** Scroll this connection's row into view and highlight it once. */
		focusConnectionId?: number | null
		/** The connection open beside the list at desk width. */
		selectedConnectionId?: number | null
		/**
		 * The view's measured mode.
		 *
		 * ⚠ Passed in rather than measured here: at desk with something open
		 * this list is a 340px column while the VIEW is 1,500px, so
		 * `@min-[900px]/view` answers about the wrong box. With `detailOpen`
		 * it decides one thing — whether this list is a narrow column beside
		 * a detail (desk + open), where it shows rows only.
		 */
		mode?: "compact" | "desk"
		/**
		 * Something is open in the detail pane beside this list (desk only).
		 * The list is then a 340px column: rows, no cards, no list/card pair.
		 */
		detailOpen?: boolean
		/** Open Add; a door may narrow the service picker to one category. */
		onAddNew: (opts?: { category?: "cloud" | "local" | "custom" }) => void
		/** Switch a manager on and open its connection. */
		onEnableManager: (kind: "koboldcpp" | "ollama") => void
		onOpenConnection: (connection: Row) => void
		onRefresh: (connection: Row) => void
		/**
		 * Lays the index out: called with its toolbar and its body, so the
		 * caller can pin the one over the other in `PanelSplit`'s `toolbar`
		 * and `list` slots (STYLE-GUIDE §5.2) while this ONE instance keeps
		 * the filter, the live statuses and the Jump scope. Two instances (a
		 * toolbar part and a body part) would each hold their own filter and
		 * declare every socket interest twice. Without it the two are
		 * stacked in a column of their own, as the SSR tests render it.
		 */
		frame?: Snippet<[toolbar: Snippet, body: Snippet]>
	}
	let {
		connectionsList,
		capabilityDefaults = {},
		isLoading,
		syncingIds,
		syncingAll,
		initialFilter = null,
		focusConnectionId = null,
		selectedConnectionId = null,
		mode = "compact",
		detailOpen = false,
		onAddNew,
		onEnableManager,
		onOpenConnection,
		onRefresh,
		frame
	}: Props = $props()

	/** Rows or cards, remembered per browser like the other views' pairs. */
	const listMode = createViewMode("serene-pub:viewMode:connectionsIndex")
	/** A 340px column beside an open detail: rows only. */
	const asColumn = $derived(mode === "desk" && detailOpen)
	/**
	 * Cards where the list has the room to itself; rows in the column
	 * beside an open detail, where the list is navigation and a card's
	 * extra lines only push the next connection off screen.
	 */
	const showCards = $derived(listMode.value === "cards" && !asColumn)

	const socket = useTypedSocket()
	const userCtx: { user?: SelectUser } = getContext("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)
	/** Android hides the local-runtime Add items, as the setup wizard does. */
	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
	/**
	 * False in the Android app, where the server refuses to switch either
	 * manager on: the Add menu's local-runtime items and the first-run
	 * "KoboldCPP, run by Serene Pub" door both hide on it.
	 */
	const localRuntimes = $derived(
		canRunLocalRuntimes(systemSettingsCtx?.settings)
	)
	let query = $state("")
	/**
	 * A hand-set filter wins; otherwise the seed applies, read through a
	 * derived so a later seed still lands.
	 */
	let filterOverride = $state<IndexFilter | null>(null)
	const filter = $derived.by((): IndexFilter => {
		const value = filterOverride ?? parseIndexFilter(initialFilter)
		// The Defaults ledger moved to the Models view; a seeded `defaults`
		// (an old link, the digest) narrows nothing here.
		return value === "defaults" ? "all" : value
	})
	let filterOpen = $state(false)

	/** List rows always carry ids; the guard is for the type. */
	const rows = $derived(connectionsList.filter((c): c is Row => c.id != null))
	const totals = $derived(indexTotals(rows))
	const summary = $derived(defaultsSummary(rows, capabilityDefaults))

	/**
	 * The two kinds whose chip is TEAL: a runtime this pub manages, rather
	 * than a host it merely talks to (ruling R5). Keyed on the kind and not on
	 * the type so the Ollama embeddings type is the same "Ollama" the text one
	 * is — one service, one chip.
	 */
	const MANAGED_KINDS: ReadonlySet<string> = new Set([
		"koboldcpp-managed",
		"ollama"
	])

	/**
	 * A row's state as its dot says it, live facts included, so Needs
	 * attention keeps exactly the rows drawn gold or red.
	 *
	 * ⚠ Read WITHOUT the in-flight sync: a forced listing turns every row
	 * busy for a moment, and a filter reading that would drop the broken row
	 * the person just pressed Refresh on from under their pointer. The row
	 * keeps its last real state until the listing answers.
	 */
	const stateOf = (connection: Row) =>
		statusOf(connection, { ignoreSyncing: true }).state
	const visible = $derived(
		filterConnections(rows, {
			query,
			filter,
			serviceLabel: serviceLabel,
			stateOf
		})
	)
	const hasNoMatches = $derived(
		!isLoading && rows.length > 0 && visible.length === 0
	)
	/**
	 * The visible rows, split into "On this machine" and "Services".
	 *
	 * Derived from `visible` and not from `rows`, so a filter that empties a
	 * group drops its header too rather than leaving a heading over nothing.
	 */
	const groups = $derived(groupConnections(visible))

	function labelOf(id: string): string {
		try {
			return capabilityLabel(id as any)
		} catch {
			return sectionForCapability(id)?.starVerb ?? id
		}
	}

	/**
	 * The filter rows: three views of the whole, then one per section.
	 *
	 * Four sections rather than ten transforms — the sections are the shapes a
	 * person thinks in ("images", "entities"), and a row per transform would be
	 * six more rows saying the same four things. A seeded `cap:` value outside
	 * that four is appended, so the filter on screen is always the filter in
	 * force.
	 */
	const SECTION_LABELS: Record<string, string> = {
		"text-gen": "Chat",
		"image-gen": "Images",
		embeddings: "Embeddings",
		ner: "Entities"
	}
	const filterOptions = $derived.by(() => {
		const options: { value: IndexFilter; label: string; count?: number }[] =
			[
				{
					value: "all",
					label: "Everything",
					count: countConnections(rows, "all", stateOf)
				},
				{
					value: "attention",
					label: "Needs attention",
					count: countConnections(rows, "attention", stateOf)
				},
				...CONNECTION_SECTIONS.map((s) => ({
					value: `cap:${s.starCapability}` as IndexFilter,
					label:
						SECTION_LABELS[s.modality] ?? labelOf(s.starCapability),
					count: countConnections(
						rows,
						`cap:${s.starCapability}` as IndexFilter,
						stateOf
					)
				}))
			]
		if (!options.some((o) => o.value === filter))
			options.push({
				value: filter,
				label: filter.startsWith("cap:")
					? labelOf(filter.slice(4))
					: filter,
				count: countConnections(rows, filter, stateOf)
			})
		return options
	})
	/** What the dismissible chip says. Undefined at Everything — no chip. */
	const activeFilterLabel = $derived(
		filter === "all"
			? undefined
			: filterOptions.find((o) => o.value === filter)?.label
	)
	function pickFilter(value: IndexFilter) {
		filterOverride = value
		filterOpen = false
	}

	// ── Which live statuses this list needs (`liveStatus.svelte.ts`) ───────
	const live = useLiveStatus(() => rows, {
		admin: () => isAdmin,
		entries: () => summary.entries,
		capabilityDefaults: () => capabilityDefaults,
		syncing: (id) => syncingAll || syncingIds.has(id)
	})
	const statusOf = live.statusOf

	function handleRowAction(connection: Row, verb: string) {
		switch (verb) {
			case "start":
				socket.emit("koboldcpp:startSubprocess", {})
				return
			case "start-offline":
				// Switched off with the install kept: one call turns it back
				// on and starts it (ruled 2026-09-24).
				socket.emit("koboldcpp:startSubprocess", { enable: true })
				return
			case "stop":
				socket.emit("koboldcpp:stopSubprocess", {})
				return
			case "refresh":
				onRefresh(connection)
				return
			case "fix":
			case "setup":
			case "choose":
				// All open the connection. They are separate verbs because
				// they are separate SENTENCES — "Fix" admits something failed,
				// "Set up" says you have not finished, "Choose" says only the
				// pick is left — and a row that says Fix about a key nobody
				// has typed yet is the false alarm this whole split removes.
				onOpenConnection(connection)
				return
		}
	}

	/**
	 * The first-run KoboldCPP door: the Set up chat stepper (Runtime → Model
	 * → Done) lives in the Models view, so this names it in the panels
	 * digest and opens that view, which consumes the door once.
	 */
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")
	function openSetUpChat() {
		if (!panelsCtx) return
		panelsCtx.digest.connectionsDoor = "setup-chat"
		panelsCtx.openPanel({ key: "models", toggle: false })
	}

	/**
	 * Jump, scoped to this view.
	 *
	 * Registered from HERE and not from `ConnectionsSidebar`, which is the
	 * thing the rail opens: this component is mounted exactly while the index
	 * is on screen, so the scope exists exactly while there is a filter box to
	 * bind to. The hits are connections, because the rows are connections —
	 * a model is found through its connection or the Models view.
	 */
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)
	$effect(() =>
		jumpCtx?.registerScope("connections", {
			label: "Connections",
			getQuery: () => query,
			setQuery: (next) => (query = next),
			getHits: () =>
				visible.map((connection) => ({
					kind: "connection" as const,
					id: connection.id,
					title: connection.name || "Untitled connection",
					subtitle: serviceLabel(connection)
				})),
			onPick: (hit) => {
				const connection = rows.find((c) => c.id === Number(hit.id))
				if (connection) onOpenConnection(connection)
			}
		})
	)

	function clearFilters() {
		query = ""
		filterOverride = "all"
	}

	/** The landing cue when a connection view hands the list back. */
	$effect(() => {
		if (focusConnectionId == null) return
		document
			.getElementById(`connection-row-${focusConnectionId}`)
			?.scrollIntoView({ block: "nearest" })
	})
</script>

{#snippet doorRow(
	icon: any,
	title: string,
	blurb: string,
	tile: string,
	size: string,
	run: () => void,
	trades: string[] = [],
	/** Why this door leads nowhere here: it is disabled and says so. */
	blocked: string | null = null
)}
	{@const DoorIcon = icon}
	<button
		type="button"
		class="focus-visible:ring-primary-500 flex min-h-11 w-full items-start gap-2.5 rounded-base px-1.5 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none {blocked
			? 'cursor-not-allowed opacity-70'
			: 'hover:preset-tonal-primary'}"
		disabled={!!blocked}
		onclick={run}
	>
		<span
			class="grid shrink-0 place-items-center rounded-lg {size} {tile}"
			aria-hidden="true"
		>
			<DoorIcon size={18} />
		</span>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-medium">{title}</span>
			{#if blocked}
				<!-- The reason in place of the blurb, and whole: it often
				     quotes the runtime's own error, and a disabled button
				     takes no focus, so no tooltip would be reachable (§9). -->
				<span class="text-surface-600-400 block text-xs break-words">
					{blocked}
				</span>
			{:else}
				<!-- Wrapped, not truncated: the first-run doors carry the
				     wizard's own sentences, and a cut one loses its point. -->
				<span class="text-surface-600-400 block text-xs break-words">
					{blurb}
				</span>
			{/if}
			{#if trades.length}
				<span class="mt-1.5 flex flex-wrap gap-1">
					{#each trades as trade (trade)}
						<!-- A cost is not a warning: every chip is the same
						     quiet tone, and the WORDS carry the difference. -->
						<span
							class="preset-tonal-surface text-surface-700-300 rounded-md px-1.5 py-0.5 text-meta font-medium"
						>
							{trade}
						</span>
					{/each}
				</span>
			{/if}
		</span>
		<Icons.ChevronRight
			size={16}
			class="text-surface-500 mt-1 shrink-0"
			aria-hidden="true"
		/>
	</button>
{/snippet}

{#snippet findFilter()}
	<PanelFilterInput
		bind:value={query}
		placeholder={totals.connections === 1 ? "connection" : "connections"}
		count={totals.connections}
		aria-label="Filter connections by name, service, host or model"
	/>
{/snippet}
{#snippet findActions()}
	<!-- A popout rather than a row of chips: seven choices will not
	     fit across 400px, and a strip that scrolls sideways is a
	     strip nobody reads the end of (§6.3). -->
	<Popover
		open={filterOpen}
		onOpenChange={(e) => (filterOpen = e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class={toolbarButtonClass(filter !== "all")}
			title="Filter connections"
			aria-label="Filter connections"
			aria-expanded={filterOpen}
		>
			<Icons.SlidersHorizontal size={16} aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,260px)] border p-2 shadow-xl"
				>
					<div
						class="flex max-h-[min(60vh,320px)] flex-col gap-0.5 overflow-y-auto"
						role="radiogroup"
						aria-label="Filter connections"
					>
						{#each filterOptions as option (option.value)}
							{@const checked = filter === option.value}
							<button
								type="button"
								role="radio"
								aria-checked={checked}
								class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm {checked
									? 'sidebar-row-active'
									: 'hover:bg-surface-200-800'}"
								onclick={() => pickFilter(option.value)}
							>
								<span class="min-w-0 flex-1 truncate">
									{option.label}
								</span>
								{#if option.count !== undefined}
									<span
										class="text-surface-600-400 shrink-0 text-meta"
									>
										{option.count}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
	<!-- Not beside an open detail: the 340px column is navigation, rows
	     only, and three icon buttons there cut the filter's own words. -->
	{#if !asColumn}
		<ListCardToggle mode={listMode} label="Connections" />
	{/if}
{/snippet}

<!-- The view toolbar (STYLE-GUIDE §6.3). Add — the New menu — leads the
     action row; the filter box,
     its popout and the list/card pair are the find row; the narrowing in
     force is the one chip under them. No find row over an empty list:
     there is nothing to narrow, and the doors below are the whole screen.
     Pinned by the caller's `PanelSplit` (`frame`), 12px over the body. -->
{#snippet indexToolbar()}
	<ViewToolbar
		label="Connections"
		filter={rows.length > 0 ? findFilter : undefined}
		filterActions={rows.length > 0 ? findActions : undefined}
	>
		{#snippet primary()}
			<AddMenu
				onAddConnection={onAddNew}
				onAddKoboldCpp={() => onEnableManager("koboldcpp")}
				onAddOllama={() => onEnableManager("ollama")}
				canRunLocalRuntimes={localRuntimes}
			/>
		{/snippet}
		{#snippet chips()}
			<!-- The one narrowing in force, said once. At Everything there is
			     nothing to say and the row is absent (`empty:hidden`). -->
			{#if rows.length > 0 && activeFilterLabel}
				<Badge size="md" class="text-surface-700-300 flex min-w-0 items-center gap-1">
					<span class="min-w-0 truncate">{activeFilterLabel}</span>
					<button
						type="button"
						class="hover:text-surface-950-50 shrink-0"
						onclick={() => pickFilter("all")}
						aria-label={`Clear filter: ${activeFilterLabel}`}
					>
						<Icons.X size={12} aria-hidden="true" />
					</button>
				</Badge>
			{/if}
		{/snippet}
	</ViewToolbar>
{/snippet}

<!-- The body: the connections. It sits in the list pane's one scroller, so
     it draws none of its own. -->
{#snippet indexBody()}
	<div class="flex flex-col gap-3">
		{#if isLoading}
			<LoadingState message="Loading connections…" showMessage />
		{:else if !rows.length}
			<!-- Nothing is connected. The whole pane becomes the question that
			     matters, and the doors are the answers (three; two on Android, which cannot
			     run a local runtime). -->
			<section class="panel-card flex flex-col gap-2">
				<h3
					class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
				>
					Where should the writing happen?
				</h3>
				<p class="text-surface-600-400 text-sm">
					A session can't reply until one model is connected. Pick the
					trade you prefer — the others can be added later.
				</p>
				<!--
					Each door names what it COSTS, in three chips.

					A door that describes itself ("Already installed here or on
					another machine") leaves the actual decision — privacy,
					money, memory — unstated, so the one question a first-timer
					is really asking has no answer on the screen they are asked
					it on.
				-->
				<div class="flex flex-col gap-1">
					{#if localRuntimes}
						{@render doorRow(
							connectionTypeIcon(
								CONNECTION_TYPE.KOBOLDCPP_MANAGED,
								Icons.Cpu
							),
							"KoboldCPP, run by Serene Pub",
							"Serene Pub downloads KoboldCPP and a model that suits your computer, then runs it for you.",
							"preset-tonal-primary",
							"size-10",
							openSetUpChat,
							["Private", "Free", "Needs about 8 GB of memory"]
						)}
					{/if}
					{@render doorRow(
						Icons.Cloud,
						"An online service",
						"OpenAI, Anthropic, OpenRouter, Groq and more. You need an account with the service and an API key.",
						"preset-tonal-surface",
						"size-10",
						onAddNew,
						["Fast", "Nothing to install", "Costs per message"]
					)}
					{@render doorRow(
						Icons.Server,
						"A custom connection",
						// The wizard's label. Its sentence names local servers
						// here: the wizard finds those on its own road, and this
						// door is the only way in for them on this screen.
						"Ollama, LM Studio, llama.cpp or KoboldCPP you already run, on this computer or another.",
						"preset-tonal-surface",
						"size-10",
						// The picker, narrowed to local servers — this door once
						// switched the Ollama manager on whichever of the three
						// the person ran (ruled 2026-09-24).
						() => onAddNew({ category: "local" }),
						["Private", "Free"]
					)}
				</div>
				<hr class="panel-edge my-1" />
				<p class="text-surface-600-400 text-xs">
					Know what you want?
					<button
						type="button"
						class="anchor"
						onclick={() => onAddNew()}
					>
						Add a connection
					</button>
					lists every service and preset.
				</p>
			</section>
		{:else if hasNoMatches}
			<EmptyState
				icon={Icons.SearchX}
				message="Nothing matches."
				ctaLabel="Clear search and filter"
				onCta={clearFilters}
			/>
		{:else}
			<!--
				The main list: the connections. The shell's bar already
				titles the view and the filter box counts them, so no
				heading of its own (PLAN-sidebar-nav-normalization §2.4).

				Grouped by where the compute is, which is the trade a person
				is actually weighing: on this machine is private and free,
				a service is fast and billed. The group label names it once
				(`ListGroupLabel`, the trade as its muted trailing words, no
				rule — Q6) so no row has to. See `connectionGroups`. Rows,
				or cards (the list/card pair on the find row) — the same
				facts from the same `RowStatus`, a card with the room to
				show the type, the state and the model count all at once.
			-->
			<section class="flex flex-col" aria-label="Connections">
				{#each groups as { group, rows: groupRows } (group.id)}
					{@const groupLabelId = `connections-group-${group.id}`}
					<div class="flex flex-col">
						<ListGroupLabel
							id={groupLabelId}
							label={group.label}
							trailing={group.trade}
						/>
						{#if showCards}
							<!-- auto-fill/minmax off the list pane's own
							     width: one across the dock, as many as fit
							     at Half or across the whole view. -->
							<div
								class="mt-1 grid min-w-0 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
								role="list"
								aria-labelledby={groupLabelId}
							>
								{#each groupRows as connection (connection.id)}
									<div
										id={`connection-row-${connection.id}`}
										class="flex min-w-0 flex-col"
										role="listitem"
									>
										<ConnectionCard
											title={connection.name ||
												"Untitled connection"}
											serviceLabel={serviceLabel(
												connection
											)}
											kind={endpointKind(
												connection.type
											)}
											type={connection.type}
											managed={MANAGED_KINDS.has(
												endpointKind(
													connection.type
												)
											)}
											status={statusOf(connection)}
											modelCount={connection.models
												.length}
											defaultFor={defaultsForConnection(
												connection,
												capabilityDefaults,
												(c) =>
													capabilityLabel(
														c as any
													)
											)}
											selected={selectedConnectionId ===
												connection.id}
											onOpen={() =>
												onOpenConnection(
													connection
												)}
											onAction={(verb) =>
												handleRowAction(
													connection,
													verb
												)}
										/>
									</div>
								{/each}
							</div>
						{:else}
							<div
								class="flex flex-col gap-1"
								role="list"
								aria-labelledby={groupLabelId}
							>
								{#each groupRows as connection (connection.id)}
									<div
										id={`connection-row-${connection.id}`}
										role="listitem"
									>
										<ConnectionRow
											title={connection.name ||
												"Untitled connection"}
											serviceLabel={serviceLabel(
												connection
											)}
											kind={endpointKind(
												connection.type
											)}
											type={connection.type}
											managed={MANAGED_KINDS.has(
												endpointKind(
													connection.type
												)
											)}
											status={statusOf(connection)}
											defaultFor={defaultsForConnection(
												connection,
												capabilityDefaults,
												(c) =>
													capabilityLabel(
														c as any
													)
											)}
											selected={selectedConnectionId ===
												connection.id}
											onOpen={() =>
												onOpenConnection(
													connection
												)}
											onAction={(verb) =>
												handleRowAction(
													connection,
													verb
												)}
										/>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</section>
		{/if}
	</div>
{/snippet}

{#if frame}
	{@render frame(indexToolbar, indexBody)}
{:else}
	<div class="flex h-full min-h-0 flex-col gap-3">
		{@render indexToolbar()}
		<div class="min-h-0 flex-1 overflow-y-auto">
			{@render indexBody()}
		</div>
	</div>
{/if}
