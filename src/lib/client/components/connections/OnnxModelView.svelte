<script lang="ts">
	/**
	 * One LOCAL ONNX model's own view — the files, the lane, and what putting
	 * this model in charge would cost.
	 *
	 * ## Why not `ModelDetailView`
	 *
	 * That view edits a name an endpoint answers to: display name, the text
	 * sent on the wire, context window, completion template, tokenizer. A local
	 * ONNX model has none of those questions. What it has instead is a FILE on
	 * this machine and a LANE that may or may not be holding it in memory, and
	 * every control here is about one of the two. The two views share a header
	 * and nothing else; merging them would mean a screen whose top half is
	 * inapplicable on every row it shows.
	 *
	 * ## Active, and the one thing that changes it
	 *
	 * There is one embedding model and one entity model app-wide, so the word
	 * is **Active** rather than Default (see `onnxModelFacts`). Making one
	 * active is the ordinary capability-default registration (§10), raised to
	 * the sidebar through `onSelectDefault` so the costed confirmation appears
	 * — a shortcut from here would throw a person's stored vectors away with no
	 * sentence saying so. Downloading switches nothing, which is why Download
	 * and Make active are never the same press.
	 *
	 * ⚠ No RAM figure and no time estimate. Nothing measures either — the lane
	 * reports residency, not bytes held, and no queue measures throughput — so
	 * both would be invented numbers on the one screen whose job is to state a
	 * cost honestly.
	 *
	 * ⚠ On a machine whose ONNX runtime didn't load, Download and Retry give
	 * way to the reason (`notOnThisMachine`): the server refuses both with the
	 * same sentence, and a button that can only fail is a worse answer than the
	 * sentence itself. Make active stays on a downloaded model, disabled, with
	 * the reason under it — the files are real, and the star is refused with
	 * that sentence too.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { sectionForModality } from "$lib/shared/constants/connectionSections"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import { idleMinutes } from "./endpointStatus"
	import { formatProgress } from "./modelManagement"
	import {
		onnxFacts,
		onnxModelHeadline,
		onnxSizeLabel,
		type OnnxModality
	} from "./onnxModelFacts"
	import { useLaneStatus } from "./useLaneStatus.svelte"
	import type {
		CapabilityDefaultRef,
		PairDefaultSelection
	} from "./modelSystemDefaults"
	import { localOnnxDisabledReason } from "$lib/shared/utils/connectionServiceItems"

	type ModelRow = Sockets.Connections.Models.ModelRow

	interface Props {
		/** The endpoint this model hangs off, from the sidebar's own list. */
		connection: Sockets.Connections.List.Row
		/**
		 * The model row, read out of the SAME list — so a download's progress,
		 * which the sidebar patches into it, moves this view too.
		 */
		model: ModelRow
		capabilityDefaults?: Record<string, CapabilityDefaultRef | undefined>
		/** The shell's width mode. Compact is also the phone view. */
		mode: "desk" | "compact"
		/** Every lane handler behind the status card is `requireAdmin`. */
		isAdmin?: boolean
		onBack: () => void
		/**
		 * Register this pair as the lane's active model. ⚠ Raised, never
		 * emitted here — the sidebar's chain owns the costed confirmation.
		 */
		onSelectDefault: (
			model: ModelRow,
			selection: PairDefaultSelection
		) => void
	}
	let {
		connection,
		model,
		capabilityDefaults = {},
		mode,
		isAdmin = false,
		onBack,
		onSelectDefault
	}: Props = $props()

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
	/** Why this model can't be downloaded here, or null when it can. */
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
	const starCapability = $derived(section?.starCapability ?? null)
	const isEmbeddings = $derived(modality === "embeddings")

	const lane = useLaneStatus(
		() => modality,
		() => isAdmin
	)

	const local = $derived(model.local)
	const catalog = $derived(local?.catalog)
	const isActive = $derived.by(() => {
		if (!starCapability) return false
		const def = capabilityDefaults[starCapability]
		return (
			def?.connectionId === connection.id &&
			def?.connectionModelId === model.id
		)
	})
	const facts = $derived(onnxFacts(catalog, modality))
	const sizeLabel = $derived(onnxSizeLabel(local))
	const idle = $derived(idleMinutes(lane.status?.lastUsedAt))
	const ttl = $derived(lane.status?.ttlMinutes ?? null)

	const DOT_TONE = {
		success: "bg-success-500",
		muted: "bg-surface-400-600",
		warning: "bg-warning-500"
	} as const

	/**
	 * ⚠ `loaded` comes from the LANE, not from the row: only one model can be
	 * resident, and the row's own flag is a copy of the same fact that the sync
	 * refreshes on its own schedule. When the two disagree the lane is right.
	 */
	const loaded = $derived(
		isActive ? (lane.status?.loaded ?? local?.loaded ?? false) : false
	)
	/** The headline reads the lane's residency for the same reason. */
	const headline = $derived(
		onnxModelHeadline(local ? { ...local, loaded } : local, isActive)
	)

	// ── The one primary action ──────────────────────────────────────────────
	/**
	 * A cancel that has been pressed but whose row still says `downloading`.
	 *
	 * The server finishes the file in flight before it tears the partial cache
	 * down, so the bar keeps moving for a moment after the press; without this
	 * the button would simply look dead. Cleared by the row leaving
	 * `downloading`, which is the only thing that can end the wait.
	 */
	let cancelling = $state(false)
	$effect(() => {
		if (local?.state !== "downloading") cancelling = false
	})

	/** A press whose reply has not landed. One at a time — there is one button. */
	let busy = $state(false)
	$effect(() => {
		// Any change of disk state is the answer to whatever was pressed.
		void local?.state
		busy = false
	})

	function download() {
		busy = true
		socket.emit("connections:downloadModel", {
			id: connection.id!,
			modelId: model.id
		})
	}
	function cancelDownload() {
		cancelling = true
		socket.emit("connections:cancelModelDownload", {
			id: connection.id!,
			modelId: model.id
		})
	}
	function makeActive() {
		if (!starCapability || unavailable) return
		onSelectDefault(model, { kind: "one", capability: starCapability })
	}
	function unloadNow() {
		if (isEmbeddings) socket.emit("vectorization:unloadModel", {})
		else socket.emit("ner:unloadModel", {})
	}
	function loadNow() {
		// Embeddings only: there is no `ner:loadModel`, deliberately — the
		// entity lane loads on the message that needs it and on nothing else.
		socket.emit("vectorization:loadModel", {})
	}

	// ── The files on this machine ───────────────────────────────────────────
	let removingFiles = $state(false)
	let removingRow = $state(false)
	let togglingEnabled = $state(false)
	function removeFiles() {
		removingFiles = true
		socket.emit("connections:removeModelFiles", {
			id: connection.id!,
			modelId: model.id
		})
	}
	function removeRow() {
		removingRow = true
		socket.emit("connections:deleteModel", {
			id: connection.id!,
			modelId: model.id
		})
	}
	// The replies to the two removes. Declared rather than left to the list
	// broadcast alone: both are gated events, and this view is what put the
	// spinner on the button.
	useInterest<"connections:removeModelFiles">(
		"connections:removeModelFiles",
		() => (removingFiles = false)
	)
	useInterest<"connections:removeModelFiles:error">(
		"connections:removeModelFiles:error",
		() => (removingFiles = false)
	)
	useInterest<"connections:deleteModel">(
		"connections:deleteModel",
		() => (removingRow = false)
	)
	useInterest<"connections:deleteModel:error">(
		"connections:deleteModel:error",
		() => (removingRow = false)
	)
	useInterest<"connections:updateModel:error">(
		"connections:updateModel:error",
		() => (togglingEnabled = false)
	)
	useInterest<"connections:updateModel">(
		"connections:updateModel",
		() => (togglingEnabled = false)
	)

	function setEnabled(enabled: boolean) {
		togglingEnabled = true
		socket.emit("connections:updateModel", {
			id: connection.id!,
			modelId: model.id,
			model: { enabled }
		})
	}

	// ── The sentences ───────────────────────────────────────────────────────
	const plural = (n: number, one: string, many = `${one}s`) =>
		`${n} ${n === 1 ? one : many}`

	const activeSentence = $derived.by(() => {
		if (isEmbeddings) {
			const lead =
				"Every embedding in this pub is made by this model."
			if (!loaded) return `${lead} Loads when the queue has work.`
			const ttlClause = ttl
				? `unloads after ${ttl} min idle, reloads when the queue has work`
				: "reloads when the queue has work"
			return idle != null
				? `${lead} Idle ${idle} min — ${ttlClause}.`
				: `${lead} ${ttlClause[0].toUpperCase()}${ttlClause.slice(1)}.`
		}
		const lead = "Every name this pub extracts comes from this model."
		return ttl
			? `${lead} Loads when a message needs it; unloads after ${ttl} min idle.`
			: `${lead} Loads when a message needs it.`
	})

	/**
	 * What making THIS model active would throw away — the same numbers the
	 * confirmation will quote, said before the press rather than after it.
	 */
	const switchCost = $derived.by(() => {
		const rows = lane.cost?.rows ?? null
		if (rows == null) return null
		if (rows === 0)
			return "Nothing is stored yet, so switching costs nothing."
		if (!isEmbeddings)
			return `Making this active re-scans ${plural(rows, "entry", "entries")} and messages for names. You will be asked to confirm.`
		const parts: string[] = []
		if (lane.cost?.lorebooks)
			parts.push(plural(lane.cost.lorebooks, "lorebook"))
		if (lane.cost?.sessions)
			parts.push(plural(lane.cost.sessions, "session"))
		const across = parts.length ? ` across ${parts.join(" and ")}` : ""
		return `Making this active re-embeds ${plural(rows, "vector")}${across}. Retrieval answers from keywords until that finishes. You will be asked to confirm.`
	})

	const laneFooter = $derived(
		isEmbeddings
			? "Pipelines never choose an embedding model — they always get the active one."
			: "Pipelines never choose an entity model — they always get the active one."
	)

	const hubUrl = $derived(`https://huggingface.co/${model.model}`)
	const progressText = $derived(
		formatProgress(local?.downloadedBytes, local?.totalBytes, "MB")
	)
	const onDisk = $derived(local?.state === "on_disk")

	/** 44px tap targets at every width — this is also the phone view. */
	const action = "btn min-h-11 w-full"
</script>

<div class="flex h-full flex-col gap-3">
	<div class="flex items-center gap-2">
		<!-- At every width: at full page this view is reached from the
		     endpoint table or a capability, and the list row is not a way
		     back to either (plan 2026-09-24 B9). -->
		<button
			type="button"
			class="btn btn-sm preset-filled-surface-400-600 p-2"
			onclick={onBack}
			title="Back"
			aria-label="Back"
		>
			<Icons.ChevronLeft size={16} />
		</button>
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-sm font-semibold">{model.name}</h2>
			<p class="text-surface-600-400 truncate text-xs">
				on {connection.name}{model.model && model.model !== model.name
					? ` · ${model.model}`
					: ""}
			</p>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4">
		<!-- 1. STATUS. What this model is right now, and the one thing to do
		     about it. -->
		<div
			class="card preset-filled-surface-100-900 flex flex-col gap-3 p-3 {isActive
				? 'ring-primary-500/70 ring-2'
				: ''}"
		>
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="size-2 shrink-0 rounded-full {DOT_TONE[
						headline.tone
					]}"
					aria-hidden="true"
				></span>
				<span class="text-sm font-semibold">{headline.text}</span>
				{#if isActive && section}
					<span
						class="preset-tonal-primary inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
						title={`The pub default for ${section.starVerb}`}
					>
						<Icons.Star size={9} aria-hidden="true" />
						{isEmbeddings ? "embeddings" : "entities"}
					</span>
				{/if}
			</div>

			{#if isActive}
				<p class="text-surface-600-400 text-xs">{activeSentence}</p>

				{#if loaded || (isEmbeddings && onDisk)}
					<div class="flex flex-wrap gap-2">
						{#if loaded}
							<button
								type="button"
								class="btn preset-filled-surface-400-600 min-h-11 flex-1"
								onclick={unloadNow}
							>
								<Icons.PowerOff size={14} aria-hidden="true" />
								Unload now
							</button>
						{:else if isEmbeddings && onDisk}
							<button
								type="button"
								class="btn preset-filled-surface-400-600 min-h-11 flex-1"
								onclick={loadNow}
							>
								<Icons.Power size={14} aria-hidden="true" />
								Load
							</button>
						{/if}
					</div>
				{:else if local?.state === "downloading"}
					<div class="flex flex-col gap-1">
						<span
							class="bg-surface-50-950 block h-1.5 w-full overflow-hidden rounded-full"
							role="progressbar"
							aria-label="Download progress"
							aria-valuenow={headline.percent ?? 0}
							aria-valuemin={0}
							aria-valuemax={100}
						>
							<span
								class="bg-warning-500 block h-full rounded-full transition-[width]"
								style={`width:${headline.percent ?? 0}%`}
							></span>
						</span>
						{#if progressText}
							<span class="text-surface-600-400 text-[11px]">
								{progressText}
							</span>
						{/if}
						{#if cancelling}
							<span class="text-surface-600-400 text-[11px]">
								Cancelling — the current file finishes first.
							</span>
						{/if}
					</div>
					<button
						type="button"
						class="{action} preset-filled-surface-400-600"
						disabled={cancelling}
						onclick={cancelDownload}
					>
						<Icons.X size={14} aria-hidden="true" />
						Cancel
					</button>
				{:else if local?.state === "error"}
					{#if local.error}
						<p class="text-warning-500 text-xs" role="alert">
							{local.error}
						</p>
					{/if}
					{#if unavailable}
						{@render notOnThisMachine()}
					{:else}
						<button
							type="button"
							class="{action} preset-filled-primary-500"
							disabled={busy}
							onclick={download}
						>
							<Icons.RefreshCw size={14} aria-hidden="true" />
							Retry
						</button>
					{/if}
				{:else if local?.state === "not_downloaded"}
					{#if unavailable}
						{@render notOnThisMachine()}
					{:else}
						<button
							type="button"
							class="{action} preset-filled-primary-500"
							disabled={busy}
							onclick={download}
						>
							<Icons.Download size={14} aria-hidden="true" />
							Download
						</button>
					{/if}
				{/if}

				{#if lane.status}
					<dl class="grid grid-cols-2 gap-2 text-xs">
						<div class="flex flex-col">
							<dt class="text-surface-600-400">
								{isEmbeddings ? "Queue" : "Annotated"}
							</dt>
							<dd class="font-medium">
								{#if isEmbeddings}
									{(lane.status.pending ?? 0) === 0
										? "idle"
										: `${lane.status.pending} waiting`}
								{:else}
									{plural(
										lane.status.annotatedRows ?? 0,
										"row"
									)} annotated
								{/if}
							</dd>
						</div>
						<div class="flex flex-col">
							<dt class="text-surface-600-400">Last used</dt>
							<dd class="font-medium">
								{timeAgo(lane.status.lastUsedAt)}
							</dd>
						</div>
					</dl>
				{/if}

				{#if lane.status?.loadError}
					<p class="text-warning-500 text-xs" role="alert">
						{lane.status.loadError}
					</p>
				{/if}
			{:else}
				{#if local?.state === "downloading"}
					<div class="flex flex-col gap-1">
						<span
							class="bg-surface-50-950 block h-1.5 w-full overflow-hidden rounded-full"
							role="progressbar"
							aria-label="Download progress"
							aria-valuenow={headline.percent ?? 0}
							aria-valuemin={0}
							aria-valuemax={100}
						>
							<span
								class="bg-warning-500 block h-full rounded-full transition-[width]"
								style={`width:${headline.percent ?? 0}%`}
							></span>
						</span>
						{#if progressText}
							<span class="text-surface-600-400 text-[11px]">
								{progressText}
							</span>
						{/if}
						{#if cancelling}
							<span class="text-surface-600-400 text-[11px]">
								Cancelling — the current file finishes first.
							</span>
						{/if}
					</div>
				{/if}

				{#if local?.state === "error" && local.error}
					<p class="text-warning-500 text-xs" role="alert">
						{local.error}
					</p>
				{/if}

				{#if local?.state === "on_disk"}
					<button
						type="button"
						class="{action} preset-filled-primary-500"
						disabled={!starCapability ||
							!model.enabled ||
							!!unavailable}
						title={unavailable ??
							(model.enabled
								? undefined
								: "Switch the model on first — the star refuses it while it is off")}
						onclick={makeActive}
					>
						<Icons.Star size={14} aria-hidden="true" />
						Make active
					</button>
					{#if unavailable}
						<!-- In words under the button, not only its tooltip: a
						     disabled button takes no focus (§9). -->
						{@render notOnThisMachine()}
					{:else if switchCost}
						<p
							class="{lane.cost?.rows
								? 'preset-tonal-warning'
								: 'text-surface-600-400'} rounded-lg p-2 text-xs"
						>
							{switchCost}
						</p>
					{/if}
				{:else if local?.state === "downloading"}
					<button
						type="button"
						class="{action} preset-filled-surface-400-600"
						disabled={cancelling}
						onclick={cancelDownload}
					>
						<Icons.X size={14} aria-hidden="true" />
						Cancel
					</button>
				{:else if local?.state === "error"}
					{#if unavailable}
						{@render notOnThisMachine()}
					{:else}
						<button
							type="button"
							class="{action} preset-filled-primary-500"
							disabled={busy}
							onclick={download}
						>
							<Icons.RefreshCw size={14} aria-hidden="true" />
							Retry
						</button>
					{/if}
				{:else if local}
					{#if unavailable}
						{@render notOnThisMachine()}
					{:else}
						<button
							type="button"
							class="{action} preset-filled-primary-500"
							disabled={busy}
							onclick={download}
						>
							<Icons.Download size={14} aria-hidden="true" />
							Download
						</button>
					{/if}
				{/if}
			{/if}
		</div>

		<!-- 2. ON THIS MACHINE. Only once there is something on it. -->
		{#if local && (local.state === "on_disk" || local.state === "error")}
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-semibold">On this machine</span>
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-surface-600-400 min-w-0 flex-1 text-xs">
						{local.state === "on_disk"
							? "On disk"
							: "Partly fetched"}{sizeLabel
							? ` · ${sizeLabel}`
							: ""}{catalog?.dtype ? ` · ${catalog.dtype}` : ""}
					</span>
					<button
						type="button"
						class="btn btn-sm hover:preset-tonal-surface min-h-11"
						disabled={isActive || removingFiles}
						onclick={removeFiles}
					>
						<Icons.Trash2 size={14} aria-hidden="true" />
						Delete from disk
					</button>
				</div>
				{#if isActive}
					<p class="text-surface-600-400 text-xs">
						The active model can't be removed from disk. Make
						another model active first.
					</p>
				{/if}
			</div>
		{/if}

		<!-- A row this install went and fetched can be taken off the list —
		     but only once its files are gone, so the two removes are never
		     offered as alternatives to each other. -->
		{#if local?.addedByUser && !onDisk}
			<button
				type="button"
				class="btn btn-sm hover:preset-tonal-surface min-h-11 w-full"
				disabled={removingRow}
				onclick={removeRow}
			>
				<Icons.ListX size={14} aria-hidden="true" />
				Remove from list
			</button>
		{/if}

		<!-- 3. ABOUT. What the recommended list knows, and the page itself. -->
		<div class="flex flex-col gap-2">
			<span class="text-xs font-semibold">About</span>
			{#if catalog?.description}
				<p class="text-surface-600-400 text-xs">{catalog.description}</p>
			{/if}
			{#if facts.length}
				<dl class="grid grid-cols-2 gap-2 text-xs">
					{#each facts as fact (fact.label)}
						<div class="flex min-w-0 flex-col">
							<dt class="text-surface-600-400">{fact.label}</dt>
							<dd class="font-medium break-words">
								{fact.value}
							</dd>
						</div>
					{/each}
				</dl>
			{:else if !catalog?.description}
				<p class="text-surface-600-400 text-xs">
					The recommended list says nothing about this one — it was
					added by Hugging Face id.
				</p>
			{/if}
			<a
				class="anchor text-xs"
				href={hubUrl}
				target="_blank"
				rel="noopener noreferrer"
			>
				Open on Hugging Face ↗
			</a>
		</div>

		<!-- 4. LANE. Only the active model has one. -->
		{#if isActive}
			<div class="flex flex-col gap-2">
				<span class="text-xs font-semibold">Lane</span>
				<div class="flex items-center justify-between gap-4 text-xs">
					<span class="text-surface-600-400">Unload after idle</span>
					<span class="font-medium">
						{ttl != null ? `${ttl} min` : "—"}
					</span>
				</div>
				<p class="text-surface-600-400 text-xs">Set on the connection.</p>

				<Switch
					name="onnx-model-enabled"
					checked={model.enabled}
					disabled={togglingEnabled}
					onCheckedChange={(e) => setEnabled(e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="text-xs font-semibold">
						Listed in pickers
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>

				<p class="text-surface-600-400 text-xs">{laneFooter}</p>
			</div>
		{/if}
	</div>
</div>

{#snippet notOnThisMachine()}
	<!-- In place of Download or Retry, and under a disabled Make active. The
	     reason wraps: it often quotes the runtime's own error, and cut short
	     it would hide the part that says what is missing. -->
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
{/snippet}
