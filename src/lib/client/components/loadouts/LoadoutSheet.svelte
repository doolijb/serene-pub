<script lang="ts">
	/**
	 * **The loadout editor** (I12; DESIGN-image-generation §11, §13, §14.2;
	 * lane E2) — one loadout, opened over whatever is on screen from a tile,
	 * the defaults ledger, the status strip or a door (`digest.loadoutId`,
	 * `digest.connectionsJob`); and, opened empty (`loadout` null, `open`),
	 * the *New loadout* editor (`NewLoadoutDialog`).
	 *
	 * Header: the title, edited in place · the slug in mono · the owner chip
	 * (*Core* / a plugin / *Yours*) · the **Default for <job>** star · the live
	 * **what runs** line · the description (prose on a shipped loadout, with
	 * *Duplicate to edit*). Then, in the body, what to choose for — **Needs**,
	 * **Best with**, *Used by N steps* and why that matters — and three cards:
	 * **Model** (with **Fill for me** and the filter popout), **Sampling**,
	 * **Workflow** (ComfyUI only); a footer: *Merge into…* / *Unmerge*,
	 * Delete, Cancel, Save.
	 *
	 * Edits are a draft until Save (STYLE-GUIDE §6.14): closing with changes
	 * asks *Discard unsaved changes?*. **Fill for me** proposes into the draft
	 * (`loadouts:proposeFill`); Merge and Delete are one-shot verbs with their
	 * own buttons. Refusals are toasted centrally; this
	 * editor also says them inline and drops its in-flight marks. Every word
	 * and row comes from `loadoutSheet.ts`.
	 */
	import { getContext, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import type { CapabilityConnection } from "$lib/client/components/connections/jobPicker"
	import { workflowsApi } from "$lib/client/components/connections/comfy/workflowsApi"
	import { samplingSidebarMemory } from "$lib/client/components/sidebars/samplingList"
	import { openInSampling } from "$lib/client/admin/railDoors"
	import { outputKindOf } from "$lib/shared/capabilities/samplingShape"
	import { sheetSentence } from "$lib/shared/imageGen/sheetSentence"
	import type {
		DrawingSheet,
		WorkflowVariable
	} from "$lib/shared/imageGen/types"
	import ModelCard from "./sheet/ModelCard.svelte"
	import SamplingCard from "./sheet/SamplingCard.svelte"
	import WorkflowCard from "./sheet/WorkflowCard.svelte"
	import ConfirmDialog from "./sheet/ConfirmDialog.svelte"
	import { impliedNeeds } from "$lib/shared/loadouts/consequence"
	import {
		bestWithOf,
		canSave,
		dialRows,
		draftOf,
		editorHeader,
		loadoutNeeds,
		mergeTargets,
		usedByWhy,
		modelOptions,
		needsSetDefault,
		samplingChoices,
		samplingKnobs,
		samplingOnPairChange,
		setDial,
		showsWorkflowField,
		transformLabel,
		updateParams,
		VERBS,
		whatRuns,
		type DialRow,
		type LoadoutDraft,
		type ModelOption,
		type SamplingRow
	} from "./loadoutSheet"

	interface Props {
		/** The loadout the editor is open on; null with `open` = a new one. */
		loadout: Sockets.Loadouts.Summary | null
		/** Opens the empty editor (a new loadout). Ignored while `loadout` is set. */
		open?: boolean
		/** The jobs a new loadout may be for. */
		jobs?: readonly { id: string; label: string }[]
		/** The view's `loadouts:list` answer. */
		list: Sockets.Loadouts.List.Response
		/** The connections context's list — every connection with every model. */
		connections: readonly CapabilityConnection[]
		onClose: () => void
		/** Open another loadout (a merge parent, a duplicate). */
		onOpenLoadout?: (id: number) => void
	}
	let {
		loadout,
		open = false,
		jobs = [],
		list,
		connections,
		onClose,
		onOpenLoadout
	}: Props = $props()

	const socket = useTypedSocket()
	const workflows = workflowsApi(socket)
	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")
	const uid = $props.id()

	const isOpen = $derived(loadout != null || open)
	const creating = $derived(loadout == null)

	// ── The draft ─────────────────────────────────────────────────────────
	let draft = $state<LoadoutDraft>(draftOf(null))
	const edits = new UnsavedEdits(() => draft)
	/** The swap rule's sentence, after a pair change. */
	let notice = $state<string | null>(null)
	/** Fill for me's sentence: what it chose and why. */
	let explanation = $state<string | null>(null)
	/** A refusal, said inline beside the verb that met it. */
	let problem = $state<{
		at: "save" | "fill" | "merge" | "delete"
		text: string
	} | null>(null)
	let busy = $state<
		null | "save" | "fill" | "merge" | "delete" | "duplicate"
	>(null)
	let asking = $state<null | "discard" | "delete">(null)
	let mergeOpen = $state(false)
	let usedByOpen = $state(false)

	// A different loadout (or a fresh New) is a different draft; a push of
	// the same loadout follows it while clean and keeps edits while not.
	let openedKey: string | null = null
	$effect(() => {
		const key = isOpen ? (loadout ? `id:${loadout.id}` : "new") : null
		const row = loadout
		untrack(() => {
			if (key !== openedKey) {
				openedKey = key
				if (!key) {
					edits.forget()
					return
				}
				const firstJob = jobs.some((j) => j.id === "text->text")
					? "text->text"
					: (jobs[0]?.id ?? "text->text")
				draft = draftOf(row, firstJob)
				edits.markSaved()
				notice = null
				explanation = null
				problem = null
				busy = null
				asking = null
				mergeOpen = false
				usedByOpen = false
				return
			}
			if (row) edits.adoptSaved(draftOf(row), (next) => (draft = next))
		})
	})

	const header = $derived(editorHeader(loadout, draft, list.transforms))
	const jobLabel = $derived(transformLabel(draft.transform, list.transforms))
	const merged = $derived(loadout?.mergedInto != null)
	const draws = $derived(outputKindOf(draft.transform) === "image")
	// What to choose for, and why: the Pipelines Loadout row's words.
	const needs = $derived(loadoutNeeds(loadout?.loadoutId))
	const bestWith = $derived(bestWithOf(loadout, list.samplingOptions))

	// ── Sampling rows, with their knobs ───────────────────────────────────
	let samplingStore = $state<SamplingRow[]>([])
	useInterest<"samplingConfigs:list">("samplingConfigs:list", (msg) => {
		samplingStore = (msg?.samplingConfigsList ?? []) as SamplingRow[]
	})
	$effect(() => {
		if (!isOpen) return
		untrack(() => socket.emit("samplingConfigs:list", {}))
	})
	const samplingRows = $derived(
		samplingChoices(list.samplingOptions, draft.transform).map((o) => ({
			id: o.id,
			name: o.name,
			knobs: samplingKnobs(
				samplingStore.find((s) => s.id === o.id),
				draft.transform
			)
		}))
	)
	const samplingName = $derived(
		samplingRows.find((r) => r.id === draft.samplingConfigId)?.name ??
			samplingStore.find((s) => s.id === draft.samplingConfigId)?.name ??
			null
	)
	const runs = $derived(whatRuns(loadout, draft, connections, samplingName))

	// ── The Model card ────────────────────────────────────────────────────
	const options = $derived(
		modelOptions(
			connections,
			draft.transform,
			loadout?.loadoutId ?? null,
			{
				connectionId: loadout?.connectionId ?? null,
				connectionModelId: loadout?.connectionModelId ?? null
			},
			list.connectionGrades
		)
	)
	const chosenKey = $derived(
		draft.connectionId != null && draft.connectionModelId != null
			? `${draft.connectionId}:${draft.connectionModelId}`
			: null
	)
	function pickModel(option: ModelOption) {
		if (!option.usable || option.key === chosenKey) return
		explanation = null
		draft.connectionId = option.connectionId
		draft.connectionModelId = option.modelId
		const swap = samplingOnPairChange(
			draft,
			list.samplingOptions,
			samplingStore
		)
		notice = swap.notice
		if (swap.notice) draft.samplingConfigId = swap.samplingConfigId
	}
	function clearPair() {
		draft.connectionId = null
		draft.connectionModelId = null
		notice = null
		explanation = null
	}

	// ── The Workflow card ─────────────────────────────────────────────────
	let pairSheet = $state<{ key: string; sheet: DrawingSheet | null } | null>(
		null
	)
	let workflowSheet = $state<{
		id: number
		sheet: DrawingSheet | null
	} | null>(null)
	let variables = $state<{ id: number; list: WorkflowVariable[] } | null>(
		null
	)
	const pairKey = $derived(`${draft.connectionId}:${draft.connectionModelId}`)
	$effect(() => {
		if (!isOpen || !draws || draft.connectionId == null) return
		const params = {
			connectionId: draft.connectionId,
			connectionModelId: draft.connectionModelId
		}
		untrack(() => socket.emit("images:drawingSheet", params))
	})
	$effect(() => {
		const id = draft.workflowId
		const cid = draft.connectionId
		if (!isOpen || id == null) return
		untrack(() => {
			socket.emit("images:drawingSheet", {
				connectionId: cid,
				connectionModelId: draft.connectionModelId,
				workflowId: id
			})
			workflows
				.get(id)
				.then((w) => {
					if (w) variables = { id, list: w.variables ?? [] }
				})
				.catch(() => (variables = { id, list: [] }))
		})
	})
	useInterest<"images:drawingSheet">("images:drawingSheet", (msg) => {
		// A card's Sprites tab asked about its own pair: not this editor.
		if (msg?.characterId != null) return
		if (msg?.workflowId != null)
			workflowSheet = { id: msg.workflowId, sheet: msg.sheet ?? null }
		else pairSheet = { key: pairKey, sheet: msg?.sheet ?? null }
	})
	const showWorkflow = $derived(
		draws &&
			draft.connectionId != null &&
			pairSheet?.key === pairKey &&
			showsWorkflowField(pairSheet.sheet)
	)
	const dials = $derived<DialRow[] | null>(
		draft.workflowId != null && variables?.id === draft.workflowId
			? dialRows(variables.list, draft.workflowValues)
			: null
	)
	const workflowSentence = $derived(
		draft.workflowId != null &&
			workflowSheet?.id === draft.workflowId &&
			workflowSheet.sheet
			? sheetSentence(workflowSheet.sheet)
			: null
	)
	function pickWorkflow(id: number | null) {
		if (id === draft.workflowId) return
		draft.workflowId = id
		// Another workflow's dials mean nothing to this one.
		draft.workflowValues = {}
	}
	function moveDial(row: DialRow, value: unknown) {
		draft.workflowValues = setDial(draft.workflowValues, row, value)
	}

	// ── Saving ────────────────────────────────────────────────────────────
	/** What Save still has to send after the row exists (create, duplicate). */
	let after = $state<null | {
		kind: "create" | "duplicate"
		draft: LoadoutDraft
	}>(null)
	/** The id a Save is writing, so its answers are recognised. */
	let savingId = $state<number | null>(null)
	let pendingDefault = false

	function save() {
		if (!canSave(draft) || busy) return
		problem = null
		if (creating) {
			busy = "save"
			after = { kind: "create", draft: $state.snapshot(draft) }
			socket.emit("loadouts:create", {
				name: draft.name.trim(),
				transform: draft.transform,
				description: draft.description.trim() || null
			})
			return
		}
		writeRest(loadout!, draft)
	}

	/** The update and the star, for a row that exists. */
	function writeRest(row: Sockets.Loadouts.Summary, d: LoadoutDraft) {
		const params = updateParams(row, d)
		pendingDefault = needsSetDefault(row, d)
		savingId = row.id
		busy = "save"
		if (params) socket.emit("loadouts:update", params)
		else if (pendingDefault) setDefault(row.id)
		else finish()
	}
	function setDefault(id: number) {
		pendingDefault = false
		socket.emit("loadouts:setDefault", { id })
	}
	function finish() {
		busy = null
		savingId = null
		edits.forget()
		onClose()
	}

	function duplicate() {
		if (!loadout || busy) return
		busy = "duplicate"
		after = {
			kind: "duplicate",
			draft: { ...$state.snapshot(draft), isDefault: false }
		}
		socket.emit("loadouts:create", {
			name: `${loadout.name} copy`,
			transform: loadout.transform,
			description: loadout.description
		})
	}

	// ── Closing ───────────────────────────────────────────────────────────
	function requestClose() {
		if (busy === "save") return
		if (edits.dirty) {
			asking = "discard"
			return
		}
		onClose()
	}
	function discard() {
		asking = null
		edits.forget()
		onClose()
	}

	function openSampling() {
		if (edits.dirty) {
			asking = "discard"
			return
		}
		openInSampling(panelsCtx, samplingSidebarMemory, draft.samplingConfigId)
		onClose()
	}

	// ── One-shot verbs ────────────────────────────────────────────────────
	const mergeOptions = $derived(
		loadout
			? mergeTargets(list.loadouts, loadout).map((l) => ({
					value: String(l.id),
					label: l.name
				}))
			: []
	)
	function merge(parentId: number | null) {
		if (!loadout) return
		busy = "merge"
		problem = null
		mergeOpen = false
		socket.emit("loadouts:merge", { id: loadout.id, parentId })
	}
	/** **Fill for me**: the server's pick, into the draft — Save writes it. */
	function fill() {
		if (busy) return
		busy = "fill"
		problem = null
		explanation = null
		socket.emit("loadouts:proposeFill", {
			id: loadout?.id ?? null,
			transform: draft.transform
		})
	}
	function remove() {
		if (!loadout || !header.canDelete) return
		busy = "delete"
		problem = null
		socket.emit("loadouts:delete", { id: loadout.id })
	}

	// ── Answers ───────────────────────────────────────────────────────────
	const mine = (id: number | undefined) => id != null && id === loadout?.id
	useInterest<"loadouts:create">("loadouts:create", (msg) => {
		const job = after
		if (!job || !msg.loadout) return
		after = null
		if (job.kind === "duplicate") {
			const params = updateParams(msg.loadout, job.draft)
			if (params) socket.emit("loadouts:update", params)
			busy = null
			edits.forget()
			onOpenLoadout?.(msg.loadout.id)
			return
		}
		writeRest(msg.loadout, job.draft)
	})
	useInterest<"loadouts:create:error">("loadouts:create:error", (msg) => {
		if (!after) return
		after = null
		busy = null
		problem = {
			at: "save",
			text: msg?.error ?? "That loadout was not made."
		}
	})
	useInterest<"loadouts:update">("loadouts:update", (msg) => {
		if (savingId == null || msg.loadout?.id !== savingId) return
		if (pendingDefault) setDefault(savingId)
		else finish()
	})
	useInterest<"loadouts:update:error">("loadouts:update:error", (msg) => {
		if (savingId == null) return
		savingId = null
		busy = null
		problem = { at: "save", text: msg?.error ?? "Not saved." }
	})
	useInterest<"loadouts:setDefault">("loadouts:setDefault", (msg) => {
		if (savingId == null || msg.loadout?.id !== savingId) return
		finish()
	})
	useInterest<"loadouts:setDefault:error">(
		"loadouts:setDefault:error",
		(msg) => {
			if (savingId == null) return
			savingId = null
			busy = null
			problem = {
				at: "save",
				text: msg?.error ?? "Not made the default."
			}
		}
	)
	useInterest<"loadouts:merge">("loadouts:merge", () => {
		if (busy === "merge") busy = null
	})
	useInterest<"loadouts:merge:error">("loadouts:merge:error", (msg) => {
		if (busy !== "merge") return
		busy = null
		problem = { at: "merge", text: msg?.error ?? "Not merged." }
	})
	useInterest<"loadouts:proposeFill">("loadouts:proposeFill", (msg) => {
		if (busy !== "fill" || (msg.id ?? null) !== (loadout?.id ?? null))
			return
		busy = null
		const option = options.find(
			(o) => o.key === `${msg.connectionId}:${msg.connectionModelId}`
		)
		if (option && option.key !== chosenKey) pickModel(option)
		else if (!option) {
			draft.connectionId = msg.connectionId
			draft.connectionModelId = msg.connectionModelId
		}
		// The shipped config, only where nothing is picked: a pick stands.
		if (draft.samplingConfigId == null && msg.samplingConfigId != null)
			draft.samplingConfigId = msg.samplingConfigId
		explanation = msg.explanation
	})
	useInterest<"loadouts:proposeFill:error">(
		"loadouts:proposeFill:error",
		(msg) => {
			if (busy !== "fill") return
			busy = null
			problem = { at: "fill", text: msg?.error ?? "Nothing was filled." }
		}
	)
	useInterest<"loadouts:delete">("loadouts:delete", (msg) => {
		if (!mine(msg.id)) return
		busy = null
		asking = null
		edits.forget()
		onClose()
	})
	useInterest<"loadouts:delete:error">("loadouts:delete:error", (msg) => {
		if (busy !== "delete") return
		busy = null
		asking = null
		problem = { at: "delete", text: msg?.error ?? "Not deleted." }
	})
</script>

<Dialog
	open={isOpen}
	onOpenChange={(e) => {
		if (!e.open) requestClose()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 @container/editor flex max-h-[100dvh] w-full max-w-3xl flex-col shadow-xl sm:max-h-[92vh]"
			>
				<!-- Header -->
				<header
					class="flex shrink-0 flex-col gap-3 px-4 pt-4 pb-3 sm:px-6 sm:pt-5"
				>
					<div class="flex items-start gap-2">
						<div class="min-w-0 flex-1">
							{#if header.editable}
								<Dialog.Title class="sr-only">
									{creating
										? "New loadout"
										: `Edit ${header.title}`}
								</Dialog.Title>
								<input
									class="hover:bg-surface-200-800 focus:bg-surface-50-950 focus-visible:outline-primary-500 -mx-2 w-[calc(100%+1rem)] rounded-base bg-transparent px-2 py-1 [font-family:var(--typo-heading--font-family)] text-[20px] leading-tight font-semibold tracking-[-0.01em] focus-visible:outline-2"
									type="text"
									aria-label="Name"
									placeholder="Name this loadout"
									bind:value={draft.name}
								/>
							{:else}
								<Dialog.Title
									class="[font-family:var(--typo-heading--font-family)] text-[20px] leading-tight font-semibold tracking-[-0.01em]"
								>
									{header.title}
								</Dialog.Title>
							{/if}
							<div
								class="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
							>
								{#if header.slug}
									<span
										class="text-surface-600-400 font-mono"
									>
										{header.slug}
									</span>
								{/if}
								<span
									class="bg-surface-200-800 text-surface-700-300 rounded-full px-2 py-0.5"
								>
									{header.owner}
								</span>
								{#if header.pluginOff}
									<span
										class="border-surface-200-800 text-surface-700-300 rounded-full border px-2 py-0.5"
									>
										Plugin off
									</span>
								{/if}
							</div>
						</div>
						<button
							type="button"
							class="btn-icon btn-icon-sm hover:bg-surface-200-800 shrink-0 pointer-coarse:size-11"
							aria-label="Close"
							onclick={requestClose}
						>
							<Icons.X size={16} aria-hidden="true" />
						</button>
					</div>

					{#if creating && jobs.length}
						<Select
							label="What it's for"
							options={jobs.map((j) => ({
								value: j.id,
								label: j.label
							}))}
							value={draft.transform}
							onValueChange={(v) => {
								if (!v || v === draft.transform) return
								draft.transform = v
								draft.connectionId = null
								draft.connectionModelId = null
								draft.samplingConfigId = null
								draft.workflowId = null
								draft.workflowValues = {}
							}}
						/>
					{/if}

					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							aria-pressed={draft.isDefault}
							disabled={header.defaultLocked || merged}
							title={header.defaultLocked
								? "Make another loadout the default to change this"
								: undefined}
							class="inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium disabled:cursor-default pointer-coarse:min-h-11 {draft.isDefault
								? 'preset-pressed'
								: 'preset-tonal-surface'}"
							onclick={() => (draft.isDefault = !draft.isDefault)}
						>
							<Icons.Star
								size={14}
								class={draft.isDefault ? "fill-current" : ""}
								aria-hidden="true"
							/>
							{header.defaultLabel}
						</button>
						<p
							class="flex min-w-0 items-center gap-1.5 text-sm {runs.tone ===
							'unfilled'
								? 'text-primary-ink'
								: 'text-surface-700-300'}"
							role="status"
							aria-label="What runs: {runs.text}"
						>
							{#if runs.tone === "unfilled"}
								<span
									class="bg-primary-500 size-2 shrink-0 rounded-full"
									aria-hidden="true"
								></span>
							{:else if runs.tone === "merged"}
								<Icons.Merge
									size={14}
									class="shrink-0"
									aria-hidden="true"
								/>
							{:else}
								<Icons.Play
									size={14}
									class="shrink-0"
									aria-hidden="true"
								/>
							{/if}
							<span class="min-w-0 break-words">{runs.text}</span>
						</p>
					</div>

					{#if merged && loadout}
						<div
							class="bg-surface-200-800 flex flex-col gap-2 rounded-container p-3 @lg/editor:flex-row @lg/editor:items-center"
							role="status"
						>
							<p class="min-w-0 flex-1 text-sm">
								<span class="font-medium">
									{header.mergedLine}.
								</span>
								<span class="text-surface-700-300">
									It runs as its parent; the fields below are
									kept but not used.
								</span>
							</p>
							<div class="flex shrink-0 gap-2">
								{#if onOpenLoadout && loadout.mergedInto != null}
									{@const parentId = loadout.mergedInto}
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface"
										onclick={() => onOpenLoadout(parentId)}
									>
										Open {loadout.mergedIntoName ??
											"parent"}
									</button>
								{/if}
								<button
									type="button"
									class="btn btn-sm preset-tonal-primary"
									disabled={busy === "merge"}
									onclick={() => merge(null)}
								>
									<Icons.Unlink
										size={14}
										aria-hidden="true"
									/>
									{VERBS.unmerge}
								</button>
							</div>
						</div>
					{/if}
					{#if header.editable}
						<label class="sr-only" for="{uid}-description">
							Description
						</label>
						<textarea
							id="{uid}-description"
							class="textarea text-surface-800-200 min-h-[2.75rem] resize-y text-sm leading-relaxed"
							rows="2"
							placeholder="What this loadout is for, and what suits it."
							bind:value={draft.description}
						></textarea>
					{:else if loadout?.description}
						<div class="flex flex-col items-start gap-2">
							<Dialog.Description
								class="text-surface-700-300 max-w-[70ch] text-sm leading-relaxed"
							>
								{loadout.description}
							</Dialog.Description>
							<button
								type="button"
								class="text-surface-600-400 hover:text-surface-950-50 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline pointer-coarse:min-h-11"
								disabled={busy === "duplicate"}
								onclick={duplicate}
							>
								<Icons.Copy size={12} aria-hidden="true" />
								{VERBS.duplicate}
							</button>
						</div>
					{/if}
				</header>

				<!-- Body: the one scroller -->
				<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
					<div class="flex flex-col gap-3">
						<!-- What to choose for, and why it matters: the
						     Pipelines Loadout row's *Needs* and *Best with*,
						     and who runs on it. -->
						{#if needs.length || bestWith.words.length || loadout}
							<section
								class="bg-surface-200-800 flex flex-col gap-2 rounded-container px-3 py-2.5 text-sm"
								aria-label="What to choose for"
								data-loadout-needs
							>
								{#if needs.length || bestWith.words.length}
									<dl
										class="grid grid-cols-1 gap-x-3 gap-y-1.5 @lg/editor:grid-cols-[auto_1fr]"
									>
										{#if needs.length}
											<dt class="font-medium">Needs</dt>
											<dd class="flex flex-col gap-1">
												{#each needs as need (need.word)}
													<span>
														<span
															class="text-surface-950-50"
														>
															{need.lead}
														</span>
														<span
															class="text-surface-700-300"
														>
															{need.why}
														</span>
													</span>
												{/each}
											</dd>
										{/if}
										{#if bestWith.words.length}
											<dt class="font-medium">
												Best with
											</dt>
											<dd class="text-surface-700-300">
												{bestWith.words.join(" · ")}
											</dd>
										{/if}
									</dl>
								{/if}
								{#if loadout}
									<div class="flex flex-col items-start gap-1">
										<button
											type="button"
											class="text-surface-700-300 hover:text-surface-950-50 -mx-1 inline-flex min-h-8 items-center gap-1.5 rounded-lg px-1 text-left pointer-coarse:min-h-11"
											aria-expanded={usedByOpen}
											aria-controls="{uid}-used"
											onclick={() => (usedByOpen = !usedByOpen)}
										>
											<Icons.ListTree
												size={14}
												class="shrink-0"
												aria-hidden="true"
											/>
											<span>
												<span class="font-medium">
													{header.usedBy}.
												</span>
												{usedByWhy(loadout.usedBy.steps)}
											</span>
											{#if loadout.usedBy.pipelines.length}
												<Icons.ChevronDown
													size={14}
													class="shrink-0 transition-transform {usedByOpen
														? 'rotate-180'
														: ''}"
													aria-hidden="true"
												/>
											{/if}
										</button>
										{#if usedByOpen && loadout.usedBy.pipelines.length}
											<ul
												id="{uid}-used"
												class="text-surface-700-300 flex flex-col gap-0.5 pl-6"
											>
												{#each loadout.usedBy.pipelines as name (name)}
													<li>{name}</li>
												{/each}
											</ul>
										{/if}
									</div>
								{/if}
							</section>
						{/if}
						<fieldset
							class="flex min-w-0 flex-col gap-3"
							disabled={merged}
						>
							<legend class="sr-only">
								What this loadout runs on
							</legend>
							<ModelCard
								{options}
								{chosenKey}
								transform={draft.transform}
								{jobLabel}
								needs={impliedNeeds(loadout?.loadoutId)}
								fallbackName={loadout?.fallbackName ?? null}
								{explanation}
								filling={busy === "fill"}
								disabled={merged}
								onPick={pickModel}
								onClear={clearPair}
								onFill={merged ? undefined : fill}
							/>
							{#if samplingRows.length || outputKindOf(draft.transform) === "text" || draws}
								<SamplingCard
									rows={samplingRows}
									transform={draft.transform}
									bestWithId={bestWith.samplingId}
									checkedId={draft.samplingConfigId}
									{notice}
									disabled={merged}
									onPick={(id) => {
										draft.samplingConfigId = id
										notice = null
									}}
									onOpenSampling={openSampling}
								/>
							{/if}
							{#if showWorkflow}
								<WorkflowCard
									workflowId={draft.workflowId}
									connectionId={draft.connectionId}
									sentence={workflowSentence}
									{dials}
									disabled={merged}
									onWorkflow={pickWorkflow}
									onDial={moveDial}
								/>
							{/if}
						</fieldset>

						{#if mergeOpen && !merged}
							<div class="panel-card flex flex-col gap-2">
								<Select
									label="Merge into"
									options={mergeOptions}
									value={null}
									placeholder="Pick a loadout of the same job"
									onValueChange={(v) => v && merge(Number(v))}
								/>
								<p class="text-surface-600-400 text-xs">
									A merged loadout runs as its parent until
									you unmerge it. Nothing else changes.
								</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Footer -->
				<footer
					class="panel-edge flex shrink-0 flex-col gap-2 border-t px-4 py-3 sm:px-6"
				>
					{#if problem}
						<p
							class="text-error-600-400 flex items-start gap-1.5 text-sm"
							role="alert"
						>
							<Icons.CircleAlert
								size={14}
								class="mt-0.5 shrink-0"
								aria-hidden="true"
							/>
							<span>{problem.text}</span>
						</p>
					{/if}
					<div class="flex flex-wrap items-center gap-2">
						{#if loadout}
							{#if !merged && mergeOptions.length}
								<button
									type="button"
									class="btn btn-sm text-surface-700-300 hover:bg-surface-200-800 px-2"
									aria-expanded={mergeOpen}
									disabled={busy === "merge"}
									onclick={() => (mergeOpen = !mergeOpen)}
								>
									<Icons.Merge size={14} aria-hidden="true" />
									{VERBS.mergeInto}
								</button>
							{/if}
							{#if header.canDelete}
								<button
									type="button"
									class="btn btn-sm text-error-600-400 hover:bg-error-500/10 px-2"
									onclick={() => (asking = "delete")}
								>
									<Icons.Trash2
										size={14}
										aria-hidden="true"
									/>
									{VERBS.delete}
								</button>
							{/if}
						{/if}
						<span class="flex-1"></span>
						<div class="flex gap-2">
							<button
								type="button"
								class="btn preset-tonal-surface"
								onclick={requestClose}
							>
								{VERBS.cancel}
							</button>
							<button
								type="button"
								class="btn preset-filled-primary-500"
								disabled={!canSave(draft) ||
									busy === "save" ||
									(!creating && !edits.dirty)}
								onclick={save}
							>
								{creating ? VERBS.create : VERBS.save}
							</button>
						</div>
					</div>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<!-- Mounted only while asked: a dialog portaled before the editor opened
     would sit under the editor's aria-hidden for good. -->
{#if asking === "discard"}
	<ConfirmDialog
		open
		title="Discard unsaved changes?"
		body="This loadout has changes you haven't saved. If you go on, they are lost."
		keepLabel="Keep editing"
		confirmLabel="Discard"
		onKeep={() => (asking = null)}
		onConfirm={discard}
	/>
{/if}
{#if asking === "delete"}
	<ConfirmDialog
		open
		title="Delete {loadout?.name ?? 'this loadout'}?"
		body="The loadout goes. Steps that name it run on their job's default instead; the models and sampling configs stay."
		keepLabel="Keep it"
		confirmLabel="Delete loadout"
		busy={busy === "delete"}
		onKeep={() => (asking = null)}
		onConfirm={remove}
	/>
{/if}
