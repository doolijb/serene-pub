<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import ContextConfigUnsavedChangesModal from "../modals/ContextConfigUnsavedChangesModal.svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	let userCtx: { user: SelectUser } = getContext("userCtx")
	let userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")
	let configsList: Sockets.ContextConfigs.List.Response["contextConfigsList"] =
		$state([])
	let selectedConfigId: number | undefined = $state(
		userSettingsCtx.settings?.activeContextConfigId || undefined
	)
	let contextConfig: Sockets.ContextConfigs.Get.Response["contextConfig"] =
		$state({} as Sockets.ContextConfigs.Get.Response["contextConfig"])
	let originalData: Sockets.ContextConfigs.Get.Response["contextConfig"] =
		$state({} as Sockets.ContextConfigs.Get.Response["contextConfig"])
	let unsavedChanges = $derived(
		JSON.stringify(contextConfig) !== JSON.stringify(originalData)
	)
	let showNewNameModal = $state(false)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let showAdvanced = $state(false)

	// Zod validation schema
	const contextConfigSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})

	type ValidationErrors = Record<string, string>
	let validationErrors: ValidationErrors = $state({})

	function validateForm(): boolean {
		const result = contextConfigSchema.safeParse({
			name: contextConfig.name
		})

		if (result.success) {
			validationErrors = {}
			return true
		} else {
			const errors: ValidationErrors = {}
			result.error.errors.forEach((error) => {
				if (error.path.length > 0) {
					errors[error.path[0] as string] = error.message
				}
			})
			validationErrors = errors
			return false
		}
	}

	function handleSave() {
		if (!validateForm()) return
		socket.emit("contextConfigs:update", {
			contextConfig
		})
		// After saving, reload the config from the server
		// socket.emit("contextConfigs:get", { id: selectedConfigId })
	}

	$effect(() => {
		// When selectedConfigId changes, load the config from the server
		if (selectedConfigId) {
			socket.emit("contextConfigs:get", { id: selectedConfigId })
		}
	})

	function handleDelete() {
		if (!contextConfig.isImmutable) {
			socket.emit("contextConfigs:delete", { id: contextConfig.id })
			selectedConfigId = undefined
		}
	}

	function handleReset() {
		contextConfig = { ...originalData }
	}

	function handleNew() {
		showNewNameModal = true
	}

	function handleNewNameConfirm(name: string) {
		if (!name.trim()) return
		const newContextConfig = {
			...contextConfig,
			name: name.trim(),
			isImmutable: false
		}
		delete newContextConfig.id
		socket.emit("contextConfigs:create", {
			contextConfig: newContextConfig
		})
		showNewNameModal = false
	}

	function handleNewNameCancel() {
		showNewNameModal = false
	}

	async function handleOnClose() {
		if (unsavedChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			return true
		}
	}

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}
	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}
	function handleUnsavedChangesModalOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	function handleSetDefault() {
		if (!selectedConfigId) return
		socket.emit("contextConfigs:setUserActive", { id: selectedConfigId })
	}

	onMount(() => {
		socket.on(
			"contextConfigs:list",
			(msg: Sockets.ContextConfigs.List.Response) => {
				configsList = msg.contextConfigsList
				if (!selectedConfigId && configsList.length > 0) {
					selectedConfigId =
						userSettingsCtx.settings?.activeContextConfigId ??
						configsList[0].id
				}
			}
		)

		socket.on(
			"contextConfigs:get",
			(msg: Sockets.ContextConfigs.Get.Response) => {
				contextConfig = { ...msg.contextConfig }
				originalData = { ...msg.contextConfig }
			}
		)

		socket.on(
			"contextConfigs:create",
			(msg: Sockets.ContextConfigs.Create.Response) => {
				selectedConfigId = msg.contextConfig.id
			}
		)
		socket.on(
			"contextConfigs:update",
			(msg: Sockets.ContextConfigs.Update.Response) => {
				contextConfig = { ...msg.contextConfig }
				originalData = { ...msg.contextConfig }
				toaster.success({ title: "Context config saved successfully." })
			}
		)
		socket.on("contextConfigs:setUserActive", () => {
			toaster.success({ title: "Default context config updated" })
		})
		socket.emit("contextConfigs:list", {})
		socket.emit("contextConfigs:get", {
			id: selectedConfigId
		})
		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("contextConfigs:list")
		socket.off("contextConfigs:get")
		socket.off("contextConfigs:create")
		socket.off("contextConfigs:update")
		socket.off("contextConfigs:setUserActive")
		onclose = undefined
	})
</script>

<div class="text-foreground h-full p-4">
	<div class="mt-2 mb-2 flex gap-2 sm:mt-0">
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			onclick={handleNew}
		>
			<Icons.Plus size={16} />
		</button>
		<button
			type="button"
			class="btn btn-sm preset-filled-secondary-500"
			onclick={handleReset}
			disabled={!unsavedChanges}
		>
			<Icons.RefreshCcw size={16} />
		</button>
		<button
			type="button"
			class="btn btn-sm preset-filled-error-500"
			onclick={handleDelete}
			disabled={!contextConfig || contextConfig.isImmutable}
		>
			<Icons.X size={16} />
		</button>
	</div>
	<div class="mb-6">
		<select
			class="select w-full"
			bind:value={selectedConfigId}
			disabled={unsavedChanges}
		>
			{#each configsList.filter((c) => c.isImmutable) as c}
				{@const isDefault = c.id === userSettingsCtx.settings?.activeContextConfigId}
				<option value={c.id}>{isDefault ? "★ " : ""}{c.name}*</option>
			{/each}
			{#each configsList.filter((c) => !c.isImmutable) as c}
				{@const isDefault = c.id === userSettingsCtx.settings?.activeContextConfigId}
				<option value={c.id}>{isDefault ? "★ " : ""}{c.name}</option>
			{/each}
		</select>
	</div>
	{#if contextConfig}
		<div class="mt-4 mb-4 flex w-full gap-2">
			<button
				class="btn btn-sm preset-filled-success-500 flex-1"
				onclick={handleSave}
				disabled={contextConfig.isImmutable || !unsavedChanges}
			>
				<Icons.Save size={16} />
				Update
			</button>
			<button
				class="btn btn-sm preset-filled-warning-500 shrink-0"
				onclick={handleSetDefault}
				disabled={!selectedConfigId || selectedConfigId === userSettingsCtx.settings?.activeContextConfigId}
				title="Set as default"
			>
				<Icons.Star size={16} /> Set Default
			</button>
		</div>
		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-1">
				<label class="font-semibold" for="contextName">Name*</label>
				<input
					id="contextName"
					type="text"
					bind:value={contextConfig.name}
					class="input w-full {validationErrors.name
						? 'border-red-500'
						: ''}"
					disabled={contextConfig.isImmutable}
					oninput={() => {
						if (validationErrors.name) {
							const { name, ...rest } = validationErrors
							validationErrors = rest
						}
					}}
				/>
				{#if validationErrors.name}
					<p class="mt-1 text-sm text-red-500" role="alert">
						{validationErrors.name}
					</p>
				{/if}
			</div>
			<button
				type="button"
				class="btn btn-sm preset-filled-surface-500 mt-2 mb-2 w-full"
				onclick={() => (showAdvanced = !showAdvanced)}
			>
				{showAdvanced ? "Hide Advanced" : "Show Advanced"}
			</button>
			{#if showAdvanced}
				<div class="flex flex-col gap-1">
					<label class="font-semibold" for="contextTemplate">
						Template
					</label>
					<textarea
						id="template"
						rows="20"
						bind:value={contextConfig.template}
						class="input w-full"
					></textarea>
				</div>
				<!-- <div class="flex flex-col gap-4">
                    <div class="flex flex-col gap-1">
                        <label class="flex items-center gap-2 font-semibold disabled">
                            <input
                                type="checkbox"
                                checked={contextConfig.alwaysForceName}
                                onchange={(e) =>
                                    (contextConfig = {
                                        ...contextConfig,
                                        alwaysForceName: e.target.checked
                                    })}
                                    disabled
                            /> Append Name to Prompt
                        </label>
                        <div class="card preset-filled-surface-400-600 p-2">
                            <p>
                                Append Name to Prompt is disabled for now.
                            </p>
                        </div>
                    </div>
                </div> -->
			{/if}
		</div>
	{/if}
</div>

<ContextConfigUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>

<NewNameModal
	open={showNewNameModal}
	onOpenChange={(e) => (showNewNameModal = e.open)}
	onConfirm={handleNewNameConfirm}
	onCancel={handleNewNameCancel}
	title="New Context Config"
	description="Your current settings will be copied."
/>
