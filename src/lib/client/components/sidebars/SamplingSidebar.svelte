<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onDestroy, onMount, tick } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import SamplingConfigUnsavedChangesModal from "../modals/PromptConfigUnsavedChangesModal.svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	let userCtx: UserCtx = getContext("userCtx")

	const socket = useTypedSocket()

	let activeSamplingConfigId = $derived(
		userCtx.user?.activeSamplingConfig?.id ?? null
	)

	let selectedSamplingId: number | null = $state(null)

	// Initial sync from user context — only when we haven't manually selected yet
	$effect(() => {
		const config = userCtx.user?.activeSamplingConfig
		if (config && !selectedSamplingId) {
			sampling = { ...config }
			originalSamplingConfig = { ...config }
			selectedSamplingId = config.id
		}
	})

	let sampling: SelectSamplingConfig | undefined = $state()
	let originalSamplingConfig: SelectSamplingConfig | undefined = $state()
	let unsavedChanges = $derived.by(() => {
		if (!sampling || !originalSamplingConfig) return false
		// Compare current sampling with original to detect changes
		return (
			JSON.stringify(sampling) !== JSON.stringify(originalSamplingConfig)
		)
	})
	let showSelectSamplingConfig = $state(false)
	let showUnsavedChangesModal = $state(false)
	let showNewNameModal = $state(false)
	let showDeleteModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let editingField: string | null = $state(null)

	// Zod validation schema
	const samplingConfigSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})

	type ValidationErrors = Record<string, string>
	let validationErrors: ValidationErrors = $state({})

	type FieldType = "number" | "boolean" | "string"

	const fieldMeta: Record<
		string,
		{
			label: string
			type: FieldType
			min?: number
			max?: number
			step?: number
			unlockedMax?: number
			default?: number
		}
	> = {
		responseTokens: {
			label: "Response Tokens",
			type: "number",
			min: 1,
			max: 4096,
			step: 1,
			unlockedMax: 65536
		}, // Unlocked max for response tokens
		contextTokens: {
			label: "Context Tokens",
			type: "number",
			min: 1,
			max: 32768,
			step: 1,
			unlockedMax: 524288
		}, // Unlocked max for context tokens
		temperature: {
			label: "Temperature",
			type: "number",
			min: 0,
			max: 2,
			step: 0.01
		},
		topP: { label: "Top P", type: "number", min: 0, max: 1, step: 0.01 },
		topK: { label: "Top K", type: "number", min: 0, max: 200, step: 1 },
		repetitionPenalty: {
			label: "Repetition Penalty",
			type: "number",
			min: 0.5,
			max: 2,
			step: 0.01
		},
		frequencyPenalty: {
			label: "Frequency Penalty",
			type: "number",
			min: 0,
			max: 2,
			step: 0.01
		},
		presencePenalty: {
			label: "Presence Penalty",
			type: "number",
			min: 0,
			max: 2,
			step: 0.01
		},
		seed: { label: "Seed", type: "number", min: -1, max: 999999, step: 1 }
	}

	// Helper: Show field if enabled, or if no enabled flag exists
	function isFieldVisible(key: string) {
		const enabledKey = key + "Enabled"
		return (
			key !== "isImmutable" &&
			((sampling as any)?.[enabledKey] === undefined || (sampling as any)?.[enabledKey])
		)
	}

	function getFieldMax(key: string): number {
		// Check if the field is contextTokens or responseTokens
		if (
			(key === "contextTokens" && sampling!.contextTokensUnlocked) ||
			(key === "responseTokens" && sampling!.responseTokensUnlocked)
		) {
			const unlockedMax = fieldMeta[key]?.unlockedMax
			return unlockedMax !== undefined ? unlockedMax : getFieldMax(key)
		}
		// For other fields, return the defined max
		return fieldMeta[key]?.max ?? 0
	}

	// Focus helper for manual input
	async function focusInput(id: string) {
		await tick()
		const el = document.getElementById(id)
		if (el) el.focus()
	}

	// Mock list of saved sampling for dropdown
	let samplingConfigsList: Sockets.SamplingConfigs.List.Response["samplingConfigsList"] =
		$state([])

	// Drives the select's value via bind: rather than per-option `selected`
	// attributes — the list of options gets regenerated on every save (the
	// server re-emits samplingConfigs:list as part of the update flow), and
	// `selected` attributes on <option> don't reliably survive that; the
	// browser falls back to the first option, which looked like "the
	// selection reverts to the default config" after saving.
	$effect(() => {
		if (selectedSamplingId) {
			socket.emit("samplingConfigs:get", { id: selectedSamplingId })
		}
	})

	function handleSetDefault() {
		if (!selectedSamplingId) return
		socket.emit("samplingConfigs:setUserActive", { id: selectedSamplingId })
	}

	function handleNew() {
		showNewNameModal = true
	}
	function handleNewNameConfirm(name: string) {
		if (!socket) return
		const newSamplingConfig = { ...sampling }
		delete newSamplingConfig.id
		delete newSamplingConfig.isImmutable
		newSamplingConfig.name = name.trim()
		socket.emit("samplingConfigs:create", { sampling: { ...newSamplingConfig, name: name.trim() } })
		showNewNameModal = false
	}
	function handleNewNameCancel() {
		showNewNameModal = false
	}

	function validateForm(): boolean {
		if (!sampling) return false

		const result = samplingConfigSchema.safeParse({
			name: sampling.name
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

	function handleUpdate() {
		if (!socket || !sampling) return
		if (sampling.isImmutable) {
			toaster.error({
				title: "Cannot Save",
				description: "Cannot save immutable sampling configuration."
			})
			return
		}
		if (!validateForm()) return
		socket.emit("samplingConfigs:update", { sampling })
	}

	function handleReset() {
		if (originalSamplingConfig) {
			sampling = { ...originalSamplingConfig }
		}
	}

	function handleDelete() {
		if (!socket || !sampling) return
		if (sampling.isImmutable) {
			toaster.error({
				title: "Cannot Delete",
				description: "Cannot delete immutable sampling configuration."
			})
			return
		}
		showDeleteModal = true
	}

	function confirmDelete() {
		socket.emit("samplingConfigs:delete", {
			id: sampling!.id!
		})
		showDeleteModal = false
	}

	function cancelDelete() {
		showDeleteModal = false
	}

	function handleSelectSamplingConfig() {
		showSelectSamplingConfig = true
	}
	function handleBackToSidebar() {
		showSelectSamplingConfig = false
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

	onMount(() => {
		onclose = handleOnClose
		socket.on(
			"samplingConfigs:list",
			(message: Sockets.SamplingConfigs.List.Response) => {
				samplingConfigsList = message.samplingConfigsList
			}
		)
		socket.on(
			"samplingConfigs:delete",
			(_message: Sockets.SamplingConfigs.Delete.Response) => {
				toaster.success({ title: "Sampling Config Deleted" })
			}
		)
		socket.on(
			"samplingConfigs:update",
			(_message: Sockets.SamplingConfigs.Update.Response) => {
				toaster.success({ title: "Sampling Config Updated" })
			}
		)
		socket.on(
			"samplingConfigs:create",
			(_message: Sockets.SamplingConfigs.Create.Response) => {
				toaster.success({ title: "Sampling Config Created" })
			}
		)
		socket.on("samplingConfigs:get", (message: Sockets.SamplingConfigs.Get.Response) => {
			sampling = { ...message.sampling }
			originalSamplingConfig = { ...message.sampling }
		})
		socket.on("samplingConfigs:setUserActive", () => {
			toaster.success({ title: "Default sampling config updated" })
		})

		socket.emit("samplingConfigs:list", {})
	})

	onDestroy(() => {
		socket.off("samplingConfigs:list")
		socket.off("samplingConfigs:delete")
		socket.off("samplingConfigs:update")
		socket.off("samplingConfigs:create")
		socket.off("samplingConfigs:get")
		socket.off("samplingConfigs:setUserActive")
	})
</script>

<div class="text-foreground min-h-100 p-4">
	{#if showSelectSamplingConfig}
		<!-- ENABLE / DISABLE WEIGHTS -->
		<div
			class="animate-fade-in border-surface-500/25 min-h-full rounded-lg border p-2 shadow-lg"
		>
			<div class="mb-4 flex items-center gap-2">
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleBackToSidebar}
					title="Back"
				>
					<Icons.ChevronLeft size={16} />
					Back
				</button>
				<h2 class="flex-1 truncate font-semibold">Enable/Disable Weight Options</h2>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each Object.entries(fieldMeta) as [key, meta]}
					{#if meta.type === "number" || meta.type === "boolean"}
						<label
							class="hover:bg-muted flex items-center gap-2 rounded p-2 transition"
							for="{key}Enabled"
						>
							<input
								id="{key}Enabled"
								type="checkbox"
								checked={(sampling as any)?.[key + "Enabled"] ?? false}
								onchange={(e) => {
									if (sampling) {
										(sampling as any)[key + "Enabled"] = (e.target as HTMLInputElement).checked
									}
								}}
								class="accent-primary"
								disabled={(sampling as any)?.[key + "Enabled"] ===
									undefined}
							/>
							<span class="font-medium">{meta.label}</span>
						</label>
					{/if}
				{/each}
			</div>
		</div>
	{:else if !!sampling}
		<!-- MANAGE WEIGHTS -->
		<div class="mt-2 mb-2 flex gap-2 sm:mt-0">
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500"
				onclick={handleNew}
				title="New sampling config"
			>
				<Icons.Plus size={16} />
				New
			</button>
			<button
				type="button"
				class="btn btn-sm preset-filled-secondary-500"
				onclick={handleReset}
				disabled={!unsavedChanges}
				title="Reset unsaved changes"
			>
				<Icons.RefreshCcw size={16} />
				Reset
			</button>
			<button
				type="button"
				class="btn btn-sm preset-filled-error-500"
				onclick={handleDelete}
				disabled={!!sampling && sampling.isImmutable}
				title="Delete sampling config"
			>
				<Icons.X size={16} />
				Delete
			</button>
		</div>
		<div class="mb-4">
			<select
				class="select w-full"
				bind:value={selectedSamplingId}
				disabled={unsavedChanges}
			>
				{#each samplingConfigsList.filter((w) => w.isImmutable) as w}
					{@const isDefault = w.id === activeSamplingConfigId}
					<option value={w.id}>
						{isDefault ? "★ " : ""}{w.name}*
					</option>
				{/each}
				{#each samplingConfigsList.filter((w) => !w.isImmutable) as w}
					{@const isDefault = w.id === activeSamplingConfigId}
					<option value={w.id}>
						{isDefault ? "★ " : ""}{w.name}
					</option>
				{/each}
			</select>
		</div>
		<div class="mb-4 flex gap-2">
			<button
				type="button"
				class="btn btn-sm preset-tonal-primary flex-1"
				onclick={handleSelectSamplingConfig}
			>
				<Icons.CheckSquare size={16} />
				Select Samplers
			</button>
			<button
				type="button"
				class="btn btn-sm preset-filled-success-500 flex-1"
				onclick={handleUpdate}
				disabled={(!!sampling && sampling.isImmutable) ||
					!unsavedChanges}
			>
				<Icons.Save size={16} /> Update
			</button>
			<button
				type="button"
				class="btn btn-sm preset-filled-warning-500 shrink-0"
				onclick={handleSetDefault}
				disabled={!selectedSamplingId || selectedSamplingId === activeSamplingConfigId}
				title={selectedSamplingId === activeSamplingConfigId
					? "Already the default"
					: "Set as default"}
			>
				<Icons.Star size={16} fill={selectedSamplingId === activeSamplingConfigId ? "currentColor" : "none"} />
				{selectedSamplingId === activeSamplingConfigId ? "Default" : "Set Default"}
			</button>
		</div>

		<form class="space-y-4">
			<div class="flex flex-col gap-1">
				<label class="font-semibold" for="samplingName">Name</label>
				<input
					id="samplingName"
					type="text"
					bind:value={sampling.name}
					class="input {validationErrors.name
						? 'border-error-500'
						: ''}"
					disabled={!!sampling && sampling.isImmutable}
					oninput={() => {
						if (validationErrors.name) {
							const { name, ...rest } = validationErrors
							validationErrors = rest
						}
					}}
				/>
				{#if validationErrors.name}
					<p class="mt-1 text-sm text-error-500" role="alert">
						{validationErrors.name}
					</p>
				{/if}
			</div>
			{#each Object.entries(fieldMeta) as [key, meta]}
				{#if isFieldVisible(key)}
					<div class="flex flex-col gap-1">
						<label class="font-semibold" for={key}>
							{meta?.label ?? key}
						</label>
						{#if meta?.type === "number"}
							<div class="flex flex-col items-center gap-2">
								<input
									type="range"
									min={meta.min}
									max={getFieldMax(key)}
									step={meta.step}
									id={key}
									value={(sampling as any)?.[key] ?? 0}
									oninput={(e) => {
										if (sampling) {
											(sampling as any)[key] = parseFloat((e.target as HTMLInputElement).value)
										}
									}}
									class="accent-primary w-full"
								/>
								<div
									class="text-muted-foreground flex w-full justify-between gap-1 text-xs"
								>
									<span
										title="Minimum value"
										class="select-none"
									>
										{meta.min}
									</span>
									{#if editingField === key}
										<input
											type="number"
											min={meta.min}
											max={getFieldMax(key)}
											step={meta.step}
											value={(sampling as any)?.[key] ?? 0}
											oninput={(e) => {
												if (sampling) {
													(sampling as any)[key] = parseFloat((e.target as HTMLInputElement).value)
												}
											}}
											id={key + "-manual"}
											class="border-primary input w-16 rounded border"
											onblur={() => (editingField = null)}
											onkeydown={(e) => {
												if (
													e.key === "Enter" ||
													e.key === "Escape"
												)
													editingField = null
											}}
										/>
									{:else}
										<button
											class="hover:bg-muted cursor-pointer rounded px-1 py-0.5"
											title="Edit"
											onclick={async () => {
												editingField = key
												await focusInput(
													key + "-manual"
												)
											}}
										>
											{(sampling as any)?.[key]}
										</button>
									{/if}
									<span
										title="Maximum value"
										class="select-none"
									>
										{getFieldMax(key)}
									</span>
								</div>

								{#if key === "responseTokens"}
									<div class="mt-2 flex items-center gap-2">
										<input
											type="checkbox"
											id="responseTokensUnlocked"
											bind:checked={
												sampling.responseTokensUnlocked
											}
											class="accent-primary"
										/>
										<label
											for="responseTokensUnlocked"
											class="text-sm"
										>
											Unlock max
										</label>
									</div>
								{:else if key === "contextTokens"}
									<div class="mt-2 flex items-center gap-2">
										<input
											type="checkbox"
											id="contextTokensUnlocked"
											bind:checked={
												sampling.contextTokensUnlocked
											}
											class="accent-primary"
										/>
										<label
											for="contextTokensUnlocked"
											class="text-sm"
										>
											Unlock max
										</label>
									</div>
								{/if}
							</div>
						{:else if meta?.type === "boolean"}
							<input
								type="checkbox"
								id={key}
								checked={(sampling as any)?.[key] ?? false}
								onchange={(e) => {
									if (sampling) {
										(sampling as any)[key] = (e.target as HTMLInputElement).checked
									}
								}}
								class="accent-primary"
							/>
						{:else}
							<input
								type="text"
								id={key}
								value={(sampling as any)?.[key] ?? ""}
								oninput={(e) => {
									if (sampling) {
										(sampling as any)[key] = (e.target as HTMLInputElement).value
									}
								}}
								class="input"
							/>
						{/if}
					</div>
				{/if}
			{/each}
		</form>
	{/if}
</div>

<SamplingConfigUnsavedChangesModal
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
	title="New Sampling Config"
	description="Your current settings will be copied."
/>

<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-[95vw]">
				<header class="flex justify-between">
					<h2 class="h2">Delete Sampling Configuration</h2>
				</header>
				<article>
					<p class="opacity-60">
						Are you sure you want to delete the sampling configuration "{sampling?.name}"?
						This action cannot be undone.
					</p>
				</article>
				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-filled-surface-500"
						onclick={cancelDelete}
					>
						Cancel
					</button>
					<button class="btn preset-filled-error-500" onclick={confirmDelete}>
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
