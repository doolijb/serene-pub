<script lang="ts">
	/**
	 * The Models view (rail key `models`, plan 2026-10-11 — the Models /
	 * Connections split): "make my sessions work".
	 *
	 * The list column is `ModelsListView` — every model of every connection
	 * flat, the background remover, the downloads tray — and the
	 * detail is one model's own view (`ModelDetailView`, or `OnnxModelView`
	 * for a local ONNX file). `PanelSplit` lays them out: at desk with
	 * nothing open the list takes the whole view (`listFills`), centred at
	 * the list's own 560px (L7, 2026-10-24; it was the 1120px reading
	 * width, a model card's two lines stretched across it), opening a
	 * model splits it 340px + detail; compact shows one at a time.
	 *
	 * Inventory only (DESIGN-image-generation §14, 2026-10-12): the status
	 * strip, the jobs grid, the job's sheet and the defaults ledger are the
	 * Loadouts view's. A model's Use here is *Use in…* (`UseInMenu`), the
	 * loadouts of the jobs it can do from `loadouts:list`, default first:
	 * the default goes through `chooseJobModel` (its costed confirmation),
	 * any other loadout is filled with `loadouts:update`.
	 *
	 * Mounted here, never places: Get a model (`ModelFinderView` in a
	 * dialog), Set up chat (`SetupChatFlow`) and Add a model by name. Where a connection itself is the subject — a
	 * runtime to manage, a connection to add — the press opens the
	 * Connections view (`digest.connectionId`), which owns connections.
	 *
	 * The list, model sync and the one way to choose live in the connections
	 * context (`contexts/connections.svelte.ts`), held while this view is
	 * mounted. No draft is ever held here, so no close gate is registered.
	 */
	import { getContext, onDestroy, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useConnections } from "$lib/client/contexts/connections.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import ModelsListView from "$lib/client/components/connections/ModelsListView.svelte"
	import ModelDetailView from "$lib/client/components/connections/ModelDetailView.svelte"
	import OnnxModelView from "$lib/client/components/connections/OnnxModelView.svelte"
	import UseInMenu from "$lib/client/components/connections/UseInMenu.svelte"
	import {
		useInGroups,
		useInSentence,
		type UseInItem
	} from "$lib/client/components/connections/useInMenu"
	import { openInLoadouts } from "$lib/client/admin/railDoors"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import type { ConnectionModelRow } from "$lib/client/components/connections/useConnectionModels.svelte"
	import ModelFinderView from "$lib/client/components/connections/ModelFinderView.svelte"
	import SetupChatFlow from "$lib/client/components/connections/SetupChatFlow.svelte"
	import AddModelByNameDialog from "$lib/client/components/connections/AddModelByNameDialog.svelte"
	import {
		isLocalOnnxType,
		manualAddAllowed,
		type ModelManager
	} from "$lib/client/components/connections/modelManagement"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import type { Snippet } from "svelte"

	interface Props {
		/** Bound by the shell; this view holds no draft and sets none. */
		onclose?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable() }: Props = $props()

	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")
	const userCtx: { user?: SelectUser } | undefined = getContext("userCtx")
	const socket = useTypedSocket()

	/** Held ABOVE the effects that ask for the list. */
	const conns = useConnections()
	const isLoading = $derived(conns.loading)
	const capabilityDefaults = $derived(
		systemSettingsCtx?.capabilityDefaults ?? {}
	)

	const vm = new ViewModeTracker()

	// ── The selection (the detail pane) ─────────────────────────────────────
	let selected = $state<{ connectionId: number; modelId: number } | null>(
		null
	)
	const selectedRow = $derived(
		selected
			? (conns.list.find((c) => c.id === selected!.connectionId) ?? null)
			: null
	)
	function openModel(connectionId: number, modelId: number) {
		selected = { connectionId, modelId }
		conns.requestSync(connectionId)
		announce("Model details opened")
	}
	function closeModel() {
		selected = null
	}

	// ── Use in… (the loadouts a model can be put in) ────────────────────────
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)
	let loadoutsList = $state<Sockets.Loadouts.List.Response | null>(null)
	/** The `loadouts:update` this tab sent, and what to say when it lands. */
	let pendingUseIn: { id: number; sentence: string } | null = null

	function requestLoadouts() {
		socket.emit("loadouts:list", {})
	}
	$effect(() => {
		if (!isAdmin) return
		const releases = [
			declareInterest<"loadouts:list">(
				"loadouts:list",
				(res) => (loadoutsList = res)
			),
			declareInterest<"loadouts:update">("loadouts:update", (res) => {
				if (pendingUseIn?.id !== res.loadout?.id) return
				const said = pendingUseIn.sentence
				pendingUseIn = null
				announce(res.notice ? `${said}. ${res.notice}` : said)
			}),
			declareInterest<"loadouts:update:error">(
				"loadouts:update:error",
				(res) => {
					if (!pendingUseIn) return
					pendingUseIn = null
					announce(res.error)
				}
			)
		]
		requestLoadouts()
		return () => releases.forEach((release) => release())
	})
	// A default moved (`connections:setDefault`): the default loadouts with it.
	$effect(() => conns.onDefaultSet(() => isAdmin && requestLoadouts()))

	/** A model's *Use in…* groups, or null before the list arrives. */
	function groupsOf(
		connectionId: number,
		model: { id: number; satisfiableCapabilities?: readonly string[] | null }
	) {
		if (!loadoutsList) return null
		return useInGroups(
			{
				connectionId,
				modelId: model.id,
				capabilities: model.satisfiableCapabilities ?? []
			},
			loadoutsList.loadouts,
			loadoutsList.transforms
		)
	}
	/**
	 * A *Use in…* pick. The default loadout is the job's default: it goes
	 * through `chooseJobModel`, which asks first where the switch costs. Any
	 * other loadout has its pair filled.
	 */
	function useIn(
		connectionId: number,
		model: { id: number; name: string },
		item: UseInItem
	) {
		if (item.isDefault) {
			conns.chooseJobModel(item.transform, {
				connectionId,
				model: { id: model.id, name: model.name }
			})
			return
		}
		pendingUseIn = {
			id: item.id,
			sentence: useInSentence(model.name, item.name)
		}
		socket.emit("loadouts:update", {
			id: item.id,
			connectionId,
			connectionModelId: model.id
		})
	}
	function openLoadouts(loadoutId?: number) {
		openInLoadouts(panelsCtx, loadoutId != null ? { loadoutId } : {})
	}

	// ── The dialogs (never places) ──────────────────────────────────────────
	/** The Get a model dialog, and what it is scoped to. */
	let finderOpen = $state(false)
	let finderScope = $state<{ capability?: string; connectionId?: number }>({})
	/** The Set up chat stepper. */
	let setupChatOpen = $state(false)
	let addByNameOpen = $state(false)
	const addByNameTargets = $derived(
		conns.listed.filter((c) => manualAddAllowed(c.type))
	)

	/** The Get a model dialog, optionally scoped to a job. */
	function openFinder(
		opts: { capability?: string; connectionId?: number } = {}
	) {
		finderScope = { ...opts }
		finderOpen = true
	}
	/** The Set up chat stepper (U5); its step is derived from the facts. */
	function openSetupChat() {
		finderOpen = false
		setupChatOpen = true
	}

	// ── Out to other views ──────────────────────────────────────────────────
	/** The Connections view, on one connection when one is named. */
	function openConnections(connectionId?: number) {
		if (!panelsCtx) return
		if (connectionId != null) panelsCtx.digest.connectionId = connectionId
		panelsCtx.openPanel({ key: "connections", toggle: false })
	}
	/** A model's "Open KoboldCPP" / "Open Ollama": its runtime's connection. */
	function openManager(manager: ModelManager) {
		const type =
			manager.panel === "koboldcpp"
				? CONNECTION_TYPE.KOBOLDCPP_MANAGED
				: CONNECTION_TYPE.OLLAMA
		const row =
			(selectedRow?.type === type ? selectedRow : null) ??
			conns.listed.find((c) => c.type === type)
		openConnections(row?.id)
	}
	function openSessions() {
		panelsCtx?.openPanel({ key: "sessions", toggle: false })
	}

	function addModelByName(connectionId: number, model: string, name: string) {
		socket.emit("connections:createModel", {
			id: connectionId,
			model: {
				model: model.trim(),
				...(name.trim() ? { name: name.trim() } : {})
			}
		})
	}

	// ── Screen-reader announcements ─────────────────────────────────────────
	let announcements = $state("")
	function announce(message: string) {
		announcements = message
		setTimeout(() => (announcements = ""), 1000)
	}
	// The context's own sentences (a choice, a create) are said here too.
	$effect(() => conns.onAnnounce(announce))

	/**
	 * A create this tab asked for: Set up chat's runtime, the finder's "add
	 * KoboldCPP". The view stays put — the stepper's Runtime step IS the
	 * setup — and the new connection's models are asked for (forced only
	 * where the listing can answer; `syncMayForce`).
	 */
	$effect(() =>
		conns.onCreated((msg, { mine }) => {
			if (!msg.connection?.id || !mine) return
			conns.requestSync(
				msg.connection.id,
				setupChatOpen ? false : conns.syncMayForce(msg.connection)
			)
		})
	)

	onMount(() => {
		conns.requestList()
		// The open-time sweep: every endpoint whose listing is stale is
		// re-asked. Fresh ones are skipped server-side.
		conns.requestSync()
	})

	/**
	 * The doors named from outside, consumed once each (the digest is one
	 * shared slot): `connectionsDoor` `"chat"` forwards
	 * to the Loadouts view, which owns the sheet now; `"setup-chat"` opens
	 * the stepper here.
	 * The other two doors (`service`, `local`) are the Connections view's
	 * and are left for it. Effects, so a press lands whether this view was
	 * already open or not.
	 */
	$effect(() => {
		const door = panelsCtx?.digest.connectionsDoor
		if (door !== "chat" && door !== "setup-chat") return
		untrack(() => {
			panelsCtx!.digest.connectionsDoor = undefined
			if (door === "setup-chat") openSetupChat()
			else openInLoadouts(panelsCtx, { job: "text->text" })
		})
	})
	// `connectionsJob` is the Loadouts view's door now (`LoadoutsSidebar`
	// consumes it). Not forwarded from here: re-setting it from an effect that
	// reads it would loop while this view is mounted.

	onDestroy(() => {
		onclose = undefined
	})
</script>

<div class="flex h-full min-h-0 flex-col" use:vm.observe>
	<div aria-live="polite" aria-atomic="true" class="sr-only">
		{announcements}
	</div>
	<ModelsListView
		frame={listFrame}
		{selected}
		onOpenModel={openModel}
		onSetUpChat={openSetupChat}
		onGetModel={(opts) => openFinder(opts ?? {})}
		onAddByName={() => (addByNameOpen = true)}
		onOpenConnections={() => openConnections()}
		onOpenLoadouts={isAdmin ? openLoadouts : undefined}
		useInGroupsOf={(entry) => groupsOf(entry.connectionId, entry.model)}
		onUseIn={(entry, item) =>
			useIn(entry.connectionId, entry.model, item)}
	/>
</div>

<!-- The list hands its toolbar and body back, so the toolbar is pinned over
     the list's one scroller while the filter, the live statuses and the Jump
     scope stay in the one `ModelsListView`. -->
{#snippet listFrame(toolbar: Snippet, list: Snippet)}
	<PanelSplit
		mode={vm.mode}
		hasDetail={selected != null}
		listFills
		fillWidth="list"
		listWidth="340px"
		{toolbar}
		{list}
		detail={detailPane}
	/>
{/snippet}

{#snippet detailPane()}
	{#if selected}
		{@const connectionId = selected.connectionId}
		{@const onnxModel = selectedRow?.models.find(
			(m) => m.id === selected!.modelId
		)}
		<!-- A local ONNX model is a FILE on this machine and a lane that may
		     be holding it, so it gets its own view (as in Connections). -->
		{#if selectedRow && onnxModel && isLocalOnnxType(selectedRow.type)}
			<OnnxModelView
				connection={selectedRow}
				model={onnxModel}
				{capabilityDefaults}
				mode={vm.mode}
				isAdmin={userCtx?.user?.isAdmin ?? false}
				onBack={closeModel}
				onSelectDefault={(model, selection) =>
					conns.chooseJobModel(conns.jobsOf(selection), {
						connectionId,
						model
					})}
			/>
		{:else}
			{#key `${connectionId}:${selected.modelId}`}
				<ModelDetailView
					{connectionId}
					connectionName={selectedRow?.name ?? "Connection"}
					modelId={selected.modelId}
					{capabilityDefaults}
					syncing={conns.syncingAll ||
						conns.syncingIds.has(connectionId)}
					onBack={closeModel}
					onSelectDefault={(model, selection) =>
						conns.chooseJobModel(conns.jobsOf(selection), {
							connectionId,
							model
						})}
					onRefresh={() => conns.requestSync(connectionId, true)}
					onOpenManager={openManager}
					onRemoved={() => {
						announce("Model removed")
						closeModel()
					}}
					useIn={loadoutsList ? detailUseIn : undefined}
				/>
			{/key}
		{/if}
	{/if}
{/snippet}

<!-- The model detail's *Use in…*, in place of Set as default…. -->
{#snippet detailUseIn(row: ConnectionModelRow)}
	{@const connectionId = selected?.connectionId ?? 0}
	{@const off = row.missingSince
		? "The host no longer lists this model"
		: row.enabled === false
			? "Switch the model on first"
			: null}
	<UseInMenu
		variant="block"
		groups={groupsOf(connectionId, row) ?? []}
		modelName={row.name}
		disabled={!!off}
		disabledReason={off}
		onPick={(item) => useIn(connectionId, row, item)}
		onOpenLoadouts={openLoadouts}
	/>
{/snippet}

<!-- Get a model: the one finder (R3), as a dialog from the toolbar. Getting a model closes nothing; the tray shows it. -->
<Dialog open={finderOpen} onOpenChange={(e) => (finderOpen = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 flex h-[min(90vh,760px)] w-full max-w-2xl flex-col gap-3 p-6 shadow-xl"
			>
				{#if finderOpen}
					<header class="flex shrink-0 items-center gap-2">
						<Dialog.Title
							class="min-w-0 flex-1 [font-family:var(--typo-heading--font-family)] text-lg font-semibold"
						>
							Get a model
						</Dialog.Title>
						<Dialog.CloseTrigger
							class="btn-icon btn-icon-sm hover:preset-tonal shrink-0"
							aria-label="Close"
						>
							<Icons.X size={16} aria-hidden="true" />
						</Dialog.CloseTrigger>
					</header>
					<div class="flex min-h-0 flex-1 flex-col">
						<ModelFinderView
							capability={finderScope.capability}
							connectionId={finderScope.connectionId}
							onOpenConnection={(id) => {
								finderOpen = false
								openConnections(id)
							}}
						/>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
<!-- Set up chat: Runtime → Model → Done, as a stepper over the list. It
     waits for the list, so its Runtime step never creates a KoboldCPP the
     list was about to name. -->
<SetupChatFlow
	open={setupChatOpen && !isLoading}
	connections={conns.list}
	onEnsureRuntime={() => {
		conns.enableManagerHere("koboldcpp")
	}}
	onChooseJobModel={conns.chooseJobModel}
	onOpenConnection={(id) => {
		setupChatOpen = false
		openConnections(id)
	}}
	onClose={() => (setupChatOpen = false)}
	onOpenSessions={() => {
		setupChatOpen = false
		openSessions()
	}}
/>
<AddModelByNameDialog
	bind:open={addByNameOpen}
	targets={addByNameTargets}
	onAdd={addModelByName}
/>
