<script lang="ts">
	/**
	 * Admin → Connections → one connection: the change form (owner ruling
	 * 2026-09-27 — Django-style management, not the Connections view nested
	 * in admin). Everything an admin sets on a connection, in fieldsets:
	 *
	 * - **Status** — does it answer (the same line the Connections view
	 *   shows), and Test.
	 * - **Identity** — name and notes; service, type and modality readonly.
	 * - **Endpoint and credentials** — the service's own form
	 *   (`ConnectionTypeForm`, shared with the Connections view).
	 * - **KoboldCPP runtime** — for the managed KoboldCPP: the manager's own
	 *   settings, binary and server address (`KoboldCppSettingsTab`).
	 * - **Models** — what the host lists, with Refresh, Add by name, enable
	 *   switches, Use and, on a local ONNX endpoint, Download / Cancel. The
	 *   switches and Use are pending changes that wait for Save (owner ruling
	 *   2026-10-03, `modelEdits.ts`); Refresh, Add by name and Download /
	 *   Cancel are one-shot acts and still act when pressed.
	 * - **Defaults** — which capability defaults point here.
	 * - **Stop scripts**, and under **Advanced**, the capability overrides
	 *   and the lane panels.
	 *
	 * The draft is saved with `connections:update` — the same event, the
	 * same server rules as the Connections view — and then the model levers,
	 * one write at a time (`saveInSequence`), each waiting for its answer.
	 * What writes on its own (capabilities, stop scripts, the runtime's
	 * settings, a model sync or download) is never part of the draft, so it
	 * is never an unsaved change.
	 *
	 * Running the runtime (Start, Stop, set-up, finding models to download)
	 * is operating it, not administering it: those stay in the Connections
	 * view, one press away ("Open in Connections").
	 */
	import { getContext, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import {
		adminGoto,
		adminPage,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import {
		saveErrors,
		saveInSequence,
		saveSummary,
		type SaveStep
	} from "$lib/client/admin/sequentialSave"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { NOTE_MAX_LENGTH, normalizeNote } from "$lib/shared/utils/connectionNotes"
	import { keyUrlFor, needsCredential } from "$lib/shared/connections/credentials"
	import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"
	import { NER_CAPABILITY } from "$lib/shared/constants/ner"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import ConnectionTypeForm from "$lib/client/components/connections/ConnectionTypeForm.svelte"
	import ConnectionStopScripts from "$lib/client/components/connections/ConnectionStopScripts.svelte"
	import ConnectionCapabilities from "$lib/client/components/connections/ConnectionCapabilities.svelte"
	import EmbeddingSwitchDialog from "$lib/client/components/connections/EmbeddingSwitchDialog.svelte"
	import {
		addressOf,
		useEmbeddingEditConfirm
	} from "$lib/client/components/connections/useEmbeddingEditConfirm.svelte"
	import EmbeddingQueuePanel from "$lib/client/components/connections/EmbeddingQueuePanel.svelte"
	import NerLanePanel from "$lib/client/components/connections/NerLanePanel.svelte"
	import ModelTable from "$lib/client/components/connections/ModelTable.svelte"
	import ModelRow from "$lib/client/components/connections/ModelRow.svelte"
	import KoboldCppSettingsTab from "$lib/client/components/koboldcppManager/KoboldCppSettingsTab.svelte"
	import { serviceLabel } from "$lib/client/components/connections/connectionIndexFilter"
	import {
		endpointKind,
		isLocalOnnxType,
		manualAddAllowed,
		rowAction
	} from "$lib/client/components/connections/modelManagement"
	import {
		modelsHeadline,
		statusLine,
		type LastTest
	} from "$lib/client/components/connections/connectionViewChrome"
	import {
		capabilityWord,
		connectionDeletion,
		defaultsHeldBy,
		managerFlagsReleased,
		modalityWord
	} from "./connectionsAdmin"
	import {
		defaultMarksWithEdits,
		liveModelEdits,
		modelEditCount,
		modelEditPlan,
		modelsWithEdits,
		noModelEdits,
		withDefaultEdit,
		withEnabledEdit,
		withoutSteps,
		type ModelEdits
	} from "./modelEdits"

	type ListRow = Sockets.Connections.List.Row & { id: number }

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const koboldCppSettingsCtx: KoboldCppSettingsCtx | undefined =
		getContext("koboldCppSettingsCtx")
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")
	const userCtx: { user: SelectUser } | undefined = getContext("userCtx")

	/**
	 * Derived, not read once: AdminView keys the section on its path, but the
	 * outgoing page is remounted under the new path for a frame while the
	 * next one loads, so a one-time read can see another address's params.
	 * Everything below fetches only for a real id.
	 */
	const id = $derived(Number(adminPage.params.id))
	const validId = $derived(Number.isInteger(id) && id > 0)

	// ── the list row: models, sync state, credential flag ───────────────
	let rows = $state<ListRow[]>([])
	let listLoaded = $state(false)
	const row = $derived(rows.find((r) => r.id === id) ?? null)
	useInterest<"connections:list">("connections:list", (msg) => {
		rows = msg.connectionsList.filter((c): c is ListRow => c.id != null)
		listLoaded = true
	})
	/** One model's disk state, patched in place while a download runs. */
	function handleLocal(msg: Sockets.Connections.DownloadModel.Response) {
		if (msg.connectionId !== id || msg.modelId == null) return
		rows = rows.map((r) =>
			r.id !== id
				? r
				: {
						...r,
						models: r.models.map((m) =>
							m.id === msg.modelId ? { ...m, local: msg.local } : m
						)
					}
		)
	}
	useInterest<"connections:modelDownloadProgress">(
		"connections:modelDownloadProgress",
		handleLocal
	)
	useInterest<"connections:downloadModel">("connections:downloadModel", handleLocal)
	useInterest<"connections:cancelModelDownload">(
		"connections:cancelModelDownload",
		handleLocal
	)

	// ── the draft ───────────────────────────────────────────────────────
	let connection = $state<any>(undefined)
	const edits = new UnsavedEdits(() => connection)
	/**
	 * The Models table's levers — Hide / Show and Use — held until Save
	 * (`modelEdits.ts`). Kept beside the connection draft rather than in it:
	 * they are written by other events, one model at a time.
	 */
	let modelEdits = $state<ModelEdits>(noModelEdits())
	adminUnsavedEdits(() => edits.dirty || modelDirty)

	useInterest<"connections:get">("connections:get", (msg) => {
		// emitToUser: another view loading another connection lands here too.
		if (msg.connection?.id !== id) return
		const next = { ...msg.connection }
		untrack(() => {
			if (connection === undefined) {
				connection = next
				edits.markSaved()
			} else edits.adoptSaved(next, (n) => (connection = n))
		})
	})

	// ── save ────────────────────────────────────────────────────────────
	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let formErrors = $state<string[]>([])
	let nameError = $state<string | null>(null)

	/**
	 * A save that moves the starred embedding connection to another address
	 * re-embeds the index, so it asks first — the star's own confirmation.
	 */
	const embeddingEdits = useEmbeddingEditConfirm()

	async function save(intent: AdminSaveIntent) {
		if (!connection) return
		const name = String(connection.name ?? "").trim()
		nameError = name ? null : "A connection needs a name."
		formErrors = []
		if (nameError) return
		connection.name = name
		connection.notes = normalizeNote(connection.notes)
		if (!edits.dirty) {
			if (modelDirty) return void saveModelEdits(intent)
			return land(intent)
		}
		// `modelsSyncedAt` is the sync's own stamp: it reaches the client as a
		// string and the update handler writes it back as a timestamp, which
		// throws (`value.toISOString is not a function`). Not ours to send.
		const { modelsSyncedAt: _stamp, ...payload } = $state.snapshot(connection)
		const savedBaseUrl = (edits.saved as { baseUrl?: string | null })?.baseUrl
		if ((payload.baseUrl ?? "") !== (savedBaseUrl ?? "")) {
			const star = systemSettingsCtx.capabilityDefaults?.[EMBEDDING_CAPABILITY]
			const model =
				payload.models?.find?.(
					(m: { id: number }) => m.id === star?.connectionModelId
				)?.name ?? payload.name
			const ok = await embeddingEdits.confirmEdit({
				connectionId: payload.id,
				edit: { baseUrl: payload.baseUrl ?? "" },
				currentName: `${model} at ${addressOf(savedBaseUrl)}`,
				nextName: `${model} at ${addressOf(payload.baseUrl)}`
			})
			if (!ok) return
		}
		saving = true
		pendingIntent = intent
		socket.emit("connections:update", { connection: payload })
	}
	function land(intent: AdminSaveIntent) {
		if (intent === "save") void adminGoto("/admin/connections")
		else if (intent === "another") void adminGoto("/admin/connections/new")
	}
	useInterest<"connections:update">("connections:update", (msg) => {
		if (msg.connection?.id !== id) return
		const mine = pendingIntent
		if (!mine) {
			// Another view's save: a clean form takes it, a dirty one keeps
			// the edits and only moves what "saved" means.
			edits.adoptSaved({ ...msg.connection }, (n) => (connection = n))
			return
		}
		connection = { ...msg.connection }
		edits.markSaved()
		pendingIntent = null
		saving = false
		if (msg.notice)
			toaster.warning({ title: "Preset not kept", description: msg.notice })
		// The host or key may have changed; the models follow the save.
		requestSync(true)
		// The model levers go next, and their summary is the Save's: one
		// "Saved" for one press, said only once everything has answered.
		if (modelDirty) {
			void saveModelEdits(mine)
			return
		}
		toaster.success({ title: `Saved ${msg.connection.name}` })
		land(mine)
	})

	/**
	 * Send the model levers, one write at a time, each waiting for ITS
	 * answer (`saveInSequence`): visibility first, then defaults. What landed
	 * leaves the draft; a refusal is named in the error summary and stays a
	 * pending change, so Save can be pressed again.
	 */
	async function saveModelEdits(intent: AdminSaveIntent) {
		if (!row) return land(intent)
		const plan = modelEditPlan(liveEdits, row.models, capabilityWord)
		if (!plan.length) return land(intent)
		const steps: SaveStep[] = plan.map((step) =>
			step.kind === "enabled"
				? {
						label: step.label,
						run: () =>
							awaitReply({
								socket,
								event: "connections:updateModel",
								errorEvent: "connections:updateModel:error",
								params: {
									id,
									modelId: step.modelId,
									model: { enabled: step.enabled }
								},
								match: (r) => r.connectionId === id
							})
					}
				: {
						label: step.label,
						after: step.after,
						run: () =>
							awaitReply({
								socket,
								event: "connections:setDefault",
								errorEvent: "connections:setDefault:error",
								params: {
									capability: step.capability as any,
									id,
									modelId: step.modelId
								},
								match: (r) =>
									r.capability === step.capability &&
									r.id === id &&
									r.modelId === step.modelId
							})
					}
		)
		saving = true
		formErrors = []
		const outcome = await saveInSequence(steps)
		saving = false
		modelEdits = withoutSteps(modelEdits, plan, outcome.landed)
		if (outcome.refused.length || outcome.skipped.length) {
			formErrors = saveErrors(outcome)
			toaster.warning({ title: saveSummary(outcome, title) })
			return
		}
		toaster.success({ title: saveSummary(outcome, title) })
		land(intent)
	}
	useInterest<"connections:update:error">("connections:update:error", (msg) => {
		if (!pendingIntent) return
		pendingIntent = null
		saving = false
		const error = msg.error ?? "The connection was not saved."
		if (/name/i.test(error)) nameError = error
		else formErrors = [error]
	})

	// ── delete ──────────────────────────────────────────────────────────
	let deleting = false
	function remove() {
		if (!row) return
		for (const event of managerFlagsReleased([id], rows))
			socket.emit(event, { enabled: false })
		deleting = true
		socket.emit("connections:delete", { id })
	}
	useInterest<"connections:delete">("connections:delete", (msg) => {
		if (msg.id !== id) return
		edits.forget()
		if (deleting) toaster.success({ title: "Connection deleted" })
		void adminGoto("/admin/connections", { replaceState: true })
	})

	// ── status: test and model sync ─────────────────────────────────────
	let lastTest = $state<LastTest | null>(null)
	let testing = $state(false)
	useInterest<"connections:test">("connections:test", (msg) => {
		if (msg.connectionId !== id) return
		testing = false
		lastTest = { ok: msg.ok, error: msg.error ?? null, at: Date.now() }
	})
	function test() {
		if (!connection) return
		testing = true
		socket.emit("connections:test", { connection })
	}
	let syncing = $state(false)
	function requestSync(force: boolean) {
		syncing = true
		socket.emit("connections:syncModels", { id, ...(force ? { force: true } : {}) })
	}
	useInterest<"connections:syncModels">("connections:syncModels", (msg) => {
		syncing = false
		const mine = msg.results.find((r) => r.connectionId === id)
		if (mine?.error)
			toaster.warning({ title: "Couldn't list models", description: mine.error })
	})
	useInterest<"connections:syncModels:error">("connections:syncModels:error", (msg) => {
		syncing = false
		toaster.error({ title: msg.error ?? "Couldn't refresh models" })
	})

	onMount(() => socket.emit("connections:list", {}))
	$effect(() => {
		if (!validId) return
		const want = id
		untrack(() => {
			connection = undefined
			edits.forget()
			modelEdits = noModelEdits()
			lastTest = null
			socket.emit("connections:get", { id: want })
			// Stale-only: a fresh listing is skipped server-side.
			requestSync(false)
		})
	})

	// ── what the page shows ─────────────────────────────────────────────
	const defaults = $derived(systemSettingsCtx?.capabilityDefaults ?? {})
	const kind = $derived(endpointKind(row?.type ?? connection?.type))
	const isOnnx = $derived(isLocalOnnxType(row?.type ?? connection?.type))
	const isManagedKcpp = $derived(
		(row?.type ?? connection?.type) === CONNECTION_TYPE.KOBOLDCPP_MANAGED
	)
	const held = $derived(row ? defaultsHeldBy(row, defaults) : [])
	const service = $derived(
		serviceLabel({
			type: row?.type ?? connection?.type,
			preset: row?.preset ?? connection?.preset
		})
	)
	const title = $derived(connection?.name?.trim() || row?.name || "Connection")
	const missingCount = $derived(
		(row?.models ?? []).filter((m) => m.missingSince != null).length
	)
	const line = $derived(
		row
			? statusLine({
					lastTest,
					testing,
					syncing,
					modelsSync: row.modelsSync,
					modelCount: row.models.length,
					missingCount,
					timeAgo
				})
			: null
	)
	const unfinished = $derived(
		!!row &&
			needsCredential({
				type: row.type,
				preset: row.preset,
				baseUrl: connection?.baseUrl ?? row.baseUrl,
				hasCredential: row.hasCredential
			})
	)
	const keyUrl = $derived(row ? keyUrlFor({ type: row.type, preset: row.preset }) : null)
	const DOT: Record<string, string> = {
		ok: "bg-success-500",
		pending: "bg-warning-500 animate-pulse",
		warning: "bg-warning-500",
		error: "bg-error-500",
		quiet: "bg-surface-400-600"
	}
	/** The models fieldset's own width decides table or rows. */
	let modelsWidth = $state(0)

	/** The model levers that still differ from what is saved. */
	const liveEdits = $derived(
		row ? liveModelEdits(modelEdits, row.models, defaults, id) : noModelEdits()
	)
	const modelDirty = $derived(modelEditCount(liveEdits) > 0)
	/** What Save would send, in order — also the "Waiting for Save" chips. */
	const pendingSteps = $derived(
		row ? modelEditPlan(liveEdits, row.models, capabilityWord) : []
	)
	/** The models as drawn: visibility from the draft. */
	const shownModels = $derived(row ? modelsWithEdits(row.models, liveEdits) : [])
	/**
	 * Capability labels per model id, for the table's default marks — the
	 * saved ones, with every capability a pending Use moves taken from the
	 * draft.
	 */
	const defaultsByModel = $derived(
		defaultMarksWithEdits(defaults, liveEdits, id, capabilityWord)
	)

	// ── model presses ───────────────────────────────────────────────────
	/**
	 * Use: ask for the model as a default — a pending change, sent on Save.
	 * Chat where it can serve it, else the first thing it can. Moving the
	 * embeddings or entities default throws stored work away, so that one
	 * goes to Admin → Defaults, which shows the cost before it asks.
	 */
	function useModel(modelId: number) {
		const m = row?.models.find((x) => x.id === modelId)
		if (!m) return
		const serves = m.satisfiableCapabilities ?? []
		const capability = serves.includes("text->text") ? "text->text" : serves[0]
		if (!capability) return
		const current = defaults[capability]
		const costly =
			(capability === EMBEDDING_CAPABILITY || capability === NER_CAPABILITY) &&
			current?.connectionId != null &&
			(current.connectionId !== id || current.connectionModelId !== m.id)
		if (costly) {
			toaster.info({
				title: `Switching ${capabilityWord(capability)} rebuilds stored work`,
				description: "Admin → Defaults shows the cost before it switches."
			})
			void adminGoto("/admin/defaults")
			return
		}
		modelEdits = withDefaultEdit(modelEdits, capability, m.id, defaults, id)
	}
	/** Hide / Show: a pending change, sent on Save. */
	function toggleModel(modelId: number, enabled: boolean) {
		const m = row?.models.find((x) => x.id === modelId)
		if (m) modelEdits = withEnabledEdit(modelEdits, m, enabled)
	}
	/** One "Waiting for Save" chip's ×: that lever goes back to what is saved. */
	function dropPending(label: string) {
		modelEdits = withoutSteps(modelEdits, pendingSteps, [label])
	}
	function modelAction(model: ListRow["models"][number]) {
		const isDefault = !!defaultsByModel[model.id]?.length
		const action = rowAction(kind, model, { isDefault })
		if (!action) return
		if (action.verb === "download" || action.verb === "retry")
			socket.emit("connections:downloadModel", { id, modelId: model.id })
		else if (action.verb === "cancel")
			socket.emit("connections:cancelModelDownload", { id, modelId: model.id })
		else if (action.verb === "makeActive") useModel(model.id)
	}
	let addOpen = $state(false)
	let addModel = $state("")
	let addLabel = $state("")
	function submitAdd() {
		if (!addModel.trim()) return
		socket.emit("connections:createModel", {
			id,
			model: {
				model: addModel.trim(),
				...(addLabel.trim() ? { name: addLabel.trim() } : {})
			}
		})
		addModel = ""
		addLabel = ""
		addOpen = false
	}

	/** Out of admin, into the Connections view on this connection. */
	function openInConnections() {
		if (!panelsCtx) return
		panelsCtx.digest.connectionId = id
		panelsCtx.openPanel({ key: "connections" })
	}
</script>

{#if !validId}
	<!-- Between addresses: nothing to show for a frame. -->
{:else if listLoaded && !row && !connection}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">There is no connection {id}.</p>
		<a href="/admin/connections" class="btn btn-sm preset-tonal-surface">
			All connections
		</a>
	</div>
{:else if !connection}
	<div
		class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm"
		role="status"
	>
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading connection…
	</div>
{:else}
	<AdminChangeForm
		mode="change"
		{title}
		noun="connection"
		changelistHref="/admin/connections"
		changelistLabel="Connections"
		dirty={edits.dirty || modelDirty}
		{saving}
		errors={formErrors}
		fieldErrors={{ "connection-admin-name": nameError }}
		historyHref="/admin/history?type=connection&id={id}"
		deletion={() => connectionDeletion(row ? [row] : [], defaults)}
		onDelete={remove}
		onSave={save}
	>
		{#snippet headerActions()}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={openInConnections}
			>
				<Icons.Cable size={16} aria-hidden="true" />
				Open in Connections
			</button>
		{/snippet}
		{#snippet headerExtra()}
			<div class="flex flex-wrap items-center gap-1.5 text-xs">
				<!-- The service chip only where it says what the title has not
				     (STYLE-GUIDE §6.4: a default name IS the service label). -->
				{#if service.trim().toLowerCase() !== title.trim().toLowerCase()}
					<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
						{service}
					</span>
				{/if}
				<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
					{modalityWord(connection.modality)}
				</span>
				{#each held as h (h.capability)}
					<span class="preset-tonal-primary rounded-full px-2 py-0.5">
						Default for {h.label}
					</span>
				{/each}
			</div>
		{/snippet}

		<!-- ── Status ─────────────────────────────────────────────── -->
		{#if row && !isOnnx && line}
			<AdminFieldset
				title="Status"
				description="Whether the host answers with what is saved. Test uses what is on this form."
			>
				{#snippet aside()}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						disabled={testing}
						onclick={test}
					>
						{lastTest ? "Test again" : "Test"}
					</button>
				{/snippet}
				{#if unfinished}
					<p class="text-sm">
						<span class="text-primary-700 dark:text-primary-300 font-medium">
							Needs an API key.
						</span>
						<span class="text-surface-600-400">
							Nothing has failed — put a key in Endpoint and credentials,
							save, then Test.
						</span>
						{#if keyUrl}
							<a
								class="anchor underline underline-offset-2"
								href={keyUrl}
								target="_blank"
								rel="noopener noreferrer">Get a key ↗</a
							>
						{/if}
					</p>
				{:else}
					<p class="flex min-w-0 items-center gap-2 text-sm" aria-live="polite">
						<span class="size-2 shrink-0 rounded-full {DOT[line.dot]}" aria-hidden="true"></span>
						<span class="font-medium">{line.word}</span>
						<span class="text-surface-600-400 min-w-0 truncate text-xs" title={line.sentence}>
							· {line.sentence}
						</span>
					</p>
				{/if}
			</AdminFieldset>
		{/if}

		<!-- ── Identity ───────────────────────────────────────────── -->
		<AdminFieldset title="Identity">
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
				<AdminField
					id="connection-admin-name"
					label="Name"
					required
					error={nameError}
					help="What pickers and the Connections view call it. Unique across this pub."
				>
					<input
						id="connection-admin-name"
						class="input"
						type="text"
						bind:value={connection.name}
						aria-invalid={!!nameError}
						aria-describedby={describedBy("connection-admin-name", !!nameError)}
					/>
				</AdminField>
				<AdminField
					id="connection-admin-service"
					label="Service"
					value={serviceLabel({ type: connection.type, preset: row?.preset ?? connection.preset })}
				/>
				<AdminField
					id="connection-admin-type"
					label="Connection type"
					value={connection.type}
				/>
				<AdminField
					id="connection-admin-modality"
					label="Modality"
					value={modalityWord(connection.modality)}
				/>
			</div>
			<AdminField
				id="connection-admin-notes"
				label="Notes"
				help={'For you, not for the app — "use this one for prose, the other for extraction". Shown beside this connection wherever you pick one.'}
			>
				<textarea
					id="connection-admin-notes"
					rows="3"
					class="textarea"
					maxlength={NOTE_MAX_LENGTH}
					bind:value={connection.notes}
					onblur={() => (connection.notes = normalizeNote(connection.notes))}
					aria-describedby={describedBy("connection-admin-notes", false)}
				></textarea>
			</AdminField>
		</AdminFieldset>

		<!-- ── Endpoint and credentials: the service's own form ───── -->
		<AdminFieldset
			title="Endpoint and credentials"
			description="Where it is, how to sign in, and how requests are shaped. Saved with the form."
		>
			{#key connection.id}
				<div class="connection-admin-form flex flex-col gap-2">
					<ConnectionTypeForm bind:connection />
				</div>
			{/key}
		</AdminFieldset>

		<!-- ── The managed KoboldCPP's own settings ───────────────── -->
		{#if isManagedKcpp}
			<AdminFieldset
				title="KoboldCPP runtime"
				description="The manager's server address, binary and launch settings. These save on their own; start, stop and set up the runtime in the Connections view."
			>
				<KoboldCppSettingsTab
					isManaged={koboldCppSettingsCtx?.settings?.koboldCppManagedMode === "managed"}
					onUpdateBinary={openInConnections}
				/>
			</AdminFieldset>
		{/if}

		<!-- ── Models ─────────────────────────────────────────────── -->
		{#if row}
			<!-- `#models`: Needs you's `connections:syncError` lands here. -->
			<AdminFieldset
				id="models"
				title="Models"
				description={`${modelsHeadline({ modelCount: row.models.length, missingCount })}. Hide, Show and Use wait for Save; Refresh${isOnnx ? ", Download" : ""} and Add by name act at once.`}
			>
				{#snippet aside()}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						disabled={syncing}
						onclick={() => requestSync(true)}
						title="Ask the host for its models again"
					>
						<Icons.RefreshCw
							size={14}
							class={syncing ? "animate-spin" : ""}
							aria-hidden="true"
						/>
						Refresh
					</button>
				{/snippet}
				<div class="flex min-w-0 flex-col gap-3" bind:clientWidth={modelsWidth}>
					{#if !row.models.length}
						<p class="text-surface-600-400 text-sm">
							{#if isOnnx || kind === "koboldcpp-managed" || kind === "ollama"}
								No models on this machine yet. Find and download them in
								the Connections view.
							{:else}
								The host has listed no models. Refresh, or add one by name.
							{/if}
						</p>
					{:else if isOnnx}
						{#each shownModels as m (m.id)}
							{@const action = rowAction(kind, m, {
								isDefault: !!defaultsByModel[m.id]?.length
							})}
							<ModelRow
								model={m}
								defaultFor={defaultsByModel[m.id] ?? []}
								canUse={!!action}
								useLabel={action?.label ?? "Use"}
								useShortLabel={action?.label ?? "Use"}
								note={m.local?.state === "downloading"
									? `Downloading ${Math.round(m.local.percent ?? 0)}%`
									: m.local?.state === "on_disk"
										? "On this machine"
										: null}
								onOpen={openInConnections}
								onUse={() => modelAction(m)}
							/>
						{/each}
					{:else if modelsWidth >= 640}
						<ModelTable
							models={shownModels}
							{defaultsByModel}
							local={kind !== "api"}
							onOpen={openInConnections}
							onUse={useModel}
							onToggleEnabled={toggleModel}
						/>
					{:else}
						{#each shownModels as m (m.id)}
							<ModelRow
								model={m}
								defaultFor={defaultsByModel[m.id] ?? []}
								canUse={!!(m.satisfiableCapabilities ?? []).length &&
									m.enabled !== false &&
									!defaultsByModel[m.id]?.length}
								onOpen={openInConnections}
								onUse={() => useModel(m.id)}
							/>
						{/each}
					{/if}

					{#if pendingSteps.length}
						<!-- The levers pressed since the last Save, each said once
						     with an × that puts it back (§6.3 chips; §6.14: a
						     Save form holds every edit and says which). -->
						<div
							class="flex min-w-0 flex-wrap items-center gap-2"
							role="group"
							aria-label="Model changes waiting for Save"
							data-model-pending
						>
							<span class="text-surface-600-400 text-xs">Waiting for Save:</span>
							{#each pendingSteps as step (step.key)}
								<span
									class="bg-surface-200-800 text-surface-700-300 flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs"
								>
									<span class="min-w-0 truncate">{step.label}</span>
									<button
										type="button"
										class="hover:text-surface-950-50 shrink-0"
										onclick={() => dropPending(step.label)}
										title="Put it back"
										aria-label={`Undo: ${step.label}`}
									>
										<Icons.X size={12} aria-hidden="true" />
									</button>
								</span>
							{/each}
						</div>
					{/if}

					{#if manualAddAllowed(connection.type)}
						{#if addOpen}
							<div class="border-surface-200-800 flex flex-col gap-3 border-t pt-3">
								<AdminField
									id="connection-admin-add-model"
									label="Model identifier"
									help="Exactly as the host expects it, for a host that does not list this model."
								>
									<input
										id="connection-admin-add-model"
										class="input"
										type="text"
										placeholder="gpt-4o-mini"
										bind:value={addModel}
										aria-describedby={describedBy("connection-admin-add-model", false)}
									/>
								</AdminField>
								<AdminField id="connection-admin-add-label" label="Shown as (optional)">
									<input
										id="connection-admin-add-label"
										class="input"
										type="text"
										bind:value={addLabel}
									/>
								</AdminField>
								<div class="flex justify-end gap-2">
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface"
										onclick={() => (addOpen = false)}
									>
										Cancel
									</button>
									<button
										type="button"
										class="btn btn-sm preset-tonal-primary"
										disabled={!addModel.trim()}
										onclick={submitAdd}
									>
										Add model
									</button>
								</div>
							</div>
						{:else}
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface self-start"
								onclick={() => (addOpen = true)}
							>
								<Icons.Plus size={14} aria-hidden="true" />
								Add by name
							</button>
						{/if}
					{/if}
				</div>
			</AdminFieldset>
		{/if}

		<!-- ── Defaults ───────────────────────────────────────────── -->
		<AdminFieldset
			title="Defaults"
			description="The capability defaults that point at this connection. A connection does nothing until one does."
		>
			{#snippet aside()}
				<a href="/admin/defaults" class="btn btn-sm preset-tonal-surface shrink-0">
					<Icons.Target size={14} aria-hidden="true" />
					Change defaults
				</a>
			{/snippet}
			{#if held.length}
				<ul class="flex flex-col gap-1.5 text-sm">
					{#each held as h (h.capability)}
						<li class="flex flex-wrap items-baseline gap-x-2">
							<span class="font-medium">{h.label}</span>
							<span class="text-surface-600-400 text-xs">
								{h.modelName ?? "no model chosen"}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-surface-600-400 text-sm">
					None. Use a model above, or pick this connection in Defaults.
				</p>
			{/if}
		</AdminFieldset>

		<!-- ── Stop scripts ───────────────────────────────────────── -->
		<AdminFieldset
			title="Stop scripts"
			description="Guards that end a streamed reply early. Every pipeline using this connection inherits them. They attach and detach on their own."
		>
			<ConnectionStopScripts connectionId={id} heading={false} />
		</AdminFieldset>

		<!-- ── Advanced ───────────────────────────────────────────── -->
		<AdminFieldset
			title="Advanced"
			description="What the connection can do and who decided it; the indexing lanes."
			collapsible
		>
			<ConnectionCapabilities connectionId={id} />
			{#if connection.modality === "embeddings"}
				<EmbeddingQueuePanel
					isStarred={defaults["text->embedding"]?.connectionId === id}
				/>
			{/if}
			{#if connection.modality === "ner" && userCtx?.user?.isAdmin}
				<NerLanePanel isStarred={defaults["text->entities"]?.connectionId === id} />
			{/if}
		</AdminFieldset>
	</AdminChangeForm>
{/if}

<EmbeddingSwitchDialog {...embeddingEdits.dialog} />
