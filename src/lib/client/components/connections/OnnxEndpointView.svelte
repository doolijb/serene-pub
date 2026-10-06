<script lang="ts">
	import type { Snippet } from "svelte"
	/**
	 * A LOCAL ONNX endpoint's own header — what the lane is doing, and (at desk
	 * width) every model it can reach in one table.
	 *
	 * ## Why this endpoint gets a table and no other does
	 *
	 * Every other endpoint's models are a list of names: one fact each, and the
	 * choice between them is made somewhere else. These are a shopping
	 * decision — size against dimensions against input length against
	 * languages, with one of them costing a re-embed of everything stored — and
	 * a person cannot make it by opening seven models one at a time. So the
	 * facts are columns, sorted cheapest-first inside each tier.
	 *
	 * At compact width the same rows are a stacked list (`ModelRow`). The dock
	 * once showed none, pointing at "the sidebar index" — which stopped listing
	 * models with R1, so the dock had no way to download or switch (plan
	 * 2026-09-24 C3).
	 *
	 * ## Tabs, like every managed runtime (2026-09-25)
	 *
	 * **Models · Get · Arriving.** What could be downloaded never sits INLINE
	 * under what is already here: every endpoint answers "where do I get a
	 * model?" the same way KoboldCPP and Ollama do, with a **Get** tab
	 * (plan 2026-09-24 C3). The tab holds the same `ModelFinderView`
	 * they open, scoped to this connection, and **Arriving** the same
	 * `DownloadsView`: one idiom, three destinations.
	 *
	 * ⚠ The table therefore lists only what is **on this machine**
	 * (`splitByPresence().here`). Comparing a model you have against one you
	 * could fetch now means opening Get — which is the trade the tabs make, and
	 * the same one the managed runtimes already made.
	 *
	 * ⚠ **The connection's own form is the Settings tab** (2026-09-25), handed
	 * down as `connectionSettings` — the same snippet pattern the managed view
	 * uses. Other endpoints keep it BELOW their view; a fourth tab labelled Settings with the settings underneath instead
	 * would be the worst of both. The sidebar still owns the form and its
	 * unsaved-changes bar, so an edit survives switching tabs.
	 *
	 * ⚠ **Make active is not emitted here.** It is the capability-default
	 * registration (§10), raised so the sidebar's costed confirmation appears.
	 * Downloading switches nothing — which is the one sentence on this screen
	 * that people most need, and why it is in the info line rather than a
	 * tooltip.
	 *
	 * ⚠ **On a machine whose ONNX runtime didn't load** the endpoint still
	 * opens — the row is real, and a later build may run it — but it says why
	 * at the top and offers no Download or Retry: each would be refused with
	 * the same sentence (`localOnnxRefusal` on the server).
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { sectionForModality } from "$lib/shared/constants/connectionSections"
	import { idleMinutes } from "./endpointStatus"
	import {
		formatBytes,
		formatMegabytes,
		formatTokens
	} from "./modelManagement"
	import {
		onnxModelHeadline,
		onnxSizeLabel,
		splitByPresence,
		type OnnxModality
	} from "./onnxModelFacts"
	import { useLaneStatus } from "./useLaneStatus.svelte"
	import ModelRowItem from "./ModelRow.svelte"
	import ModelFinderView from "./ModelFinderView.svelte"
	import DownloadsView from "./DownloadsView.svelte"
	import PanelTabStrip from "$lib/client/components/panels/PanelTabStrip.svelte"
	import type { CapabilityDefaultRef } from "./modelSystemDefaults"
	import { localOnnxDisabledReason } from "$lib/shared/utils/connectionServiceItems"

	type ModelRow = Sockets.Connections.Models.ModelRow

	interface Props {
		/**
		 * This connection's own form — name, notes, the lane's TTL, Delete —
		 * handed down by the sidebar and rendered in the Settings TAB.
		 *
		 * ⚠ Other endpoints keep it BELOW their view. A local ONNX endpoint
		 * wears the managed runtimes' four tabs, and
		 * a fourth tab labelled Settings with the settings underneath it
		 * instead would be the worst of both.
		 */
		connectionSettings?: Snippet
		/** The endpoint, with its models, out of the sidebar's own list. */
		connection: Sockets.Connections.List.Row
		capabilityDefaults?: Record<string, CapabilityDefaultRef | undefined>
		/** The shell's width mode. Compact is also the phone view. */
		mode: "desk" | "compact"
		/** Every lane handler behind the status pills is `requireAdmin`. */
		isAdmin?: boolean
		onOpenModel: (model: ModelRow) => void
		/** ⚠ The costed registration, raised — never a write from here. */
		onMakeActive: (model: ModelRow) => void
		onDownload: (model: ModelRow) => void
		onCancel: (model: ModelRow) => void
		onRetry: (model: ModelRow) => void
	}
	let {
		connectionSettings,
		connection,
		capabilityDefaults = {},
		mode,
		isAdmin = false,
		onOpenModel,
		onMakeActive,
		onDownload,
		onCancel,
		onRetry
	}: Props = $props()

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
	/** Why nothing can download here, or null when it can. */
	const unavailable = $derived(
		localOnnxDisabledReason(
			systemSettingsCtx?.settings?.localOnnxAvailability
		)
	)

	const modality = $derived<OnnxModality>(
		connection.type === CONNECTION_TYPE.LOCAL_ONNX_NER ||
			connection.modality === "ner"
			? "ner"
			: "embeddings"
	)
	const section = $derived(sectionForModality(modality))
	const isEmbeddings = $derived(modality === "embeddings")
	/** The section's mark — the same one the index card wears. */
	const SectionIcon = $derived(
		((Icons as any)[section?.icon ?? ""] as any) ?? Icons.Cable
	)

	const lane = useLaneStatus(
		() => modality,
		() => isAdmin
	)

	const models = $derived(connection.models ?? [])
	const activeModelId = $derived(
		section ? capabilityDefaults[section.starCapability] : undefined
	)
	const isActiveRow = (model: ModelRow) =>
		activeModelId?.connectionId === connection.id &&
		activeModelId?.connectionModelId === model.id
	const activeModel = $derived(models.find((m) => isActiveRow(m)) ?? null)

	const split = $derived(splitByPresence(models, isActiveRow))

	/**
	 * Which half of the endpoint is on show.
	 *
	 * ⚠ **A tab, not a fold** (2026-09-25). A disclosure under what is already
	 * here would answer "where do I get a model?" differently from every
	 * managed runtime, which has a **Get** tab (plan 2026-09-24 C3). One idiom, three
	 * destinations: the tab holds the same `ModelFinderView` KoboldCPP and
	 * Ollama open, scoped to this connection.
	 */
	let tab = $state("models")

	/** This endpoint's files still arriving, for the Arriving tab's dot. */
	const arriving = $derived(
		models.filter((m) => m.local?.state === "downloading").length
	)

	const onnxTabs = $derived([
		{ value: "models", label: "Models", icon: Icons.Package },
		{ value: "get", label: "Get", icon: Icons.Search },
		{
			value: "downloads",
			label: "Arriving",
			icon: Icons.Download,
			hasActivity: arriving > 0
		},
		{ value: "settings", label: "Settings", icon: Icons.Settings }
	])
	/** The chip on the active row: "Active", the word these lanes use. */
	const activeWord = "Active"

	/** How much of this endpoint's list is actually on this machine. */
	const onDisk = $derived(models.filter((m) => m.local?.state === "on_disk"))
	const onDiskBytes = $derived(
		onDisk.reduce((sum, m) => sum + (m.local?.sizeBytes ?? 0), 0)
	)

	const idle = $derived(idleMinutes(lane.status?.lastUsedAt))
	const loaded = $derived(lane.status?.loaded ?? false)

	/** "loaded, idle 4 min" / "on disk, not loaded" / "not downloaded". */
	const activeResidency = $derived.by(() => {
		if (loaded) return idle != null ? `loaded, idle ${idle} min` : "loaded"
		const state = activeModel?.local?.state
		if (state === "on_disk") return "on disk, not loaded"
		if (state === "downloading") return "downloading"
		if (state === "error") return "download failed"
		return "not downloaded"
	})

	function unloadNow() {
		if (isEmbeddings) socket.emit("vectorization:unloadModel", {})
		else socket.emit("ner:unloadModel", {})
	}

	// ── The table's cells ───────────────────────────────────────────────────
	const sizeCell = (model: ModelRow) =>
		onnxSizeLabel(model.local) ??
		formatMegabytes(model.local?.catalog?.sizeMb) ??
		"—"
	const measureCell = (model: ModelRow) =>
		isEmbeddings
			? model.local?.catalog?.dimensions
				? String(model.local.catalog.dimensions)
				: "—"
			: (model.local?.catalog?.labels?.join(" · ") ?? "—")
	const inputCell = (model: ModelRow) => {
		const tokens = formatTokens(model.local?.catalog?.maxInputTokens)
		return tokens ? `${tokens} tokens` : "—"
	}
	const languagesCell = (model: ModelRow) =>
		model.local?.catalog?.languages ?? "—"

	/** The state chip, or null while the bar is what the cell shows instead. */
	function stateChip(model: ModelRow) {
		const active = isActiveRow(model)
		// ⚠ Residency comes from the LANE on the active row: the row's own flag
		// is a copy the sync refreshes on its own schedule, and a chip saying
		// "not loaded" beside a pill saying "loaded, idle 4 min" is one screen
		// contradicting itself.
		const state =
			active && model.local && lane.status
				? { ...model.local, loaded: lane.status.loaded }
				: model.local
		const headline = onnxModelHeadline(state, active)
		if (model.local?.state === "downloading") return null
		const preset = active
			? "preset-tonal-primary"
			: model.local?.state === "on_disk"
				? "preset-tonal-success"
				: model.local?.state === "error"
					? "preset-tonal-warning"
					: "border-surface-300-700 text-surface-600-400 border"
		return { label: headline.text, preset }
	}

	/**
	 * The ONE action a row offers. Mirrors `rowAction` in spirit, spelled out
	 * here because the table's active row shows no action at all — there is
	 * nothing left to ask of the model already in charge.
	 *
	 * Where the runtime didn't load, Make active stays on a downloaded row,
	 * disabled with the reason (`disabledReason`): the server refuses the
	 * star with the same sentence, and the files are real. Download and Retry
	 * give way entirely — the warning above already says why.
	 */
	function rowVerb(
		model: ModelRow
	): { label: string; press: () => void; disabledReason?: string } | null {
		if (isActiveRow(model)) return null
		switch (model.local?.state) {
			case "on_disk":
				return {
					label: "Make active",
					press: () => {
						if (!unavailable) onMakeActive(model)
					},
					...(unavailable ? { disabledReason: unavailable } : {})
				}
			case "downloading":
				return { label: "Cancel", press: () => onCancel(model) }
			case "error":
				return unavailable
					? null
					: { label: "Retry", press: () => onRetry(model) }
			case "not_downloaded":
				return unavailable
					? null
					: { label: "Download", press: () => onDownload(model) }
			default:
				// The server has not answered for this row; an action guessed
				// from silence is one that fails on press.
				return null
		}
	}

	function percentOf(model: ModelRow): number {
		return onnxModelHeadline(model.local, false).percent ?? 0
	}

	const columns = $derived(
		isEmbeddings
			? ["Model", "Size", "Dimensions", "Input", "Languages", "State", ""]
			: ["Model", "Size", "Labels", "Input", "Languages", "State", ""]
	)

	const infoLine = $derived(
		isEmbeddings
			? "One active model app-wide. Switching re-embeds every stored vector — the switch asks first and names the cost. Downloading never switches anything."
			: "One active model app-wide. Switching re-scans every stored message — the switch asks first and names the cost. Downloading never switches anything."
	)
</script>

<div class="mb-4 flex flex-col gap-3">
	<!-- The endpoint, as a thing that runs here rather than a thing you dial.
	     The name and the ONNX chip are the pane header's; repeating them here
	     put the title on screen twice (plan 2026-09-24 C8). -->
	<p class="text-surface-600-400 flex items-center gap-2 text-xs">
		<SectionIcon size={14} aria-hidden="true" />
		Runs inside Serene Pub · no server to run · loads on use
	</p>

	{#if unavailable}
		<p
			class="preset-tonal-warning flex items-start gap-2 rounded-lg p-2 text-xs break-words"
		>
			<Icons.TriangleAlert
				size={14}
				class="mt-0.5 shrink-0"
				aria-hidden="true"
			/>
			<span class="min-w-0">{unavailable}</span>
		</p>
	{/if}

	<!-- The lane, as pills. Each one is a fact the server answered; a lane that
	     has not answered shows none of them rather than a placeholder. -->
	{#if lane.status || onDisk.length}
		<div class="flex flex-wrap items-center gap-2 text-xs">
			{#if lane.status && activeModel}
				<span
					class="preset-tonal-surface inline-flex items-center gap-1.5 rounded-full px-2 py-1"
				>
					<span
						class="size-2 rounded-full {loaded
							? 'bg-success-500'
							: 'bg-surface-400-600'}"
						aria-hidden="true"
					></span>
					Active: {activeModel.name} · {activeResidency}
				</span>
			{:else if lane.status && !lane.status.starred}
				<span
					class="preset-tonal-warning inline-flex items-center gap-1.5 rounded-full px-2 py-1"
				>
					No active model — nothing runs until one is chosen
				</span>
			{/if}
			{#if onDisk.length}
				<span class="preset-tonal-surface rounded-full px-2 py-1">
					{onDisk.length} on disk{onDiskBytes
						? ` · ${formatBytes(onDiskBytes)}`
						: ""}
				</span>
			{/if}
			{#if isEmbeddings && lane.status?.pending != null}
				<span class="preset-tonal-surface rounded-full px-2 py-1">
					{lane.status.pending === 0
						? "queue idle"
						: `${lane.status.pending} waiting`}
				</span>
			{/if}
		</div>
	{/if}

	<div class="flex flex-wrap gap-2">
		{#if loaded}
			<button
				type="button"
				class="btn btn-sm preset-filled-surface-400-600 min-h-11"
				onclick={unloadNow}
			>
				<Icons.PowerOff size={14} aria-hidden="true" />
				Unload now
			</button>
		{/if}
	</div>

	<p class="text-surface-600-400 text-xs">{infoLine}</p>

	{#snippet listRow(model: ModelRow)}
		{@const verb = rowVerb(model)}
		{@const chip = stateChip(model)}
		<ModelRowItem
			{model}
			defaultFor={isActiveRow(model) ? [activeWord] : []}
			note={[
				sizeCell(model) !== "—" ? sizeCell(model) : null,
				isEmbeddings && model.local?.catalog?.dimensions
					? `${model.local.catalog.dimensions} dimensions`
					: null,
				chip ? chip.label : `Downloading ${percentOf(model)}%`
			]
				.filter(Boolean)
				.join(" · ")}
			canUse={!!verb}
			useLabel={verb?.label ?? ""}
			useShortLabel={verb?.label ?? ""}
			useDisabledReason={verb?.disabledReason}
			onOpen={() => onOpenModel(model)}
			onUse={() => verb?.press()}
		/>
	{/snippet}

	<PanelTabStrip
		tabs={onnxTabs}
		bind:value={tab}
		ariaLabel="Local models sections"
		panelIdPrefix="onnx-endpoint"
	/>

	<div
		id="onnx-endpoint-models"
		role="tabpanel"
		aria-labelledby="onnx-endpoint-models-tab"
		hidden={tab !== "models"}
	>
		{#if tab === "models"}
			<!-- What is on this machine, and nothing else. What could be
			     downloaded is the Get tab, the same door every managed
			     runtime has. -->
			{#if mode === "compact"}
				<section class="flex flex-col gap-3 pt-3" aria-label="On this machine">
					{#if split.here.length}
						{#each split.here as model (model.id)}
							{@render listRow(model)}
						{/each}
					{:else}
						{@render nothingHere()}
					{/if}
				</section>
			{:else}
				<div class="overflow-x-auto pt-3">
					<table class="w-full text-left text-xs">
						<thead class="text-surface-600-400">
							<tr>
								{#each columns as column, i (i)}
									<th class="px-2 py-1 font-medium">
										{#if column}
											{column}
										{:else}
											<!-- The action column. Named for a
											     screen reader, blank for an eye. -->
											<span class="sr-only">Action</span>
										{/if}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each split.here as model (model.id)}
								{@render tableRow(model)}
							{:else}
								<tr>
									<td
										colspan={columns.length}
										class="px-2 py-1.5"
									>
										{@render nothingHere()}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	</div>

	<div
		id="onnx-endpoint-get"
		role="tabpanel"
		aria-labelledby="onnx-endpoint-get-tab"
		hidden={tab !== "get"}
	>
		{#if tab === "get"}
			<!-- The ONE finder (R3), scoped to this connection — the same
			     component, cards and all, that KoboldCPP and Ollama open. -->
			<div class="flex flex-col py-3">
				<!-- ⚠ `capability` is NOT optional here. ONNX is a finder
				     destination only under the `embeddings` and `entities`
				     scopes (`SCOPE_KINDS`) — never `chat` — so a Get tab that
				     opened on the default scope would list no ONNX
				     destination at all and offer this endpoint nothing. The
				     lane's own star capability picks the scope, and the two
				     vocabularies already line up: `text->embedding` and
				     `text->entities` are exactly what `FINDER_SCOPES` keys
				     on. -->
				<ModelFinderView
					connectionId={connection.id}
					capability={section?.starCapability}
					inTab
					onBack={() => (tab = "models")}
				/>
			</div>
		{/if}
	</div>

	<div
		id="onnx-endpoint-downloads"
		role="tabpanel"
		aria-labelledby="onnx-endpoint-downloads-tab"
		hidden={tab !== "downloads"}
	>
		{#if tab === "downloads"}
			<!-- The ONE downloads list (R4): every destination, never a
			     per-endpoint copy. -->
			<div class="flex flex-col py-3">
				<DownloadsView embedded onBack={() => (tab = "models")} />
			</div>
		{/if}
	</div>

	<div
		id="onnx-endpoint-settings"
		role="tabpanel"
		aria-labelledby="onnx-endpoint-settings-tab"
		hidden={tab !== "settings"}
	>
		{#if tab === "settings"}
			<div class="flex flex-col gap-3 py-3">
				{@render connectionSettings?.()}
			</div>
		{/if}
	</div>

	{#snippet nothingHere()}
		<!-- The managed runtimes' empty state, word for word in shape: one
		     card, one button, and the button is the Get tab. Adding a model
		     by Hugging Face id lives there too, in the finder — never a
		     second copy of that form here: one way in per endpoint. -->
		<div class="panel-card flex flex-col items-start gap-2">
			<p class="text-sm font-medium">No models yet</p>
			{#if unavailable}
				<!-- The warning above already says why; a Get button here
				     would lead to a finder whose every Get is disabled. -->
				<p class="text-surface-600-400 text-xs">
					Nothing is downloaded to this machine, and nothing can be
					until it can run local models.
				</p>
			{:else}
				<p class="text-surface-600-400 text-xs">
					Nothing is downloaded to this machine. Get one and it appears
					here — it downloads once.
				</p>
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					onclick={() => (tab = "get")}
				>
					<Icons.Download size={15} aria-hidden="true" />
					Get a model
				</button>
			{/if}
		</div>
	{/snippet}

	{#snippet tableRow(model: ModelRow)}
		{@const active = isActiveRow(model)}
		{@const chip = stateChip(model)}
		{@const verb = rowVerb(model)}
		<!-- The row is a click target for the pointer; the
	     name cell is a real button, which is the
	     keyboard and screen-reader path. -->
		<!-- The lamp is a LEFT BAR here, not the ring the
	     cards wear: Tailwind's preflight collapses
	     table borders, and a collapsed table paints
	     no box-shadow on a `tr` in any browser. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<tr
			class="hover:preset-tonal-primary cursor-pointer align-middle {active
				? 'preset-filled-surface-100-900 border-primary-500 border-l-2'
				: ''}"
			onclick={() => onOpenModel(model)}
		>
			<td class="px-2 py-1.5">
				<button
					type="button"
					class="max-w-[16rem] truncate text-left font-medium hover:underline"
					onclick={(e) => {
						e.stopPropagation()
						onOpenModel(model)
					}}
					title={model.model}
				>
					{model.name}
				</button>
			</td>
			<td class="text-surface-600-400 px-2 py-1.5 whitespace-nowrap">
				{sizeCell(model)}
			</td>
			<td class="text-surface-600-400 px-2 py-1.5">
				{measureCell(model)}
			</td>
			<td class="text-surface-600-400 px-2 py-1.5 whitespace-nowrap">
				{inputCell(model)}
			</td>
			<td class="text-surface-600-400 px-2 py-1.5">
				{languagesCell(model)}
			</td>
			<td class="px-2 py-1.5">
				{#if chip}
					<span
						class="{chip.preset} inline-block rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
					>
						{chip.label}
					</span>
				{:else}
					<span class="flex min-w-24 items-center gap-1.5">
						<span
							class="bg-surface-50-950 block h-1.5 flex-1 overflow-hidden rounded-full"
							role="progressbar"
							aria-label={`Downloading ${model.name}`}
							aria-valuenow={percentOf(model)}
							aria-valuemin={0}
							aria-valuemax={100}
						>
							<span
								class="bg-warning-500 block h-full rounded-full transition-[width]"
								style={`width:${percentOf(model)}%`}
							></span>
						</span>
						<span class="text-surface-600-400 text-[11px]">
							{percentOf(model)}%
						</span>
					</span>
				{/if}
			</td>
			<td class="px-2 py-1.5 text-right">
				{#if verb}
					<button
						type="button"
						class="btn btn-sm preset-filled-surface-400-600 whitespace-nowrap disabled:cursor-not-allowed"
						disabled={!!verb.disabledReason}
						title={verb.disabledReason}
						aria-label={verb.disabledReason
							? `${verb.label} — ${verb.disabledReason}`
							: undefined}
						onclick={(e) => {
							e.stopPropagation()
							verb.press()
						}}
					>
						{verb.label}
					</button>
				{/if}
			</td>
		</tr>
	{/snippet}

</div>
