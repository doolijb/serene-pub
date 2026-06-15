<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy } from "svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"

	const socket = skio.get()

	let currentModel = $state<string | null>(null)
	let availableConfigs = $state<string[]>([])
	let isLoading = $state(false)
	let isLoadingModel = $state(false)
	let loadingConfig = $state<string | null>(null)
	let isConnecting = $state(false)
	let connectingConfig = $state<string | null>(null)

	function refreshModels() {
		isLoading = true
		socket.emit("koboldcpp:listModels", {})
	}

	function handleLoadModel(filename: string) {
		loadingConfig = filename
		isLoadingModel = true
		socket.emit("koboldcpp:loadModel", { filename })
	}

	function handleConnectModel(modelName: string) {
		connectingConfig = modelName
		isConnecting = true
		socket.emit("koboldcpp:connectModel", { modelName })
	}

	onMount(() => {
		socket.on(
			"koboldcpp:listModels",
			(message: Sockets.KoboldCpp.ListModels.Response) => {
				isLoading = false
				currentModel = message.currentModel
				availableConfigs = message.availableConfigs
			}
		)

		socket.on(
			"koboldcpp:loadModel",
			(message: Sockets.KoboldCpp.LoadModel.Response) => {
				isLoadingModel = false
				loadingConfig = null
				if (message.success) {
					toaster.success({ title: message.success })
					refreshModels()
				}
			}
		)

		socket.on("koboldcpp:loadModel:error", (message: any) => {
			isLoadingModel = false
			loadingConfig = null
			toaster.error({
				title: "Failed to load model",
				description: message.error
			})
		})

		socket.on(
			"koboldcpp:connectModel",
			(message: Sockets.KoboldCpp.ConnectModel.Response) => {
				isConnecting = false
				connectingConfig = null
				if (message.success) {
					toaster.success({ title: message.success })
				}
			}
		)

		socket.on("koboldcpp:connectModel:error", (message: any) => {
			isConnecting = false
			connectingConfig = null
			toaster.error({
				title: "Failed to connect model",
				description: message.error
			})
		})

		refreshModels()
	})

	onDestroy(() => {
		socket.off("koboldcpp:listModels")
		socket.off("koboldcpp:loadModel")
		socket.off("koboldcpp:loadModel:error")
		socket.off("koboldcpp:connectModel")
		socket.off("koboldcpp:connectModel:error")
	})

	function configDisplayName(path: string): string {
		return path
			.replace(/\.kcpps$/i, "")
			.split(/[/\\]/)
			.pop() ?? path
	}
</script>

<div class="space-y-4 p-4">
	<!-- Currently loaded model -->
	<div class="card bg-surface-100-800 p-4">
		<div class="mb-2 flex items-center justify-between">
			<h3 class="font-semibold">Currently Loaded</h3>
			<button
				class="btn btn-sm preset-filled-surface-500"
				onclick={refreshModels}
				disabled={isLoading}
				title="Refresh model list"
			>
				<Icons.RefreshCw
					size={14}
					class={isLoading ? "animate-spin" : ""}
				/>
			</button>
		</div>

		{#if currentModel}
			<div class="flex items-center justify-between gap-2">
				<div class="flex items-center gap-2 overflow-hidden">
					<Icons.Cpu size={16} class="text-success-500 shrink-0" />
					<span class="truncate font-mono text-sm">{currentModel}</span>
				</div>
				<button
					class="btn btn-sm preset-filled-primary-500 shrink-0"
					onclick={() => handleConnectModel(currentModel!)}
					disabled={isConnecting && connectingConfig === currentModel}
				>
					{#if isConnecting && connectingConfig === currentModel}
						<Icons.Loader2 size={14} class="animate-spin" />
					{:else}
						<Icons.Cable size={14} />
					{/if}
					Use
				</button>
			</div>
		{:else}
			<p class="text-muted-foreground text-sm">No model currently loaded</p>
		{/if}
	</div>

	<!-- Available configs -->
	<div>
		<h3 class="mb-2 font-semibold">
			Available Configs
			{#if availableConfigs.length > 0}
				<span class="text-muted-foreground text-sm font-normal">
					({availableConfigs.length})
				</span>
			{/if}
		</h3>

		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<Icons.Loader2 size={24} class="text-muted-foreground animate-spin" />
			</div>
		{:else if availableConfigs.length === 0}
			<div class="text-muted-foreground py-6 text-center text-sm">
				<Icons.FileQuestion
					size={32}
					class="mx-auto mb-2 opacity-50"
				/>
				<p>No .kcpps config files found.</p>
				<p class="text-xs">
					KoboldCPP may not expose the list_options endpoint.
				</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each availableConfigs as config}
					{@const displayName = configDisplayName(config)}
					{@const isCurrentlyLoaded = config === currentModel}
					<div
						class="card bg-surface-100-800 flex items-center justify-between gap-2 p-3"
					>
						<div class="flex min-w-0 items-center gap-2">
							<Icons.FileCode
								size={16}
								class={isCurrentlyLoaded
									? "text-success-500"
									: "text-muted-foreground"}
							/>
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{displayName}</p>
								<p class="text-muted-foreground truncate font-mono text-xs">
									{config}
								</p>
							</div>
						</div>
						<div class="flex shrink-0 gap-1">
							{#if !isCurrentlyLoaded}
								<button
									class="btn btn-sm preset-filled-surface-500"
									onclick={() => handleLoadModel(config)}
									disabled={isLoadingModel}
									title="Hot-swap to this config"
								>
									{#if isLoadingModel && loadingConfig === config}
										<Icons.Loader2 size={14} class="animate-spin" />
									{:else}
										<Icons.RefreshCcw size={14} />
									{/if}
									Load
								</button>
							{/if}
							<button
								class="btn btn-sm preset-filled-primary-500"
								onclick={() => handleConnectModel(config)}
								disabled={isConnecting}
								title="Connect to this model in Serene Pub"
							>
								{#if isConnecting && connectingConfig === config}
									<Icons.Loader2 size={14} class="animate-spin" />
								{:else}
									<Icons.Cable size={14} />
								{/if}
								Connect
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
