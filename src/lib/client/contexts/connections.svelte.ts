/**
 * The connections context: the ONE subscriber to the connections list and the
 * events that move it, and the only place their toasts are shown (owner rule
 * 2026-10-05, pilot `characterImports.svelte.ts`). Plan 2026-10-11 (the Models
 * / Connections split), lane L1.
 *
 * What it owns, for every view that shows connections or their models:
 *
 * - **the list** — `connections:list` (+`:error`), sorted by name, with the
 *   local ONNX download patches (`connections:modelDownloadProgress`,
 *   `downloadModel`, `cancelModelDownload` share one shape on purpose: a press
 *   and its progress say the same thing about the same row);
 * - **model sync** — `connections:syncModels` (+`:error`): what is in flight,
 *   and the "Couldn't list models for …" warning for a FORCED sync only;
 * - **one way to choose** — `chooseJobModel`, with the costed confirmation
 *   (`useStarConfirm`) inside: one `connections:setDefault` per move, the
 *   optimistic `capabilityDefaults` patch, ONE success toast when the last ack
 *   of a choice lands. The two cost dialogs render once per shell
 *   (`components/connections/ConnectionsDialogs.svelte`);
 * - **creates** — `connections:create` (+`:error`): the names this tab asked
 *   for (`expectCreate`, `enableManagerHere`), the "Connection created" toast
 *   for those, then every reply handed to the registered listeners with
 *   whether it was this tab's.
 *
 * ## Held, not standing
 *
 * The interests are declared while at least one view HOLDS the context
 * (`useConnections()` holds it for as long as the calling view is mounted),
 * and released with the last holder — the same lifetime the Connections
 * view's own subscriptions had. A shell with no connections view open asks
 * the server for none of these broadcasts and toasts none of them.
 *
 * Provided by both shells (Layout.svelte, AccessibleShell.svelte) at init.
 */
import { getContext, setContext } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import { capabilityLabel } from "@serene-pub/sdk"
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import {
	useTypedSocket,
	type TypedSocket
} from "$lib/client/sockets/typedSocket"
import { toaster } from "$lib/client/utils/toaster"
import { notify } from "$lib/client/utils/notify"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { defaultLoadoutName } from "$lib/shared/loadouts/defaultLoadoutName"
import { needsCredential } from "$lib/shared/connections/credentials"
import {
	useStarConfirm,
	type StarMove
} from "$lib/client/components/connections/useStarConfirm.svelte"
import {
	endpointKind,
	isLocalOnnxType
} from "$lib/client/components/connections/modelManagement"
import {
	enableManager,
	type ManagerKind
} from "$lib/client/components/connections/managers"
import {
	chosenSentence,
	type JobPair
} from "$lib/client/components/connections/jobPicker"
import { resolvePair } from "$lib/client/components/connections/defaultsSummary"
import {
	systemCapabilitiesForModel,
	type PairDefaultSelection
} from "$lib/client/components/connections/modelSystemDefaults"

type ListRow = Sockets.Connections.List.Row
type ListedRow = ListRow & { id: number }
type ListModel = ListRow["models"][number]
type Created = Sockets.Connections.Create.Response
type DefaultSet = Sockets.Connections.SetDefault.Response
type Synced = Sockets.Connections.SyncModels.Response
type Failed = Sockets.ErrorResponse

export const CONNECTIONS_CONTEXT = "connectionsCtx"

export interface ConnectionsDeps {
	/**
	 * The shell's settings context: `capabilityDefaults` is read for the
	 * defaults and patched optimistically on every `connections:setDefault`.
	 */
	systemSettings: SystemSettingsCtx
	/** The socket; the live typed socket when omitted. */
	socket?: TypedSocket
}

/** What a create listener is told besides the reply. */
export interface CreatedInfo {
	/** This tab asked for it (`expectCreate` / `enableManagerHere`). */
	mine: boolean
}

/** Subscribes (while held) and sets the context. Call during a shell's init. */
export function provideConnections(deps: ConnectionsDeps): ConnectionsCtx {
	const ctx = createConnections(deps)
	setContext(CONNECTIONS_CONTEXT, ctx)
	return ctx
}

/**
 * The context, holding its interests for as long as the calling view is
 * mounted. Call during component initialisation, ABOVE any effect that asks
 * for the list — effects run in creation order, and a request flushes the
 * pending interest sync its reply rides on.
 */
export function useConnections(): ConnectionsCtx {
	const ctx = getContext<ConnectionsCtx>(CONNECTIONS_CONTEXT)
	$effect(() => ctx.hold())
	return ctx
}

/** The state, the subscriptions and the listener sets (testable). */
export function createConnections(deps: ConnectionsDeps) {
	const socket = deps.socket ?? useTypedSocket()
	const settings = deps.systemSettings

	const created = new Set<(msg: Created, info: CreatedInfo) => void>()
	const createFailed = new Set<(msg: Failed) => void>()
	const defaultSet = new Set<(msg: DefaultSet) => void>()
	const synced = new Set<(msg: Synced) => void>()
	const announced = new Set<(message: string) => void>()

	function listen<T>(set: Set<T>, listener: T): () => void {
		set.add(listener)
		return () => {
			set.delete(listener)
		}
	}
	/** The screen-reader line, said by whichever views registered for it. */
	function announce(message: string) {
		for (const listener of announced) listener(message)
	}

	// ── The list ────────────────────────────────────────────────────────────
	let list = $state<ListRow[]>([])
	let loading = $state(true)
	/** The list's rows, each with its id (the guard is for the type). */
	const listed = $derived(list.filter((c): c is ListedRow => c.id != null))

	function handleList(msg: Sockets.Connections.List.Response) {
		list = msg.connectionsList
			.slice()
			.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
		loading = false
	}
	// Layout's catch-all is told this one is handled (HANDLED_ERROR_EVENTS);
	// this just stops the spinner so the view settles into its empty state.
	function handleListError() {
		loading = false
	}
	/** One row's disk state, replaced in place. An unknown id is ignored. */
	function handleModelLocalState(
		msg: Sockets.Connections.DownloadModel.Response
	) {
		if (msg.connectionId == null || msg.modelId == null) return
		list = list.map((c) =>
			c.id !== msg.connectionId
				? c
				: {
						...c,
						models: c.models.map((m) =>
							m.id === msg.modelId
								? { ...m, local: msg.local }
								: m
						)
					}
		)
	}
	function requestList() {
		socket.emit("connections:list", {})
	}

	// ── Model sync ──────────────────────────────────────────────────────────
	/** Endpoints with a sync in flight (reactive Set — see the memory note). */
	const syncingIds = new SvelteSet<number>()
	let syncingAll = $state(false)
	/** Forced syncs — the ones whose failure earns a toast. Not $state. */
	const forcedIds = new Set<number>()
	/** This tab forced a sync of every endpoint (the same rule, id-less). */
	let forcedAll = false

	function requestSync(id?: number, force = false) {
		if (id != null) {
			syncingIds.add(id)
			if (force) forcedIds.add(id)
			socket.emit("connections:syncModels", {
				id,
				...(force ? { force: true } : {})
			})
		} else {
			syncingAll = true
			if (force) forcedAll = true
			socket.emit("connections:syncModels", force ? { force: true } : {})
		}
	}
	/**
	 * Whether a sync's failure is one this tab pressed for. A sync nobody
	 * forced — the one a list asks for as it opens, or another tab's
	 * broadcast — is a poll: its row already says _Not working_, so its
	 * failure is never a toast (PLAN-0-5-polish-parity L4.4).
	 */
	const askedHere = () => forcedAll || forcedIds.size > 0
	function handleSyncModels(msg: Synced) {
		// Broadcast to every tab; results name the endpoints that were
		// actually synced (fresh ones are skipped and absent). Clearing every
		// pending marker on any response is deliberate — a sync in another
		// tab ending ours a moment early costs a spinner, not a fact.
		syncingIds.clear()
		syncingAll = false
		if (msg.error)
			notify.error({
				title: msg.error,
				source: "connections:sync",
				fromPoll: !askedHere()
			})
		for (const r of msg.results) {
			if (!r.error || !forcedIds.has(r.connectionId)) continue
			const name =
				list.find((c) => c.id === r.connectionId)?.name ??
				"the connection"
			toaster.warning({
				title: `Couldn't list models for ${name}`,
				description: r.error
			})
		}
		forcedIds.clear()
		forcedAll = false
		for (const listener of synced) listener(msg)
	}
	function handleSyncModelsError(msg: { error?: string }) {
		const fromPoll = !askedHere()
		syncingIds.clear()
		syncingAll = false
		forcedIds.clear()
		forcedAll = false
		notify.error({
			title: msg.error ?? "Couldn't refresh models",
			source: "connections:sync",
			fromPoll
		})
	}
	/**
	 * Whether a follow-up model sync may be forced for this connection. ⚠ Not
	 * where the listing fails by construction, because the forced path's
	 * "Couldn't list models" toast would greet the person instead:
	 * - a managed runtime (a KoboldCPP with no binary yet, an Ollama nobody
	 *   has started) — its view's status card says so;
	 * - a service that needs a key it doesn't have yet — the card says
	 *   "Needs an API key", and Save asks again with the key;
	 * - a custom OpenAI-compatible server with no address yet, which would
	 *   be asked at OpenAI's own address instead.
	 * Reads the list row for the key check, so call it after the list reply
	 * for this connection has landed (it lands before create/update acks).
	 */
	function syncMayForce(target: {
		id: number
		type: string
		baseUrl?: string | null
	}): boolean {
		const kind = endpointKind(target.type)
		const managed = kind === "koboldcpp-managed" || kind === "ollama"
		const row = list.find((c) => c.id === target.id)
		const keyMissing = !!row && needsCredential(row)
		const addressMissing =
			target.type === CONNECTION_TYPE.OPENAI && !target.baseUrl?.trim()
		return !managed && !keyMissing && !addressMissing
	}

	// ── Creates ─────────────────────────────────────────────────────────────
	/**
	 * Names of the connections THIS tab asked to create, so its reaction to
	 * `connections:create` is to its own acks only. The server answers the
	 * asker alone; this is the belt to that braces — a foreign ack must never
	 * close this tab's dialog or pull it onto another connection. Keys are
	 * trimmed and lower-cased, the same comparison the duplicate-name check
	 * uses. Not reactive: nothing renders from it.
	 */
	const pendingCreateNames = new Set<string>()
	const createNameKey = (name: string | null | undefined) =>
		(name ?? "").trim().toLowerCase()
	function expectCreate(name: string | null | undefined) {
		pendingCreateNames.add(createNameKey(name))
	}
	/** `enableManager`, remembering the name of any row it asks to create. */
	function enableManagerHere(kind: ManagerKind) {
		const result = enableManager(kind, socket, list)
		if (result.plan.create)
			expectCreate(String(result.plan.create.name ?? ""))
		return result
	}
	function handleCreate(msg: Created) {
		if (!msg.connection?.id) return
		const mine = pendingCreateNames.delete(
			createNameKey(msg.connection.name)
		)
		if (mine) {
			toaster.success({ title: "Connection created" })
			announce(`New connection ${msg.connection?.name} has been created`)
		}
		for (const listener of created) listener(msg, { mine })
	}
	// No toast: Layout's catch-all says a refused create, as it always has.
	function handleCreateError(msg: Failed) {
		for (const listener of createFailed) listener(msg)
	}

	// ── One way to choose (design 2026-10-09 C.3) ───────────────────────────
	/**
	 * A choice that throws stored work away asks first — the embedding job
	 * with the server's price, the entity job with its re-scan count — in the
	 * one flow every screen that moves a star shares (`useStarConfirm`). A
	 * "default for all" press stages several; the questions chain (re-embed,
	 * then re-scan) before the single write. The first choice on a fresh
	 * install, a re-choice of the model the index was built with, and a
	 * second row naming the same address and model cost nothing and go
	 * straight through.
	 */
	const stars = useStarConfirm({
		getDefaults: () => settings.capabilityDefaults ?? undefined,
		modelOf: (connectionId, modelId) => {
			const connection = list.find((c) => c.id === connectionId)
			const model = connection?.models.find((m) => m.id === modelId)
			// "…stays on disk" is only true of a model whose FILES this
			// install owns; a hosted endpoint leaves nothing to switch back to.
			return model
				? {
						name: model.name,
						isLocal: isLocalOnnxType(connection!.type)
					}
				: null
		},
		commit: commitSetDefault
	})

	/**
	 * The choice waiting on its replies, so it is said ONCE: one toast when
	 * the last of its moves lands, however many jobs it named. Not $state.
	 */
	let pendingChoice: { sentence: string; waiting: Set<string> } | null = null

	/**
	 * THE way a model becomes the one a job — or several jobs — uses.
	 *
	 * Every button that does it calls this, whatever it is called where it
	 * stands (**Use**, **Use in Reply**, **Make active**, **Set as default…**),
	 * and Set up chat's first model does too. Nothing else in the connections
	 * views emits `connections:setDefault`.
	 */
	function chooseJobModel(job: string | readonly string[], pair: JobPair) {
		const jobs = typeof job === "string" ? [job] : [...job]
		stars.stage(
			jobs.map((capability) => ({
				capability,
				connectionId: pair.connectionId,
				modelId: pair.model.id
			}))
		)
	}
	/** The jobs a model view's Set as default… press names. */
	function jobsOf(selection: PairDefaultSelection): string[] {
		return selection.kind === "all"
			? selection.capabilities
			: [selection.capability]
	}

	function commitSetDefault(moves: StarMove[]) {
		const named = list
			.find((c) => c.id === moves[0]?.connectionId)
			?.models.find((m) => m.id === moves[0]?.modelId)?.name
		pendingChoice = named
			? {
					sentence: chosenSentence(
						named,
						moves.map((m) => m.capability)
					),
					waiting: new Set(moves.map((m) => m.capability))
				}
			: null
		for (const move of moves)
			socket.emit("connections:setDefault", {
				capability: move.capability,
				id: move.connectionId,
				modelId: move.modelId
			})
		const selected = list.find((c) => c.id === moves[0]?.connectionId)
		if (selected)
			announce(
				`${selected.name} now fills the ${moves
					.map((m) => defaultLoadoutName(m.capability))
					.join(", ")} ${moves.length > 1 ? "loadouts" : "loadout"}`
			)
	}
	function handleSetDefault(msg: DefaultSet) {
		// Patch the local copy so the star moves on this frame rather than
		// when the server's systemSettings:get push lands. Merged per
		// capability, never replaced wholesale.
		settings.capabilityDefaults = {
			...settings.capabilityDefaults,
			[msg.capability]: {
				...(settings.capabilityDefaults?.[msg.capability] ?? {
					connectionId: null,
					samplingConfigId: null
				}),
				connectionId: msg.id ?? null,
				connectionModelId: msg.modelId ?? null
			}
		}
		// Said once per choice, when its last move lands (`chooseJobModel`).
		if (msg.id && pendingChoice?.waiting.delete(msg.capability)) {
			if (!pendingChoice.waiting.size) {
				toaster.success({ title: pendingChoice.sentence })
				pendingChoice = null
			}
		}
		for (const listener of defaultSet) listener(msg)
	}

	/**
	 * The model starred for a capability, resolved off the list — what an
	 * edit's confirmation names as the model it keeps.
	 *
	 * Named rather than counted: "Replaces bge-small" is a sentence a person
	 * can check against what they believe is running, and "Keep bge-small" on
	 * the cancel button is the only wording that makes the safe choice the
	 * obvious one.
	 */
	function currentDefaultModel(capability: string) {
		const def = settings.capabilityDefaults?.[capability]
		if (!def?.connectionId) return null
		const connection = list.find((c) => c.id === def.connectionId)
		const model = connection?.models.find(
			(m) => m.id === def.connectionModelId
		)
		return model ? { model, connection } : null
	}
	/**
	 * Which capabilities each of a connection's models is the default for.
	 *
	 * Keyed by model id for the table, which renders a row at a time and must
	 * not run an O(defaults) scan per row per frame.
	 */
	function defaultsByModel(row: {
		id?: number
		models: readonly { id: number }[]
	}): Record<number, string[]> {
		const defaults = settings.capabilityDefaults ?? {}
		const out: Record<number, string[]> = {}
		if (row.id == null) return out
		for (const model of row.models) {
			const labels = systemCapabilitiesForModel(
				defaults as any,
				row.id,
				model.id
			).map((capability) => {
				try {
					return capabilityLabel(capability as any)
				} catch {
					return capability
				}
			})
			if (labels.length) out[model.id] = labels
		}
		return out
	}
	/**
	 * Use, from a connection's model list (the desk table and the dock list):
	 * chat where the pair can serve it, otherwise the first thing it can.
	 *
	 * ⚠ Named rather than taken from [0]. `satisfiableTransforms` happens to
	 * return TRANSFORMS' declaration order, which puts chat first — but that is
	 * an accident of a table in the SDK, and a Use button that quietly
	 * registered an embedding model as what sessions reply with is not a
	 * thing to leave to one.
	 */
	function useModelOn(
		row: {
			id?: number
			models: readonly {
				id: number
				name: string
				satisfiableCapabilities?: readonly string[] | null
			}[]
		},
		modelId: number
	) {
		if (row.id == null) return
		const m = row.models.find((x) => x.id === modelId)
		if (!m) return
		const serves = m.satisfiableCapabilities ?? []
		const capability = serves.includes("text->text")
			? "text->text"
			: serves[0]
		if (!capability) return
		chooseJobModel(capability, {
			connectionId: row.id,
			model: { id: m.id, name: m.name }
		})
	}
	/**
	 * The chat default with both halves resolved off the list, or `{}` while
	 * chat is unset — what the status card's next step and the Models tab's
	 * **Use in Reply** read. Never the raw registration: one naming a model
	 * missing from this list is unset (§10, _(endpoint, model) pair_).
	 */
	const chatPair = $derived(
		resolvePair(listed, settings.capabilityDefaults?.["text->text"])
	)
	/** A model a person could make the chat default from this list. */
	function servesChat(m: ListModel): boolean {
		return (
			(m.satisfiableCapabilities ?? []).includes("text->text") &&
			m.enabled !== false &&
			!m.missingSince
		)
	}
	/**
	 * Use's word on a Models-tab row: **Use in Reply** while chat is unset
	 * and this model can serve it — the words the status card tells a person
	 * to press — otherwise the plain verb.
	 */
	function useLabelOf(m: ListModel): string {
		return !chatPair.model && servesChat(m) ? "Use in Reply" : "Use"
	}

	// ── Held interests ──────────────────────────────────────────────────────
	let holders = 0
	let releases: Array<() => void> = []
	function declareAll() {
		releases = [
			declareInterest<"connections:list">("connections:list", handleList),
			declareInterest<"connections:list:error">(
				"connections:list:error",
				handleListError
			),
			declareInterest<"connections:modelDownloadProgress">(
				"connections:modelDownloadProgress",
				handleModelLocalState
			),
			declareInterest<"connections:downloadModel">(
				"connections:downloadModel",
				handleModelLocalState
			),
			declareInterest<"connections:cancelModelDownload">(
				"connections:cancelModelDownload",
				handleModelLocalState
			),
			declareInterest<"connections:syncModels">(
				"connections:syncModels",
				handleSyncModels
			),
			declareInterest<"connections:syncModels:error">(
				"connections:syncModels:error",
				handleSyncModelsError
			),
			declareInterest<"connections:setDefault">(
				"connections:setDefault",
				handleSetDefault
			),
			declareInterest<"connections:create">(
				"connections:create",
				handleCreate
			),
			declareInterest<"connections:create:error">(
				"connections:create:error",
				handleCreateError
			)
		]
	}
	/**
	 * Hold the interests; returns the release. The first holder declares
	 * them, the last release lets them go. Idempotent release.
	 */
	function hold(): () => void {
		holders++
		if (holders === 1) declareAll()
		let released = false
		return () => {
			if (released) return
			released = true
			holders--
			if (holders === 0) {
				for (const release of releases) release()
				releases = []
			}
		}
	}

	return {
		hold,
		/** Every connection, sorted by name. */
		get list() {
			return list
		},
		/** The list's rows that carry an id. */
		get listed() {
			return listed
		},
		/** True until the first list reply (or its refusal). */
		get loading() {
			return loading
		},
		/** Connection ids with a sync in flight. */
		get syncingIds(): ReadonlySet<number> {
			return syncingIds
		},
		/** Every connection is being checked (the open-time sweep). */
		get syncingAll() {
			return syncingAll
		},
		/** The chat default, both halves resolved off the list, or `{}`. */
		get chatPair() {
			return chatPair
		},
		/** `EmbeddingSwitchDialog`'s props for a staged choice. */
		get embeddingDialog() {
			return stars.embeddingDialog
		},
		/** `EntitySwitchDialog`'s props for a staged choice. */
		get entityDialog() {
			return stars.entityDialog
		},
		requestList,
		requestSync,
		syncMayForce,
		expectCreate,
		enableManagerHere,
		chooseJobModel,
		jobsOf,
		currentDefaultModel,
		defaultsByModel,
		useModelOn,
		servesChat,
		useLabelOf,
		/** Every create reply, with whether this tab asked for it. */
		onCreated: (listener: (msg: Created, info: CreatedInfo) => void) =>
			listen(created, listener),
		/** Every refused create. */
		onCreateFailed: (listener: (msg: Failed) => void) =>
			listen(createFailed, listener),
		/** Every `connections:setDefault` ack, after the patch. */
		onDefaultSet: (listener: (msg: DefaultSet) => void) =>
			listen(defaultSet, listener),
		/** Every sync result, after the markers clear. */
		onSynced: (listener: (msg: Synced) => void) => listen(synced, listener),
		/** The screen-reader sentences this context says. */
		onAnnounce: (listener: (message: string) => void) =>
			listen(announced, listener)
	}
}

export type ConnectionsCtx = ReturnType<typeof createConnections>
