<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

	type KoboldCppModel = Sockets.KoboldCPP.ListModels.ModelFile

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
	let modelsDirSet = $derived(
		!!koboldCppSettingsCtx.settings?.koboldCppManagerModelsDir
	)
	let isLoading = $state(false)
	let isConnecting = $state(false)
	let connectingModel = $state<string | null>(null)
	let searchQuery = $state("")
	let showDeleteModal = $state(false)
	let modelToDelete = $state<KoboldCppModel | null>(null)

	let filteredModels = $derived(
		availableModels
			.filter((m) =>
				m.name.toLowerCase().includes(searchQuery.toLowerCase())
			)
			.sort((a, b) => {
				const aDefault =
					findConnectionForModel(a.name)?.id ===
					systemSettingsCtx.settings?.defaultConnectionId
				const bDefault =
					findConnectionForModel(b.name)?.id ===
					systemSettingsCtx.settings?.defaultConnectionId
				if (aDefault && !bDefault) return -1
				if (!aDefault && bDefault) return 1
				return a.name.localeCompare(b.name)
			})
	)

	function refresh() {
		isLoading = true
		socket.emit("koboldcpp:listModels", {})
		socket.emit("connections:list", {})
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

	function openConnectionSidebar(modelName: string) {
		const conn = findConnectionForModel(modelName)
		if (!conn) return
		panelsCtx.digest.connectionId = conn.id
		panelsCtx.openPanel({ key: "connections" })
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

	function modelDisplayName(filename: string): string {
		return filename.replace(/\.gguf$/i, "")
	}

	function isCurrentlyLoaded(filename: string): boolean {
		if (!currentModel) return false
		return currentModel
			.toLowerCase()
			.includes(filename.replace(/\.gguf$/i, "").toLowerCase())
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

	onMount(() => {
		socket.on("koboldcpp:listModels", handleListModels)

		socket.on(
			"connections:list",
			(msg: Sockets.Connections.List.Response) => {
				connectionsList = msg.connectionsList ?? []
				// Only now — not on the bare connectModel ack — does isDefault/
				// existingConn below actually reflect the new default, since both
				// derive from this list. Clearing the spinner earlier left a
				// window where the button looked interactive/unchanged (spinner
				// gone, but still reading "Set Default") right up until this
				// refresh landed, which read as "did clicking it even do
				// anything?" in practice.
				isConnecting = false
				connectingModel = null
			}
		)

		socket.on("koboldcpp:connectModel", () => {
			toaster.success({ title: "Model set as default" })
			refresh()
		})

		socket.on(
			"koboldcpp:connectModel:error",
			(message: Sockets.ErrorResponse) => {
				isConnecting = false
				connectingModel = null
				toaster.error({
					title: "Failed to set default model",
					description: message.error
				})
			}
		)

		socket.on("koboldcpp:deleteModel", () => {
			toaster.success({ title: "Model deleted" })
			refresh()
		})

		socket.on(
			"koboldcpp:deleteModel:error",
			(message: Sockets.ErrorResponse) => {
				toaster.error({
					title: "Failed to delete model",
					description: message.error
				})
			}
		)

		refresh()
	})

	onDestroy(() => {
		socket.off("koboldcpp:listModels", handleListModels)
		socket.off("koboldcpp:connectModel")
		socket.off("koboldcpp:connectModel:error")
		socket.off("koboldcpp:deleteModel")
		socket.off("koboldcpp:deleteModel:error")
		socket.off("connections:list")
	})
</script>

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
				placeholder="Search models..."
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

{#if isLoading}
	<div class="p-6 text-center">
		<Icons.Loader2 class="mx-auto mb-4 animate-spin" size={32} />
		<p class="text-sm opacity-75">Loading models...</p>
	</div>
{:else if !modelsDirSet}
	<div class="p-6 text-center">
		<Icons.FolderOpen class="text-surface-700-300 mx-auto mb-4" size={48} />
		<h3 class="h4 mb-2">No models directory configured</h3>
		<p class="text-sm opacity-75">
			Set a Models Directory in the Settings tab.
		</p>
	</div>
{:else if filteredModels.length === 0}
	<div class="p-6 text-center">
		<Icons.Package class="text-surface-700-300 mx-auto mb-4" size={48} />
		<h3 class="h4 mb-2">No models found</h3>
		<p class="mb-4 text-sm opacity-75">
			{searchQuery
				? "No models match your search."
				: "Download models from the Available tab."}
		</p>
	</div>
{:else}
	<div class="space-y-3 py-4">
		{#each filteredModels as model}
			{@const loaded = isCurrentlyLoaded(model.name)}
			{@const isDefault =
				findConnectionForModel(model.name)?.id ===
				systemSettingsCtx.settings?.defaultConnectionId}
			{@const existingConn = findConnectionForModel(model.name)}
			<div class="card preset-tonal flex flex-col gap-2 p-4">
				<div class="flex items-center justify-between">
					<h4 class="font-semibold">
						{#if isDefault}
							<Icons.Check
								size={14}
								class="text-success-500 inline-block"
							/>
						{/if}
						{modelDisplayName(model.name)}
					</h4>
				</div>
				{#if loaded}
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
								<Icons.Loader2 size={14} class="animate-spin" />
							{:else}
								<Icons.Star
									size={14}
									fill={isDefault ? "currentColor" : "none"}
								/>
							{/if}
							{isDefault ? "Default" : "Set Default"}
						</button>
						{#if existingConn}
							<button
								class="btn btn-sm preset-filled-surface-500"
								onclick={() =>
									openConnectionSidebar(model.name)}
								title="Open connection settings"
							>
								<Icons.Settings size={14} /> Edit
							</button>
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
