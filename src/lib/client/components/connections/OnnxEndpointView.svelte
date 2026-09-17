<script lang="ts">
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
	 * At compact width there is no table: the sidebar index already lists these
	 * rows with the same facts stacked, and a second copy of them here would be
	 * the same list twice on one phone screen.
	 *
	 * ⚠ It sits ABOVE the connection's own form, never instead of it. The name,
	 * the notes and the lane's TTL are ordinary connection settings and stay
	 * exactly where every other endpoint keeps them.
	 *
	 * ⚠ **Make active is not emitted here.** It is the capability-default
	 * registration (§10), raised so the sidebar's costed confirmation appears.
	 * Downloading switches nothing — which is the one sentence on this screen
	 * that people most need, and why it is in the info line rather than a
	 * tooltip.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
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
		tierOrder,
		type OnnxModality
	} from "./onnxModelFacts"
	import { useLaneStatus } from "./useLaneStatus.svelte"
	import type { CapabilityDefaultRef } from "./modelSystemDefaults"

	type ModelRow = Sockets.Connections.Models.ModelRow

	interface Props {
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

	const groups = $derived(tierOrder(models))

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

	// ── Add from Hugging Face ───────────────────────────────────────────────
	let addingHub = $state(false)
	let hubId = $state("")
	let hubError = $state<string | null>(null)
	/** This view started an add — the index declares the same two keys. */
	let hubPending = $state(false)

	function submitHub() {
		const id = hubId.trim()
		if (!id || connection.id == null) return
		hubError = null
		hubPending = true
		socket.emit("connections:addHubModel", { id: connection.id, hubId: id })
	}
	useInterest<"connections:addHubModel">("connections:addHubModel", () => {
		if (!hubPending) return
		// The refreshed list arrives on `connections:list`; all this does is
		// close the form it was typed into.
		hubPending = false
		hubError = null
		hubId = ""
		addingHub = false
	})
	useInterest<"connections:addHubModel:error">(
		"connections:addHubModel:error",
		(msg: { error?: string }) => {
			if (!hubPending) return
			hubPending = false
			hubError = msg.error ?? "The Hub would not confirm that id."
		}
	)

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
			? "preset-filled-primary-500"
			: model.local?.state === "on_disk"
				? "preset-tonal-success"
				: model.local?.state === "error"
					? "preset-tonal-warning"
					: "border-surface-300-700 text-muted border"
		return { label: headline.text, preset }
	}

	/**
	 * The ONE action a row offers. Mirrors `rowAction` in spirit, spelled out
	 * here because the table's active row shows no action at all — there is
	 * nothing left to ask of the model already in charge.
	 */
	function rowVerb(model: ModelRow) {
		if (isActiveRow(model)) return null
		switch (model.local?.state) {
			case "on_disk":
				return {
					label: "Make active",
					press: () => onMakeActive(model)
				}
			case "downloading":
				return { label: "Cancel", press: () => onCancel(model) }
			case "error":
				return { label: "Retry", press: () => onRetry(model) }
			case "not_downloaded":
				return { label: "Download", press: () => onDownload(model) }
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
	<!-- The endpoint, as a thing that runs here rather than a thing you dial. -->
	<div class="flex items-start gap-3">
		<div
			class="preset-tonal-primary flex size-16 shrink-0 items-center justify-center rounded-lg"
			aria-hidden="true"
		>
			<SectionIcon size={28} />
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2">
				<h3 class="min-w-0 truncate text-sm font-semibold">
					{connection.name}
				</h3>
				<span
					class="border-surface-300-700 text-muted shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium"
				>
					ONNX
				</span>
			</div>
			<p class="text-muted text-xs">
				Runs inside Serene Pub · no server to run · loads on use
			</p>
		</div>
	</div>

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
		{#if !addingHub}
			<button
				type="button"
				class="btn btn-sm preset-filled-surface-400-600 min-h-11"
				onclick={() => (addingHub = true)}
			>
				<Icons.Plus size={14} aria-hidden="true" />
				Add from Hugging Face…
			</button>
		{/if}
	</div>

	{#if addingHub}
		<form
			class="border-surface-300-700 flex flex-col gap-1.5 rounded-lg border p-2"
			onsubmit={(e) => {
				e.preventDefault()
				submitHub()
			}}
		>
			<label class="text-xs font-medium" for="onnx-hub-id">
				Add from Hugging Face
			</label>
			<input
				id="onnx-hub-id"
				class="input text-xs"
				placeholder="org/name"
				bind:value={hubId}
			/>
			{#if hubError}
				<p class="text-warning-500 text-[11px]" role="alert">
					{hubError}
				</p>
			{/if}
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => {
						addingHub = false
						hubError = null
						hubId = ""
					}}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500"
					disabled={!hubId.trim() || hubPending}
				>
					Add
				</button>
			</div>
		</form>
	{/if}

	<p class="text-muted text-xs">{infoLine}</p>

	{#if mode === "compact"}
		<p class="text-muted text-xs">
			Models are listed in the sidebar index.
		</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-xs">
				<thead class="text-muted">
					<tr>
						{#each columns as column, i (i)}
							<th class="px-2 py-1 font-medium">
								{#if column}
									{column}
								{:else}
									<!-- The action column. Named for a screen
									     reader, blank for an eye. -->
									<span class="sr-only">Action</span>
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<!-- One `tbody` per tier, so the heading row is a real row-group
				     label rather than a cell pretending to be one. -->
				{#each groups as group (group.tier ?? "untiered")}
					<tbody>
						{#if group.label}
							<tr>
								<th
									colspan={columns.length}
									class="text-muted px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide uppercase"
									scope="rowgroup"
								>
									{group.label}
								</th>
							</tr>
						{/if}
						{#each group.rows as model (model.id)}
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
								<td
									class="text-muted px-2 py-1.5 whitespace-nowrap"
								>
									{sizeCell(model)}
								</td>
								<td class="text-muted px-2 py-1.5">
									{measureCell(model)}
								</td>
								<td
									class="text-muted px-2 py-1.5 whitespace-nowrap"
								>
									{inputCell(model)}
								</td>
								<td class="text-muted px-2 py-1.5">
									{languagesCell(model)}
								</td>
								<td class="px-2 py-1.5">
									{#if chip}
										<span
											class="{chip.preset} inline-block rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
										>
											{chip.label}
										</span>
									{:else}
										<span
											class="flex min-w-24 items-center gap-1.5"
										>
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
											<span
												class="text-muted text-[10px]"
											>
												{percentOf(model)}%
											</span>
										</span>
									{/if}
								</td>
								<td class="px-2 py-1.5 text-right">
									{#if verb}
										<button
											type="button"
											class="btn btn-sm preset-filled-surface-400-600 whitespace-nowrap"
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
						{/each}
					</tbody>
				{/each}
			</table>
		</div>
	{/if}

	<p class="text-muted text-xs">
		Recommended list:
		<a
			class="anchor"
			href="https://github.com/SerenePub/serene-pub-onnx-list"
			target="_blank"
			rel="noopener noreferrer"
		>
			github.com/SerenePub/serene-pub-onnx-list ↗
		</a>
	</p>
</div>
