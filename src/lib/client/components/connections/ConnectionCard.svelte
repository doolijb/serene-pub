<script lang="ts">
	/**
	 * One ENDPOINT as a group in the index — its name, what it is doing right
	 * now, and its models as rows beneath it.
	 *
	 * The models come in on the list row (`connections:list` carries them), so
	 * a group never fetches: the index is one message and one render, and
	 * search sees every model before any card has "loaded".
	 *
	 * ## Shaped by kind, in the same four slots
	 *
	 * Header, status, health, rows, footer — every group, every kind. What
	 * differs is what each slot SAYS: a managed KoboldCPP has a process to
	 * start and one GGUF resident, a local ONNX lane has files on disk and one
	 * model app-wide, an API endpoint has a list somebody may need to add to.
	 * `endpointKind` picks the shape (see `modelManagement`), so the branch is
	 * one named value rather than a type test per line.
	 *
	 * ⚠ **A silent status is no line at all.** Every one of these facts comes
	 * from an event the server may not answer — a manager switched off, a host
	 * that is down, a build whose handler is not written yet. Where the answer
	 * has not come, the slot is EMPTY: no placeholder, no spinner, no "unknown".
	 * A group must degrade to the header it always had rather than to a screen
	 * full of things claiming to be loading forever.
	 *
	 * ## Two clicks are still the whole map
	 *
	 * The header opens the connection, a row opens the model. Everything else
	 * here is one press with one outcome — Start, Stop, Load, Unload, Download,
	 * Cancel — or a door to the manager that owns the files.
	 */
	import * as Icons from "@lucide/svelte"
	import { Menu, Portal } from "@skeletonlabs/skeleton-svelte"
	import ModelRow from "./ModelRow.svelte"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import {
		endpointKind,
		formatBytes,
		isLocalOnnxType,
		isOnnxKind,
		managerFor,
		manualAddAllowed,
		modelsSourceHint,
		orderOnnxRows,
		rowAction,
		type RowAction
	} from "./modelManagement"
	import {
		idleMinutes,
		type KcppStatus,
		type LaneStatus,
		type OllamaStatus
	} from "./endpointStatus"
	import {
		systemCapabilitiesForModel,
		type CapabilityDefaultRef
	} from "./modelSystemDefaults"
	import { sectionForModality } from "$lib/shared/constants/connectionSections"

	type Row = Sockets.Connections.List.Row & { id: number }
	type ModelOf = Row["models"][number]

	interface Props {
		connection: Row
		/** The rows the index's filter kept — a subset of `connection.models`. */
		models: ModelOf[]
		serviceLabel: string
		/** Managed type with its manager switched off — cannot run. */
		manageDisabled: boolean
		capabilityDefaults?: Record<string, CapabilityDefaultRef | undefined>
		/** A sync is in flight for this endpoint. */
		syncing: boolean
		/** Scrolled to and briefly highlighted (came back from its own view). */
		focused?: boolean
		/** The managed KoboldCPP process, or null while it has not answered. */
		kcpp?: KcppStatus | null
		/** The Ollama host, or null while it has not answered. */
		ollama?: OllamaStatus | null
		/** This local ONNX lane's residency, or null while it has not answered. */
		lane?: LaneStatus | null
		/** The Hub form's last refusal for this endpoint. */
		hubError?: string | null
		onOpen: () => void
		onOpenModel: (model: ModelOf) => void
		onRefresh: () => void
		onManage: (panel: "ollama" | "koboldcpp") => void
		onAddModel: (model: string, name: string) => void
		/** One press on a row's one action. The verb says what to emit. */
		onRowAction?: (model: ModelOf, action: RowAction) => void
		onKcppStart?: () => void
		onKcppStop?: () => void
		onLaneUnload?: () => void
		onAddHubModel?: (hubId: string) => void
	}
	let {
		connection,
		models,
		serviceLabel,
		manageDisabled,
		capabilityDefaults = {},
		syncing,
		focused = false,
		kcpp = null,
		ollama = null,
		lane = null,
		hubError = null,
		onOpen,
		onOpenModel,
		onRefresh,
		onManage,
		onAddModel,
		onRowAction,
		onKcppStart,
		onKcppStop,
		onLaneUnload,
		onAddHubModel
	}: Props = $props()

	const kind = $derived(endpointKind(connection.type))
	const manager = $derived(managerFor(connection.type))
	const canAdd = $derived(manualAddAllowed(connection.type))
	const hint = $derived(modelsSourceHint(connection.type))
	const missingCount = $derived(
		connection.models.filter((m) => m.missingSince != null).length
	)
	const hiddenCount = $derived(connection.models.length - models.length)

	/** The section's mark, or the generic one for a modality nothing declares. */
	const HeaderIcon = $derived(
		((Icons as any)[
			sectionForModality(connection.modality)?.icon ?? ""
		] as any) ?? Icons.Cable
	)
	/** One badge, saying where the compute is rather than what it does. */
	const badge = $derived(
		manager ? "Managed" : isLocalOnnxType(connection.type) ? "ONNX" : "API"
	)

	/** The kinds whose own health line replaces the generic "n models · checked". */
	const ownsHealthLine = $derived(
		kind === "koboldcpp-managed" || kind === "ollama" || isOnnxKind(kind)
	)

	/** Just the host — a URL's scheme and trailing slash are noise here. */
	const host = $derived.by(() => {
		const raw = connection.baseUrl?.trim()
		if (!raw) return ""
		try {
			const u = new URL(raw)
			return (
				u.host +
				(u.pathname !== "/" ? u.pathname.replace(/\/$/, "") : "")
			)
		} catch {
			return raw
		}
	})

	// ── KoboldCPP: the process, and the files it is working on ──────────────
	const loadedFiles = $derived(new Set(kcpp?.loadedFiles ?? []))
	const kcppRunning = $derived(kcpp?.run === "running")
	/** The unfinished download naming this row's file, if there is one. */
	function kcppDownloadFor(model: ModelOf) {
		const entry = kcpp?.downloads.find((d) => d.filename === model.model)
		return entry
			? { downloaded: entry.downloaded, total: entry.total }
			: null
	}
	const kcppStatusText = $derived.by(() => {
		if (!kcpp?.run) return null
		switch (kcpp.run) {
			case "running": {
				const file = kcpp.loadedFiles[0]
				return file ? `Running · ${file}` : "Running"
			}
			case "starting":
				return "Starting"
			case "stopping":
				return "Stopping"
			case "crashed":
				return "Crashed"
			default:
				return "Stopped"
		}
	})
	const kcppDot = $derived(
		kcpp?.run === "running"
			? "bg-success-500"
			: kcpp?.run === "crashed"
				? "bg-error-500"
				: kcpp?.run === "starting" || kcpp?.run === "stopping"
					? "bg-warning-500"
					: "bg-surface-400-600"
	)
	const kcppHealthText = $derived.by(() => {
		if (kind !== "koboldcpp-managed") return null
		const parts = [
			`${connection.models.length} ${connection.models.length === 1 ? "GGUF" : "GGUFs"} on disk`
		]
		const downloading = kcpp?.downloads.length ?? 0
		if (downloading) parts.push(`${downloading} downloading`)
		if (connection.modelsSync.at)
			parts.push(`checked ${timeAgo(connection.modelsSync.at)}`)
		return parts.join(" · ")
	})

	// ── Ollama: the host ────────────────────────────────────────────────────
	const runningModels = $derived(new Set(ollama?.running ?? []))
	const ollamaStatusText = $derived.by(() => {
		if (!ollama || ollama.reachable == null) return null
		if (!ollama.reachable) return "Not reachable"
		const version = ollama.version ? ` ${ollama.version}` : ""
		const n = ollama.running.length
		return `Running${version} · ${n} resident`
	})
	/** Same shape as the generic health line, in the dedicated slot below the
	 *  status line rather than above it (health slot: sub line → status →
	 *  health, matching the ONNX and KoboldCPP groups). */
	const ollamaHealthText = $derived.by(() => {
		if (kind !== "ollama") return null
		const parts = [
			`${connection.models.length} ${connection.models.length === 1 ? "model" : "models"}`
		]
		if (connection.modelsSync.at)
			parts.push(`checked ${timeAgo(connection.modelsSync.at)}`)
		return parts.join(" · ")
	})

	// ── Local ONNX: the lane, and the files on this machine ─────────────────
	const onDiskRows = $derived(
		connection.models.filter((m) => m.local?.state === "on_disk")
	)
	const onDiskBytes = $derived(
		onDiskRows.reduce((sum, m) => sum + (m.local?.sizeBytes ?? 0), 0)
	)
	/** The active model's display name — its row's, or the bare identity. */
	const laneModelName = $derived.by(() => {
		if (!lane?.modelId) return null
		return (
			connection.models.find((m) => m.model === lane.modelId)?.name ??
			lane.modelId
		)
	})
	const laneLoadedRow = $derived(
		connection.models.find((m) => m.model === lane?.modelId)
	)
	const laneStatusText = $derived.by(() => {
		if (!lane || !laneModelName) return null
		if (lane.loaded) {
			const minutes = idleMinutes(lane.lastUsedAt)
			return minutes == null
				? `Active: ${laneModelName} · loaded`
				: `Active: ${laneModelName} · loaded, idle ${minutes} min`
		}
		return laneLoadedRow?.local?.state === "on_disk"
			? `Active: ${laneModelName} · on disk, not loaded`
			: `Active: ${laneModelName} · not loaded`
	})
	const laneHealthText = $derived.by(() => {
		if (!isOnnxKind(kind)) return null
		const parts = [`${onDiskRows.length} on disk`]
		const size = onDiskRows.length ? formatBytes(onDiskBytes) : null
		if (size) parts.push(size)
		if (lane?.pending != null) {
			if (kind === "onnx-entities")
				parts.push(
					lane.pending
						? `${lane.pending} messages waiting`
						: "nothing waiting"
				)
			else
				parts.push(
					lane.pending ? `${lane.pending} waiting` : "queue idle"
				)
		}
		return parts.join(" · ")
	})
	const laneInfoText = $derived(
		kind === "onnx-entities"
			? "One active model app-wide. Switching re-scans stored messages for names."
			: "One active model app-wide. Switching re-embeds every stored vector, so the switch asks first and tells you the cost."
	)

	// ── Rows, and the one action each offers ────────────────────────────────
	function actionFor(model: ModelOf): RowAction | null {
		return rowAction(
			kind,
			{ model: model.model, local: model.local },
			{
				isDefault:
					systemCapabilitiesForModel(
						capabilityDefaults,
						connection.id,
						model.id
					).length > 0,
				kcppLoaded: loadedFiles.has(model.model),
				kcppDownloading: !!kcppDownloadFor(model)
			}
		)
	}

	/**
	 * The recommended list's three tiers, then whatever a person added.
	 *
	 * Grouped rather than sorted flat: the tiers ARE the recommendation — "the
	 * small one", "the good one", "the big one" — and a person picking their
	 * first embedding model is choosing between three sizes, not reading ten
	 * names.
	 */
	const TIER_LABELS: Record<string, string> = {
		fast: "Fast",
		balanced: "Balanced",
		best: "Best"
	}
	const tieredGroups = $derived.by(() => {
		if (!isOnnxKind(kind)) return null
		return orderOnnxRows(models).map((group) => ({
			key: group.tier,
			label: TIER_LABELS[group.tier] ?? "Added by you",
			models: group.rows
		}))
	})

	// ── The two inline forms ────────────────────────────────────────────────
	let adding = $state(false)
	let newModel = $state("")
	let newName = $state("")
	function submitAdd() {
		if (!newModel.trim()) return
		onAddModel(newModel, newName)
		newModel = ""
		newName = ""
		adding = false
	}
	function cancelAdd() {
		adding = false
		newModel = ""
		newName = ""
	}

	/** The ONNX add: a Hub id the server validates before a row exists. */
	let addingHub = $state(false)
	let hubId = $state("")
	function submitHub() {
		if (!hubId.trim()) return
		onAddHubModel?.(hubId.trim())
	}
	function cancelHub() {
		addingHub = false
		hubId = ""
	}

	const menuItem =
		"hover:preset-tonal-primary data-[highlighted]:preset-tonal-primary flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"

	let el = $state<HTMLElement | null>(null)
	$effect(() => {
		if (focused && el)
			el.scrollIntoView({ block: "center", behavior: "smooth" })
	})
</script>

{#snippet statusLine(dot: string, text: string)}
	<span class="flex min-w-0 items-center gap-1.5 text-[11px]">
		<span
			class="size-1.5 shrink-0 rounded-full {dot}"
			aria-hidden="true"
		></span>
		<span class="truncate">{text}</span>
	</span>
{/snippet}

{#snippet infoLine(text: string)}
	<p class="text-muted flex items-start gap-1.5 px-1.5 text-[11px]">
		<Icons.Info size={11} class="mt-0.5 shrink-0" aria-hidden="true" />
		<span class="min-w-0">{text}</span>
	</p>
{/snippet}

{#snippet rowsFor(list: ModelOf[])}
	{#each list as m (m.id)}
		<ModelRow
			row={m}
			systemCapabilities={systemCapabilitiesForModel(
				capabilityDefaults,
				connection.id,
				m.id
			)}
			action={actionFor(m)}
			loaded={kind === "koboldcpp-managed" && loadedFiles.has(m.model)}
			resident={kind === "ollama" && runningModels.has(m.model)}
			kcppDownload={kind === "koboldcpp-managed"
				? kcppDownloadFor(m)
				: null}
			onOpen={() => onOpenModel(m)}
			onAction={(action) => onRowAction?.(m, action)}
		/>
	{/each}
{/snippet}

<section
	bind:this={el}
	id={`connection-group-${connection.id}`}
	class="card flex flex-col gap-1.5 rounded-xl p-2.5 transition-shadow {focused
		? 'preset-filled-surface-200-800'
		: 'preset-filled-surface-100-900'}"
	aria-label={`Connection ${connection.name}`}
>
	<header class="flex items-start gap-1.5">
		<span
			class="preset-tonal-surface mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg"
			aria-hidden="true"
		>
			<HeaderIcon size={18} />
		</span>
		<button
			type="button"
			class="hover:preset-tonal-primary focus-visible:ring-primary-500 min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
			onclick={onOpen}
			title="Open this connection"
		>
			<span class="flex items-center gap-1.5">
				<span class="truncate text-sm font-semibold">
					{connection.name}
				</span>
				<span
					class="preset-tonal-surface text-muted shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
				>
					{badge}
				</span>
				{#if manageDisabled}
					<span
						class="preset-filled-error-500 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
						title="Its manager is switched off, so this connection cannot run."
					>
						Manager off
					</span>
				{/if}
			</span>
			<span class="text-muted block truncate text-xs">
				{#if isOnnxKind(kind)}
					Runs inside Serene Pub · {kind === "onnx-entities"
						? "loads on use"
						: "no server to run"}
				{:else}
					{serviceLabel}{host ? ` · ${host}` : ""}
				{/if}
			</span>
			<!-- The generic health line. Silent where the kind has one of its
			     own; an error or a missing model is loud on every kind. -->
			{#if syncing}
				<span class="text-muted flex items-center gap-1 text-[11px]">
					<Icons.Loader2
						size={11}
						class="animate-spin"
						aria-hidden="true"
					/>
					Checking models…
				</span>
			{:else if connection.modelsSync.error}
				<span
					class="text-warning-500 flex items-center gap-1 text-[11px]"
					title={connection.modelsSync.error}
				>
					<Icons.TriangleAlert size={11} aria-hidden="true" />
					<span class="truncate">
						Couldn't list models — {connection.modelsSync.error}
					</span>
				</span>
			{:else if missingCount}
				<span
					class="text-warning-500 flex items-center gap-1 text-[11px]"
				>
					<Icons.TriangleAlert size={11} aria-hidden="true" />
					{missingCount} of {connection.models.length}
					{connection.models.length === 1 ? "model" : "models"} no longer
					listed
				</span>
			{:else if !ownsHealthLine && connection.modelsSync.at}
				<span class="text-muted flex items-center gap-1 text-[11px]">
					<Icons.Check size={11} aria-hidden="true" />
					{connection.models.length}
					{connection.models.length === 1 ? "model" : "models"} · checked
					{timeAgo(connection.modelsSync.at)}
				</span>
			{:else if !ownsHealthLine}
				<span class="text-muted text-[11px]">Not checked yet</span>
			{/if}
		</button>
		<Menu
			onSelect={(details) => {
				if (details.value === "open") onOpen()
				else if (details.value === "refresh") onRefresh()
				else if (details.value === "add") adding = true
				else if (details.value === "manage" && manager)
					onManage(manager.panel)
			}}
		>
			<Menu.Trigger
				class="btn-icon btn-icon-sm hover:preset-tonal-surface shrink-0"
				title={`Actions for ${connection.name}`}
				aria-label={`Actions for ${connection.name}`}
			>
				<Icons.EllipsisVertical size={14} />
			</Menu.Trigger>
			<Portal>
				<Menu.Positioner class="z-[1000]!">
					<Menu.Content
						class="card preset-filled-surface-100-900 max-w-[90vw] min-w-52 overflow-y-auto p-1 shadow-xl"
					>
						<Menu.Item value="open" class={menuItem}>
							<Icons.Settings2 size={12} aria-hidden="true" />
							<Menu.ItemText>Open connection</Menu.ItemText>
						</Menu.Item>
						<Menu.Item
							value="refresh"
							class={menuItem}
							disabled={syncing}
						>
							<Icons.RefreshCw size={12} aria-hidden="true" />
							<Menu.ItemText>Refresh models</Menu.ItemText>
						</Menu.Item>
						{#if canAdd}
							<Menu.Item value="add" class={menuItem}>
								<Icons.Plus size={12} aria-hidden="true" />
								<Menu.ItemText>
									Add a model by name
								</Menu.ItemText>
							</Menu.Item>
						{/if}
						{#if manager}
							<Menu.Item
								value="manage"
								class={menuItem}
								disabled={manageDisabled}
							>
								<Icons.ExternalLink
									size={12}
									aria-hidden="true"
								/>
								<Menu.ItemText>
									<span
										title={manageDisabled
											? `Enable the ${manager.label} in Settings first`
											: `Pull, download and remove models in the ${manager.label}`}
									>
										Open {manager.label}
									</span>
								</Menu.ItemText>
							</Menu.Item>
						{/if}
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
	</header>

	<!-- The status slot. Empty until the server has answered — a group that
	     cannot say what a process is doing says nothing about it. -->
	{#if kind === "koboldcpp-managed" && kcppStatusText}
		<div class="flex items-center gap-2 px-1.5">
			{@render statusLine(kcppDot, kcppStatusText)}
			<div class="flex-1"></div>
			{#if kcppRunning}
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600 shrink-0 text-[11px]"
					onclick={() => onKcppStop?.()}
				>
					Stop
				</button>
			{:else if kcpp?.run === "stopped" || kcpp?.run === "crashed"}
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600 shrink-0 text-[11px]"
					disabled={manageDisabled}
					onclick={() => onKcppStart?.()}
				>
					Start
				</button>
			{/if}
		</div>
	{:else if kind === "ollama" && ollamaStatusText}
		<div class="px-1.5">
			{@render statusLine(
				ollama?.reachable ? "bg-success-500" : "bg-warning-500",
				ollamaStatusText
			)}
		</div>
	{:else if isOnnxKind(kind) && laneStatusText}
		<div class="flex items-center gap-2 px-1.5">
			{@render statusLine(
				lane?.loaded ? "bg-success-500" : "bg-surface-400-600",
				laneStatusText
			)}
			<div class="flex-1"></div>
			{#if lane?.loaded}
				<button
					type="button"
					class="btn btn-sm hover:preset-tonal-surface text-muted shrink-0 text-[11px]"
					onclick={() => onLaneUnload?.()}
					title="Unload it now. It comes back when there is work."
				>
					Unload
				</button>
			{/if}
		</div>
	{/if}

	<!-- The health slot: what is on disk, and what is moving. -->
	{#if kind === "koboldcpp-managed" && kcppHealthText}
		<p class="text-muted px-1.5 text-[11px]">{kcppHealthText}</p>
	{:else if kind === "ollama" && ollamaHealthText}
		<p class="text-muted px-1.5 text-[11px]">{ollamaHealthText}</p>
	{:else if isOnnxKind(kind) && laneHealthText}
		<p class="text-muted px-1.5 text-[11px]">{laneHealthText}</p>
	{/if}

	<!-- The info slot: the one thing about this kind that surprises people. -->
	{#if kind === "koboldcpp-managed"}
		{@render infoLine(
			"One GGUF loaded at a time. Load swaps the running model — a few seconds, and the chat default follows the loaded model."
		)}
	{:else if isOnnxKind(kind)}
		{@render infoLine(laneInfoText)}
	{/if}

	{#if connection.notes}
		<p class="text-muted line-clamp-2 px-1.5 text-xs break-words">
			{connection.notes}
		</p>
	{/if}

	{#if !connection.models.length}
		<p class="text-muted px-1.5 pb-1 text-xs italic">
			{#if connection.modelsSync.error}
				No models yet — fix the connection and refresh.
			{:else if connection.modelsSync.at}
				The host lists no models.{hint ? ` ${hint}` : ""}
			{:else}
				No models yet. Refresh to ask the host.
			{/if}
		</p>
	{:else if !models.length}
		<p class="text-muted px-1.5 pb-1 text-xs italic">
			No models here match the filter.
		</p>
	{:else if tieredGroups}
		<div class="flex flex-col gap-1.5">
			{#each tieredGroups as tier (tier.key)}
				<div>
					<p
						class="text-muted px-2.5 text-[10px] font-medium tracking-wide uppercase"
						id={`tier-${connection.id}-${tier.key}`}
					>
						{tier.label}
					</p>
					<div
						class="flex flex-col"
						role="list"
						aria-labelledby={`tier-${connection.id}-${tier.key}`}
					>
						{@render rowsFor(tier.models)}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col" role="list" aria-label="Models">
			{@render rowsFor(models)}
		</div>
	{/if}

	{#if models.length && hiddenCount > 0}
		<p class="text-muted px-2.5 text-[11px]">
			{hiddenCount} more hidden by the filter
		</p>
	{/if}

	<!-- The footer: the door out of this group, and what is behind it. -->
	{#if kind === "koboldcpp-managed"}
		<p class="text-muted px-1.5 text-[11px]">
			Start downloads, tune performance and launch settings in the
			<button
				type="button"
				class="anchor"
				disabled={manageDisabled}
				onclick={() => onManage("koboldcpp")}
			>
				KoboldCPP Manager ↗
			</button>
		</p>
	{:else if kind === "ollama"}
		<p class="text-muted px-1.5 text-[11px]">
			Pull, update and remove in the
			<button
				type="button"
				class="anchor"
				onclick={() => onManage("ollama")}
			>
				Ollama Manager ↗
			</button>
			— this list follows it.
		</p>
	{:else if isOnnxKind(kind)}
		{#if !addingHub}
			<p class="text-muted px-1.5 text-[11px]">
				Not on the list?
				<button
					type="button"
					class="anchor"
					onclick={() => (addingHub = true)}
				>
					Add from Hugging Face…
				</button>
				— validated against the Hub before it becomes a row.
			</p>
		{/if}
	{:else if canAdd && !adding}
		<p class="text-muted px-1.5 text-[11px]">
			<button
				type="button"
				class="anchor"
				onclick={() => (adding = true)}
			>
				Add a model by name
			</button>
			— for a model the listing lags behind.
		</p>
	{/if}

	{#if addingHub}
		<form
			class="border-surface-300-700 mt-1 flex flex-col gap-1.5 rounded-lg border p-2"
			onsubmit={(e) => {
				e.preventDefault()
				submitHub()
			}}
		>
			<label class="text-xs font-medium" for={`hub-${connection.id}`}>
				Add from Hugging Face
			</label>
			<input
				id={`hub-${connection.id}`}
				class="input text-xs"
				placeholder="org/name"
				bind:value={hubId}
			/>
			{#if hubError}
				<p class="text-warning-500 text-[11px]">{hubError}</p>
			{/if}
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={cancelHub}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500"
					disabled={!hubId.trim()}
				>
					Add
				</button>
			</div>
		</form>
	{/if}

	{#if adding}
		<form
			class="border-surface-300-700 mt-1 flex flex-col gap-1.5 rounded-lg border p-2"
			onsubmit={(e) => {
				e.preventDefault()
				submitAdd()
			}}
		>
			<label
				class="text-xs font-medium"
				for={`add-model-${connection.id}`}
			>
				Add a model by name
			</label>
			<input
				id={`add-model-${connection.id}`}
				class="input text-xs"
				placeholder="What the service calls it — e.g. gpt-4o"
				bind:value={newModel}
			/>
			<input
				class="input text-xs"
				placeholder="Display name (optional)"
				bind:value={newName}
				aria-label="Display name"
			/>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={cancelAdd}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500"
					disabled={!newModel.trim()}
				>
					Add
				</button>
			</div>
		</form>
	{/if}
</section>
