<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * The Models view's list column (plan 2026-10-11, the Models /
	 * Connections split): "make my sessions work".
	 *
	 * Top to bottom: the toolbar (Get a model, the filter, the job scope, the
	 * `⋯` with Add a model by name, Set up chat and the Defaults ledger),
	 * then every model of every connection, one `ModelRow` each, FLAT and
	 * sorted by name (`modelsList.ts`), its connection a chip on the row;
	 * then the background remover (`MattingModelRow`). The downloads tray
	 * sits at the foot while anything is arriving.
	 *
	 * Inventory only (DESIGN-image-generation §14, 2026-10-12): the status
	 * strip, the jobs grid and the defaults ledger moved to the Loadouts
	 * view. A row's Use is the *Use in…* menu (`UseInMenu`) where the caller
	 * hands in the loadouts; the Defaults ledger item opens Loadouts.
	 *
	 * ONE instance holds the filter, the downloads feeds and the Jump scope;
	 * the caller pins its toolbar over its body through `frame`, as the
	 * Connections index does. The dialogs it opens (the finder, Set up chat,
	 * Add a model by name) are the caller's.
	 *
	 * The view decides no sentences and no filtering: `modelsList` and
	 * `useInMenu` are pure and have their own tests.
	 */
	import { getContext, type Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"
	import { useConnections } from "$lib/client/contexts/connections.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import { toolbarButtonClass } from "$lib/client/components/panels/toolbarButton"
	import ViewToolbar from "$lib/client/components/panels/ViewToolbar.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import DownloadsTray from "./DownloadsTray.svelte"
	import MattingModelRow from "./MattingModelRow.svelte"
	import ModelRow from "./ModelRow.svelte"
	import UseInMenu from "./UseInMenu.svelte"
	import type { UseInGroup, UseInItem } from "./useInMenu"
	import { downloads } from "./downloads.svelte"
	import { localCatalogLine } from "./jobPicker"
	import { manualAddAllowed } from "./modelManagement"
	import {
		connectionChip,
		filterModels,
		flatModels,
		MODEL_SCOPES,
		modelsSummaryLine,
		scopeCounts,
		type FlatModel,
		type ModelScope
	} from "./modelsList"

	type Row = Sockets.Connections.List.Row & { id: number }

	interface Props {
		/** The model open beside the list, or null. */
		selected?: { connectionId: number; modelId: number } | null
		/** Open one model's own view in the detail pane. */
		onOpenModel: (connectionId: number, modelId: number) => void
		/** The Set up chat stepper (U5): Runtime → Model → Done. */
		onSetUpChat: () => void
		/** The Get a model dialog, optionally scoped. */
		onGetModel: (opts?: { capability?: string }) => void
		/** The Add a model by name dialog. */
		onAddByName: () => void
		/** The Connections view — where a connection is added. */
		onOpenConnections: () => void
		/**
		 * The Loadouts view, on one loadout when named — the Defaults ledger
		 * item and the *Use in…* menu's last row.
		 */
		onOpenLoadouts?: (loadoutId?: number) => void
		/**
		 * A model's *Use in…* menu (`useInMenu.ts`). Absent — no loadouts
		 * list yet — the row keeps its plain Use, which fills the job's
		 * default loadout.
		 */
		useInGroupsOf?: (entry: FlatModel<Row>) => UseInGroup[] | null
		/** A *Use in…* pick. */
		onUseIn?: (entry: FlatModel<Row>, item: UseInItem) => void
		/** Seeds the job scope (a `MODEL_SCOPES` id). */
		initialScope?: ModelScope
		/**
		 * Lays the list out: called with its toolbar and its body, so the
		 * caller can pin the one over the other in `PanelSplit`'s `toolbar`
		 * and `list` slots (STYLE-GUIDE §5.2). Without it the two are stacked
		 * in a column of their own, as the SSR tests render it.
		 */
		frame?: Snippet<[toolbar: Snippet, body: Snippet]>
	}
	let {
		selected = null,
		onOpenModel,
		onSetUpChat,
		onGetModel,
		onAddByName,
		onOpenConnections,
		onOpenLoadouts,
		useInGroupsOf,
		onUseIn,
		initialScope = "all",
		frame
	}: Props = $props()

	const ctx = useConnections()
	const userCtx: { user?: SelectUser } | undefined = getContext("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)

	const rows = $derived(ctx.listed as Row[])
	const isLoading = $derived(ctx.loading)

	// ── The list ────────────────────────────────────────────────────────────
	let query = $state("")
	let scopeOverride = $state<ModelScope | null>(null)
	const scope = $derived<ModelScope>(scopeOverride ?? initialScope)
	let scopeOpen = $state(false)

	const all = $derived(flatModels(rows))
	const visible = $derived(filterModels(all, { query, scope }))
	const counts = $derived(scopeCounts(all))
	const scopeLabel = $derived(
		MODEL_SCOPES.find((s) => s.id === scope)?.label ?? "All"
	)
	const hasNoMatches = $derived(
		!isLoading && all.length > 0 && visible.length === 0
	)
	/** Connections a model may be added to by name (`manualAddAllowed`). */
	const addByNameTargets = $derived(
		rows.filter((c) => manualAddAllowed(c.type))
	)

	function pickScope(next: ModelScope) {
		scopeOverride = next
		scopeOpen = false
	}
	function clearFilters() {
		query = ""
		scopeOverride = "all"
	}

	/**
	 * The downloads tray's feeds, held for as long as this view is mounted.
	 * The ONNX one is handed in from here: a local file's progress is
	 * already patched into the list by the connections context.
	 */
	$effect(() => downloads.subscribe({ admin: isAdmin }))
	$effect(() => downloads.setOnnx(rows))
	const trayCount = $derived(downloads.inFlight)
	/** The tray's list is open: the tray stays while it is, even at zero. */
	let trayOpen = $state(false)
	const trayPercent = $derived(downloads.percent)

	// ── A row ───────────────────────────────────────────────────────────────
	function rowOf(entry: FlatModel<Row>): Row | undefined {
		return rows.find((c) => c.id === entry.connectionId)
	}
	/**
	 * Use is offered where a press can do something now: a host's model, or
	 * a local file already on disk. A local file still to download says its
	 * size instead and opens its own view, where Download is.
	 */
	function canUse(entry: FlatModel<Row>): boolean {
		if (!entry.enabled || entry.missingSince) return false
		if (!entry.capabilities.length) return false
		return !entry.isLocal || entry.local?.state === "on_disk"
	}
	function noteOf(entry: FlatModel<Row>): string | null {
		if (!entry.isLocal) return null
		return localCatalogLine(entry.local as any) || null
	}
	function defaultForOf(entry: FlatModel<Row>): string[] {
		const row = rowOf(entry)
		return row ? (ctx.defaultsByModel(row)[entry.model.id] ?? []) : []
	}
	function use(entry: FlatModel<Row>) {
		const row = rowOf(entry)
		if (row) ctx.useModelOn(row, entry.model.id)
	}

	/**
	 * Jump, scoped to this view: the models it lists, by name. A model hit
	 * opens the model here; it rides the `connection` kind with a model's
	 * own id so it can never collide with a connection the server returns.
	 */
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)
	$effect(() =>
		jumpCtx?.registerScope("models", {
			label: "Models",
			getQuery: () => query,
			setQuery: (next) => (query = next),
			getHits: () =>
				visible.map((entry) => ({
					kind: "connection" as const,
					id: `model:${entry.connectionId}:${entry.model.id}`,
					parentId: entry.connectionId,
					title: entry.displayName,
					subtitle: entry.connectionName
				})),
			onPick: (hit) => {
				const [, connectionId, modelId] = String(hit.id).split(":")
				onOpenModel(Number(connectionId), Number(modelId))
			}
		})
	)
</script>

{#snippet findFilter()}
	<PanelFilterInput
		bind:value={query}
		placeholder={all.length === 1 ? "model" : "models"}
		count={all.length}
		aria-label="Filter models by name, connection or service"
	/>
{/snippet}
{#snippet findActions()}
	<!-- The job scope: a popout of radios, as every view's filter is (§6.3). -->
	<Popover
		open={scopeOpen}
		onOpenChange={(e) => (scopeOpen = e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class={toolbarButtonClass(scope !== "all")}
			title="Model scope"
			aria-label="Model scope"
			aria-expanded={scopeOpen}
		>
			<Icons.SlidersHorizontal size={16} aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,260px)] border p-2 shadow-xl"
				>
					<div
						class="flex flex-col gap-0.5"
						role="radiogroup"
						aria-label="Model scope"
					>
						{#each MODEL_SCOPES as option (option.id)}
							{@const checked = scope === option.id}
							<button
								type="button"
								role="radio"
								aria-checked={checked}
								class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm {checked
									? 'sidebar-row-active'
									: 'hover:bg-surface-200-800'}"
								onclick={() => pickScope(option.id)}
							>
								<span class="min-w-0 flex-1 truncate">
									{option.label}
								</span>
								<span
									class="text-surface-600-400 shrink-0 text-meta"
								>
									{counts[option.id]}
								</span>
							</button>
						{/each}
					</div>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{/snippet}

{#snippet listToolbar()}
	<ViewToolbar
		label="Models"
		filter={all.length > 0 ? findFilter : undefined}
		filterActions={all.length > 0 ? findActions : undefined}
		menuItems={[
			{
				label: "Add a model by name",
				icon: Icons.TextCursorInput,
				disabled: !addByNameTargets.length,
				onSelect: onAddByName
			},
			{
				label: "Set up chat",
				icon: Icons.MessageSquare,
				onSelect: onSetUpChat
			},
			rows.length > 0 &&
				!!onOpenLoadouts && {
					label: "Defaults ledger",
					icon: Icons.Star,
					onSelect: () => onOpenLoadouts()
				}
		]}
	>
		{#snippet primary()}
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 shrink-0"
				onclick={() => onGetModel()}
			>
				<Icons.Download size={16} aria-hidden="true" />
				Get a model
			</button>
		{/snippet}
		{#snippet chips()}
			<!-- The narrowing in force, said once. -->
			{#if all.length > 0 && scope !== "all"}
				{@render chip(scopeLabel, () => pickScope("all"))}
			{/if}
		{/snippet}
	</ViewToolbar>
{/snippet}

{#snippet chip(label: string, clear: () => void)}
	<Badge size="md" class="text-surface-700-300 flex min-w-0 items-center gap-1">
		<span class="min-w-0 truncate">{label}</span>
		<button
			type="button"
			class="hover:text-surface-950-50 shrink-0"
			onclick={clear}
			aria-label={`Clear filter: ${label}`}
		>
			<Icons.X size={12} aria-hidden="true" />
		</button>
	</Badge>
{/snippet}

<!-- The body: the models, then the background remover. It sits in the list pane's one
     scroller, so it draws none of its own; `min-h-full` lets the downloads
     tray sit at the foot of a short list. -->
{#snippet listBody()}
	<div class="flex min-h-full flex-col gap-3">
		{#if isLoading}
			<LoadingState message="Loading models…" showMessage />
		{:else}
			{#if !rows.length}
				<!-- Nothing is connected. Set up chat runs KoboldCPP here;
				     everything else starts in the Connections view. -->
				<EmptyState
					icon={Icons.Boxes}
					message="No models yet."
					ctaLabel="Set up chat"
					onCta={onSetUpChat}
				/>
				<p class="text-surface-600-400 text-center text-xs">
					Or add a connection to a service or a server you run.
					<button
						type="button"
						class="anchor"
						onclick={onOpenConnections}
					>
						Add a connection
					</button>
				</p>
			{:else if !all.length}
				<EmptyState icon={Icons.Boxes} message="No models yet." />
			{:else if hasNoMatches}
				<EmptyState
					icon={Icons.SearchX}
					message="Nothing matches."
					ctaLabel="Clear search and filter"
					onCta={clearFilters}
				/>
			{:else}
				<!-- The models, flat: the filter box counts them and the
				     chip says the scope, so no heading of its own. -->
				<section class="flex flex-col gap-1" aria-label="Models">
					<p class="sr-only" aria-live="polite">
						{modelsSummaryLine(visible.length, scope)}
					</p>
					<div class="flex flex-col gap-1" role="list">
						{#each visible as entry (`${entry.connectionId}:${entry.model.id}`)}
							{@const useInGroups = useInGroupsOf?.(entry) ?? null}
							<!-- The row's *Use in…*: the loadouts of the jobs
							     this model can do. -->
							{#snippet useInMenu()}
								<UseInMenu
									groups={useInGroups ?? []}
									modelName={entry.displayName}
									onPick={(item) => onUseIn?.(entry, item)}
									{onOpenLoadouts}
								/>
							{/snippet}
							<div role="listitem">
								<ModelRow
									model={entry.model}
									chip={connectionChip(entry)}
									defaultFor={defaultForOf(entry)}
									note={noteOf(entry)}
									canUse={canUse(entry)}
									useLabel={ctx.useLabelOf(entry.model)}
									selected={selected?.connectionId ===
										entry.connectionId &&
										selected?.modelId === entry.model.id}
									onOpen={() =>
										onOpenModel(
											entry.connectionId,
											entry.model.id
										)}
									onUse={() => use(entry)}
									useMenu={useInGroups ? useInMenu : undefined}
								/>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/if}

		{#if isAdmin && !isLoading}
			<MattingModelRow />
		{/if}

		{#if trayCount > 0 || trayOpen}
			<!-- Pinned at the foot of the list pane's scroller while anything
			     is arriving, or while its list is open. -->
			<div class="sticky bottom-0 mt-auto">
				<DownloadsTray
					count={trayCount}
					percent={trayPercent}
					bind:open={trayOpen}
				/>
			</div>
		{/if}
	</div>
{/snippet}

{#if frame}
	{@render frame(listToolbar, listBody)}
{:else}
	<div class="flex h-full min-h-0 flex-col gap-3">
		{@render listToolbar()}
		<div class="min-h-0 flex-1 overflow-y-auto">
			{@render listBody()}
		</div>
	</div>
{/if}
