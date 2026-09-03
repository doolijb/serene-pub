<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import KoboldCppModelKindToggle from "./KoboldCppModelKindToggle.svelte"
	import {
		imageModelStatus,
		isCurrentlyLoaded,
		isListedUnder,
		modelDisplayName,
		modelsDirForKind
	} from "./modelKindView"

	type KoboldCppModel = Sockets.KoboldCPP.ListModels.ModelFile

	interface Props {
		/** Owned by KoboldCppSidebar, not by this tab: switching to Image over
		 * on Available and then opening Models has to land in the image world,
		 * or the app looks like it lost your place. */
		modelKind?: Sockets.KoboldCPP.ModelKindFilter
	}

	let { modelKind = $bindable("text") }: Props = $props()

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)
	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	let currentModel = $state<string | null>(null)
	let availableModels = $state<KoboldCppModel[]>([])
	// Server returns Partial<SelectConnection>[] (see Sockets.Connections.List.Response) —
	// not every field is guaranteed present, so this must stay Partial here too.
	let connectionsList = $state<Partial<SelectConnection>[]>([])
	// What the process is actually holding, per kind. Without it the Image header
	// can only say "you connected something", not whether the model is in memory
	// right now — and since koboldcpp holds one model at a time, most of the time
	// it isn't.
	let loadedConfig =
		$state<Sockets.KoboldCPP.GetLoadedConfig.Response["config"]>(null)
	// Kind-aware, because there are two directories now and the image one falls
	// back to the text one when unset. Asking only about the text column would
	// have the Image tab claim nothing is configured on every install that
	// exists today. See modelsDirForKind.
	let modelsDir = $derived(
		modelsDirForKind(modelKind, koboldCppSettingsCtx.settings)
	)
	let modelsDirSet = $derived(!!modelsDir)
	let isLoading = $state(false)
	let isConnecting = $state(false)
	let connectingModel = $state<string | null>(null)
	/**
	 * WHICH row is in flight, not just that one is.
	 *
	 * A plain boolean put the spinner on every image card at once and disabled
	 * all of them, so clicking the third of four read as though all four were
	 * being applied. The text branch tracks this the same way with
	 * `connectingModel`.
	 */
	let connectingImageModel = $state<string | null>(null)
	let searchQuery = $state("")
	let showDeleteModal = $state(false)
	let modelToDelete = $state<KoboldCppModel | null>(null)
	// Non-null while the "are you sure" for an Unverified file is up.
	let unverifiedImageCandidate = $state<KoboldCppModel | null>(null)

	/**
	 * The image side's answer to `defaultConnectionId`.
	 *
	 * An image model is "in use" when a connection names it AND that connection
	 * holds the `text->image` capability default — the same two facts the text
	 * branch reads, sourced from `connection_defaults` rather than from
	 * `system_settings`. Nothing on the KoboldCPP settings row records this any
	 * more: a connection names exactly ONE model, so the image model is a
	 * connection like any other.
	 *
	 * The type check is load-bearing. That default can perfectly well point at
	 * an A1111 connection this Manager knows nothing about, and every row here
	 * would then wrongly report itself unused — or, worse, one would claim to be
	 * in use because the filenames happened to match.
	 */
	let imageConnectionId = $derived(
		systemSettingsCtx.capabilityDefaults?.["text->image"]?.connectionId ??
			null
	)
	let selectedImageModel = $derived(
		connectionsList.find(
			(c) =>
				c.id === imageConnectionId &&
				c.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
		)?.model ?? null
	)
	let imageStatus = $derived(
		imageModelStatus(selectedImageModel, loadedConfig?.resident.image)
	)
	/**
	 * The image default pointing somewhere else entirely — an AUTOMATIC1111 or
	 * Forge instance, say.
	 *
	 * Worth naming rather than collapsing into "Off": image generation is
	 * working perfectly well in that case, and "Use for image generation" here
	 * would quietly take the slot over. Reported by the header instead, so the
	 * click is an informed one.
	 */
	let otherImageConnection = $derived(
		imageConnectionId
			? connectionsList.find(
					(c) =>
						c.id === imageConnectionId &&
						c.type !== CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
				)
			: undefined
	)

	let filteredModels = $derived(
		availableModels
			.filter(
				(m) =>
					isListedUnder(m.kind, modelKind) &&
					m.name.toLowerCase().includes(searchQuery.toLowerCase())
			)
			.sort((a, b) => {
				// Whichever model the current list is ABOUT floats to the top —
				// the default connection's model in text mode, the image
				// selection in image mode — so the row most likely to be acted
				// on next isn't buried in an alphabetical list of forty files.
				const isTop = (m: KoboldCppModel) =>
					modelKind === "image"
						? selectedImageModel === m.name
						: findConnectionForModel(m.name)?.id ===
							systemSettingsCtx.settings?.defaultConnectionId
				const aTop = isTop(a)
				const bTop = isTop(b)
				if (aTop && !bTop) return -1
				if (!aTop && bTop) return 1
				return a.name.localeCompare(b.name)
			})
	)

	function refresh() {
		isLoading = true
		socket.emit("koboldcpp:listModels", {})
		socket.emit("connections:list", {})
		// Cheap, and the only source for what is resident. Asked for
		// unconditionally rather than only in image mode: the answer is what
		// decides whether the Image header says "Loaded" or "loads on demand",
		// and asking for it only after the user switches would leave that
		// header blank for a round trip on every switch.
		socket.emit("koboldcpp:getLoadedConfig", {})
		// The `text->image` default lives in connection_defaults and reaches the
		// client only on systemSettings:get, which Layout owns. Without asking
		// for it, connecting an image model would leave every row still reading
		// "Use for image generation" until something unrelated refreshed the
		// settings — which reads as the click having done nothing.
		socket.emit("systemSettings:get", {})
	}

	function handleConnectModel(modelName: string) {
		connectingModel = modelName
		isConnecting = true
		socket.emit("koboldcpp:connectModel", { modelName })
	}

	function findConnectionForModel(
		modelName: string
	): Partial<SelectConnection> | undefined {
		return connectionsList.find(
			(c) =>
				c.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED &&
				c.model === modelName
		)
	}

	// Its own type, not a variant of the text one: a connection names exactly
	// one model, and an image model is never named by a text connection.
	function findImageConnectionForModel(
		modelName: string
	): Partial<SelectConnection> | undefined {
		return connectionsList.find(
			(c) =>
				c.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE &&
				c.model === modelName
		)
	}

	function openConnectionSidebar(
		conn: Partial<SelectConnection> | undefined
	) {
		if (!conn?.id) return
		panelsCtx.digest.connectionId = conn.id
		panelsCtx.openPanel({ key: "connections" })
	}

	function connectImageModel(filename: string) {
		connectingImageModel = filename
		socket.emit("koboldcpp:connectImageModel", { filename })
	}

	function handleUseForImages(model: KoboldCppModel) {
		// An Unverified file is still worth a confirm, but a much smaller one
		// than it used to be: an image connection carries its own .kcpps, so a
		// file KoboldCPP can't load costs the picture and nothing else — the
		// conversation is a different connection naming a different model.
		if (model.kind === "unknown") {
			unverifiedImageCandidate = model
			return
		}
		connectImageModel(model.name)
	}

	function handleUnverifiedConfirm() {
		const model = unverifiedImageCandidate
		unverifiedImageCandidate = null
		if (model) connectImageModel(model.name)
	}

	function handleSetModelKind(
		model: KoboldCppModel,
		kind: Sockets.KoboldCPP.ModelKindFilter
	) {
		socket.emit("koboldcpp:setModelKind", {
			filename: model.name,
			kind
		})
	}

	function handleDeleteClick(model: KoboldCppModel) {
		const defaultConnId = systemSettingsCtx.settings?.defaultConnectionId
		const conn = findConnectionForModel(model.name)
		if (conn && conn.id === defaultConnId) {
			toaster.error({
				title: "Cannot delete default model",
				description:
					"Set a different default connection before deleting."
			})
			return
		}
		modelToDelete = model
		showDeleteModal = true
	}

	function handleDeleteConfirm() {
		if (modelToDelete) {
			socket.emit("koboldcpp:deleteModel", {
				modelName: modelToDelete.name
			})
		}
		showDeleteModal = false
		modelToDelete = null
	}

	function handleDeleteCancel() {
		showDeleteModal = false
		modelToDelete = null
	}

	function formatSize(bytes: number): string {
		const units = ["B", "KB", "MB", "GB", "TB"]
		let size = bytes
		let i = 0
		while (size >= 1024 && i < units.length - 1) {
			size /= 1024
			i++
		}
		return `${size.toFixed(1)} ${units[i]}`
	}

	// Named so the teardown below removes only this listener. A bare
	// socket.off("koboldcpp:listModels") drops every handler for the event,
	// including KoboldCppSidebar's, which reads the same list to decide whether
	// to open on Available during the setup wizard.
	function handleListModels(message: Sockets.KoboldCPP.ListModels.Response) {
		isLoading = false
		currentModel = message.currentModel
		availableModels = message.availableModels ?? []
	}

	// Named for the same reason: KoboldCppPerfTab listens to this event too and
	// tears down with a bare off().
	function handleGetLoadedConfig(
		message: Sockets.KoboldCPP.GetLoadedConfig.Response
	) {
		loadedConfig = message.config
	}

	// Every listener below is named and torn down by reference for the same
	// reason: socket.off("event") with no handler removes the FIRST-registered
	// listener for that event, which is usually Layout's or another panel's,
	// not this component's.
	function handleConnectionsList(msg: Sockets.Connections.List.Response) {
		connectionsList = msg.connectionsList ?? []
		// Only now — not on the bare connectModel ack — does isDefault/
		// existingConn below actually reflect the new default, since both
		// derive from this list. Clearing the spinner earlier left a window
		// where the button looked interactive/unchanged (spinner gone, but
		// still reading "Set Default") right up until this refresh landed,
		// which read as "did clicking it even do anything?" in practice.
		isConnecting = false
		connectingModel = null
		connectingImageModel = null
	}

	function handleConnectModelAck() {
		toaster.success({ title: "Model set as default" })
		refresh()
	}

	function handleConnectModelError(message: Sockets.ErrorResponse) {
		isConnecting = false
		connectingModel = null
		toaster.error({
			title: "Failed to set default model",
			description: message.error
		})
	}

	function handleConnectImageModel(
		message: Sockets.KoboldCPP.ConnectImageModel.Response
	) {
		if (message.error) {
			connectingImageModel = null
			toaster.error({
				title: "Couldn't use that model for images",
				description: message.error
			})
			return
		}
		toaster.success({ title: "Image model connected" })
		// The connection and the text->image default both arrive via refresh —
		// the ack itself carries no state to read.
		refresh()
	}

	function handleConnectImageModelError(message: Sockets.ErrorResponse) {
		connectingImageModel = null
		toaster.error({
			title: "Couldn't use that model for images",
			description: message.error
		})
	}

	// No matching :error handler — there is no koboldcpp:setModelKind:error key
	// in the socket map, so a server-side failure surfaces as the row simply
	// not changing after the refresh.
	function handleSetModelKindAck(
		message: Sockets.KoboldCPP.SetModelKind.Response
	) {
		if (message.success) refresh()
	}

	function handleDeleteModel() {
		toaster.success({ title: "Model deleted" })
		refresh()
	}

	function handleDeleteModelError(message: Sockets.ErrorResponse) {
		toaster.error({
			title: "Failed to delete model",
			description: message.error
		})
	}

	onMount(() => {
		socket.on("koboldcpp:listModels", handleListModels)
		socket.on("koboldcpp:getLoadedConfig", handleGetLoadedConfig)
		socket.on("connections:list", handleConnectionsList)
		socket.on("koboldcpp:connectModel", handleConnectModelAck)
		socket.on("koboldcpp:connectModel:error", handleConnectModelError)
		socket.on("koboldcpp:connectImageModel", handleConnectImageModel)
		socket.on(
			"koboldcpp:connectImageModel:error",
			handleConnectImageModelError
		)
		socket.on("koboldcpp:setModelKind", handleSetModelKindAck)
		socket.on("koboldcpp:deleteModel", handleDeleteModel)
		socket.on("koboldcpp:deleteModel:error", handleDeleteModelError)

		refresh()
	})

	onDestroy(() => {
		socket.off("koboldcpp:listModels", handleListModels)
		socket.off("koboldcpp:getLoadedConfig", handleGetLoadedConfig)
		socket.off("connections:list", handleConnectionsList)
		socket.off("koboldcpp:connectModel", handleConnectModelAck)
		socket.off("koboldcpp:connectModel:error", handleConnectModelError)
		socket.off("koboldcpp:connectImageModel", handleConnectImageModel)
		socket.off(
			"koboldcpp:connectImageModel:error",
			handleConnectImageModelError
		)
		socket.off("koboldcpp:setModelKind", handleSetModelKindAck)
		socket.off("koboldcpp:deleteModel", handleDeleteModel)
		socket.off("koboldcpp:deleteModel:error", handleDeleteModelError)
	})
</script>

<!-- Which half of the models directory this tab is about. Above the filter box
     rather than beside it: it changes what the box is searching, so reading it
     second would be reading it backwards. -->
<div class="pt-2">
	<KoboldCppModelKindToggle bind:kind={modelKind} />
</div>

<!-- Search -->
<div class="py-2">
	<div class="flex gap-2">
		<div class="relative flex-1">
			<Icons.Search
				class="text-surface-700-300 absolute top-1/2 left-3 -translate-y-1/2"
				size={16}
			/>
			<input
				type="text"
				placeholder={modelKind === "image"
					? "Search image models..."
					: "Search models..."}
				class="input w-full pl-10"
				bind:value={searchQuery}
			/>
		</div>
		<button
			class="btn preset-filled-surface-500"
			onclick={refresh}
			title="Refresh"
		>
			<Icons.RefreshCw
				size={16}
				class={isLoading ? "animate-spin" : ""}
			/>
		</button>
	</div>
</div>

{#if modelKind === "image" && modelsDirSet}
	<!-- Three states, not a checkmark. A connection NAMES a model; whether that
	     model is in memory right now is the model manager's business, and today
	     it holds one model at a time — so "connected, but the process is holding
	     the chat model" is the ordinary resting state of a working setup, not a
	     fault. A two-state control would report a problem every time the user
	     has been chatting. -->
	<div
		class="card preset-filled-surface-100-900 mb-1 flex flex-col gap-2 p-3"
	>
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<Icons.ImagePlus size={16} />
				<span class="text-sm font-semibold">Image generation</span>
			</div>
			{#if imageStatus === "off" && otherImageConnection}
				<span
					class="badge preset-filled-surface-500 rounded-full px-2 py-0.5 text-xs font-medium"
					role="status"
				>
					Another connection
				</span>
			{:else if imageStatus === "off"}
				<span
					class="badge preset-filled-surface-500 rounded-full px-2 py-0.5 text-xs font-medium"
					role="status"
				>
					Off
				</span>
			{:else if imageStatus === "pending"}
				<span
					class="badge preset-filled-warning-500 rounded-full px-2 py-0.5 text-xs font-medium"
					role="status"
				>
					Loads on demand
				</span>
			{:else}
				<span
					class="badge preset-filled-success-500 rounded-full px-2 py-0.5 text-xs font-medium"
					role="status"
				>
					Loaded now
				</span>
			{/if}
		</div>
		{#if imageStatus === "off" && otherImageConnection}
			<p class="text-xs opacity-75">
				Image generation currently runs through a different connection,
				"{otherImageConnection.name}". Picking a model below points it
				at KoboldCPP instead.
			</p>
		{:else if imageStatus === "off"}
			<p class="text-xs opacity-75">
				No image model connected. Pick one below — it gets its own
				KoboldCPP Manager connection, the same way a text model does.
			</p>
		{:else}
			<p class="text-xs opacity-75">
				Connected:
				<span class="font-mono">
					{modelDisplayName(selectedImageModel ?? "")}
				</span>
			</p>
			{#if imageStatus === "pending"}
				<p class="text-warning-700-300 text-xs">
					KoboldCPP holds one model at a time, so this one loads when
					you ask for a picture — swapping the chat model out while it
					does, and back again for the next message. On a large model
					that's minutes each way, not an instant switch.
				</p>
			{/if}
			<div>
				<button
					class="btn btn-sm preset-filled-surface-500"
					onclick={() =>
						openConnectionSidebar(
							findImageConnectionForModel(
								selectedImageModel ?? ""
							)
						)}
					title="Open this image connection's settings"
				>
					<Icons.Settings size={14} />
					Edit connection
				</button>
			</div>
		{/if}
	</div>
{/if}

{#if isLoading}
	<div class="p-6 text-center">
		<Icons.Loader2 class="mx-auto mb-4 animate-spin" size={32} />
		<p class="text-sm opacity-75">Loading models...</p>
	</div>
{:else if !modelsDirSet}
	<div class="p-6 text-center">
		<Icons.FolderOpen class="text-surface-700-300 mx-auto mb-4" size={48} />
		<h3 class="h4 mb-2">No models directory configured</h3>
		<!-- Named per kind, because there are two fields now. The image list only
		     reaches this state when NEITHER is set: an unset Image Models
		     Directory falls back to the Models Directory. -->
		<p class="text-sm opacity-75">
			{#if modelKind === "image"}
				Set a Models Directory in the Settings tab — or an Image Models
				Directory, if you'd rather keep image models out of your LLM
				folder.
			{:else}
				Set a Models Directory in the Settings tab.
			{/if}
		</p>
	</div>
{:else if filteredModels.length === 0}
	<div class="p-6 text-center">
		<Icons.Package class="text-surface-700-300 mx-auto mb-4" size={48} />
		<h3 class="h4 mb-2">
			{modelKind === "image"
				? "No image models found"
				: "No models found"}
		</h3>
		<p class="mb-4 text-sm opacity-75">
			{#if searchQuery}
				No models match your search.
			{:else if modelKind === "image"}
				<!-- The folder is named rather than implied: with two directories
				     configured, "your models folder" is genuinely ambiguous and a
				     file dropped in the wrong one never appears here. -->
				Download one from the Available tab, or drop a Stable Diffusion .safetensors
				or .gguf into this folder:
				<span class="font-mono break-all">{modelsDir}</span>
			{:else}
				Download models from the Available tab.
			{/if}
		</p>
	</div>
{:else}
	<div class="space-y-3 py-4">
		{#each filteredModels as model}
			{@const loaded = isCurrentlyLoaded(currentModel, model.name)}
			{@const isDefault =
				findConnectionForModel(model.name)?.id ===
				systemSettingsCtx.settings?.defaultConnectionId}
			{@const existingConn = findConnectionForModel(model.name)}
			{@const existingImageConn = findImageConnectionForModel(model.name)}
			{@const inUseForImages = selectedImageModel === model.name}
			<div
				class="card preset-filled-surface-100-900 flex flex-col gap-2 p-4"
			>
				<div class="flex items-center justify-between gap-2">
					<h4 class="font-semibold">
						{#if modelKind === "image" ? inUseForImages : isDefault}
							<Icons.Check
								size={14}
								class="text-success-500 inline-block"
							/>
						{/if}
						{modelDisplayName(model.name)}
					</h4>
					{#if model.kind === "unknown"}
						<span
							class="badge preset-filled-warning-500 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
							title={model.kindReason ??
								"Serene Pub couldn't read this file well enough to tell what it is."}
						>
							Unverified
						</span>
					{/if}
				</div>
				{#if model.kind === "unknown"}
					<!-- Load-bearing, not decorative: the architecture
					     allowlists behind the classifier WILL go stale, and
					     when they do this is the only way a correct file stops
					     being listed as suspect in both places. -->
					<div
						class="border-warning-500/50 bg-warning-500/10 flex flex-col gap-2 rounded border p-2"
					>
						<p class="text-warning-700-300 text-xs">
							{model.kindReason ??
								"Serene Pub couldn't tell whether this is a text or an image model."}
							It's listed under both Text and Image until you say which.
						</p>
						<div class="flex flex-wrap gap-2">
							<button
								class="btn btn-sm preset-filled-surface-500"
								onclick={() =>
									handleSetModelKind(model, "text")}
							>
								It's a text model
							</button>
							<button
								class="btn btn-sm preset-filled-surface-500"
								onclick={() =>
									handleSetModelKind(model, "image")}
							>
								It's an image model
							</button>
						</div>
					</div>
				{/if}
				{#if loaded && modelKind === "text"}
					<div class="text-surface-600 space-y-1 text-sm">
						<div class="flex justify-between">
							<span>Status:</span>
							<span
								class="preset-filled-success-500 rounded-xl px-2 py-1"
								role="status"
							>
								Loaded
							</span>
						</div>
					</div>
				{/if}
				<div class="panel-actions justify-between">
					<div class="flex gap-2">
						{#if modelKind === "image"}
							<button
								class="btn btn-sm preset-filled-success-500"
								onclick={() => handleUseForImages(model)}
								disabled={inUseForImages ||
									connectingImageModel === model.name}
								title={inUseForImages
									? "Already the connection image generation uses"
									: "Use this model for image generation"}
							>
								{#if connectingImageModel === model.name}
									<Icons.Loader2
										size={14}
										class="animate-spin"
									/>
								{:else}
									<Icons.ImagePlus size={14} />
								{/if}
								{inUseForImages
									? "In use"
									: "Use for image generation"}
							</button>
							{#if existingImageConn}
								<button
									class="btn btn-sm preset-filled-surface-500"
									onclick={() =>
										openConnectionSidebar(
											existingImageConn
										)}
									title="Open connection settings"
								>
									<Icons.Settings size={14} /> Edit
								</button>
							{/if}
						{:else}
							<button
								class="btn btn-sm preset-filled-success-500"
								onclick={() => handleConnectModel(model.name)}
								disabled={isDefault ||
									(isConnecting &&
										connectingModel === model.name)}
								title={isDefault
									? "Already the default connection"
									: "Set as default connection"}
							>
								{#if isConnecting && connectingModel === model.name}
									<Icons.Loader2
										size={14}
										class="animate-spin"
									/>
								{:else}
									<Icons.Star
										size={14}
										fill={isDefault
											? "currentColor"
											: "none"}
									/>
								{/if}
								{isDefault ? "Default" : "Set Default"}
							</button>
							{#if existingConn}
								<button
									class="btn btn-sm preset-filled-surface-500"
									onclick={() =>
										openConnectionSidebar(existingConn)}
									title="Open connection settings"
								>
									<Icons.Settings size={14} /> Edit
								</button>
							{/if}
						{/if}
					</div>
					<button
						class="btn btn-sm preset-filled-error-500"
						onclick={() => handleDeleteClick(model)}
						title="Delete model"
					>
						<Icons.Trash2 size={14} /> Delete
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
			>
				<header class="flex justify-between">
					<h2 class="h2">Delete Model</h2>
				</header>
				<article>
					<p class="opacity-60">
						Are you sure you want to delete "{modelToDelete?.name}"
						from your models directory? This action cannot be
						undone.
					</p>
					<p class="mt-2 opacity-60">
						Any associated connections to this model will also be
						removed.
					</p>
				</article>
				<footer class="flex justify-end gap-2">
					<button
						class="btn preset-filled-surface-500"
						onclick={handleDeleteCancel}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={handleDeleteConfirm}
					>
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<Dialog
	open={!!unverifiedImageCandidate}
	onOpenChange={(e) => {
		if (!e.open) unverifiedImageCandidate = null
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
			>
				<header class="flex justify-between">
					<h2 class="h2">Use an unverified file?</h2>
				</header>
				<article>
					<p class="opacity-60">
						Serene Pub couldn't confirm that "{unverifiedImageCandidate?.name}"
						is an image model.
					</p>
					<p class="mt-2 opacity-60">
						If it isn't one KoboldCPP can load, the load fails when
						you next ask for a picture and you get an error naming
						this file. Your conversations are unaffected — they run
						on a different connection and a different model.
					</p>
				</article>
				<footer class="flex justify-end gap-2">
					<button
						class="btn preset-filled-surface-500"
						onclick={() => (unverifiedImageCandidate = null)}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-warning-500"
						onclick={handleUnverifiedConfirm}
					>
						Use anyway
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
