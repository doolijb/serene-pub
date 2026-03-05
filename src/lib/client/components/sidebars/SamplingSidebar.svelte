<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onDestroy, onMount, tick } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import SamplingConfigUnsavedChangesModal from "../modals/PromptConfigUnsavedChangesModal.svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	let userCtx: { user: SelectUser } = getContext("userCtx")

	const socket = useTypedSocket()

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

	function handleSelectChange(e: Event) {
		socket.emit("samplingConfigs:setUserActive", {
			id: (e.target as HTMLSelectElement).value
		})
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
		socket.emit("samplingConfigs:create", { sampling: newSamplingConfig })
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
			id: userCtx.user.activeSamplingConfigId
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
		socket.on("samplingConfigs:get", (message: Sockets.SamplingConfigs.Get.Response) => {
			sampling = { ...message.sampling }
			originalSamplingConfig = { ...message.sampling }
		})

		socket.on(
			"samplingConfigs:list",
			(message: Sockets.SamplingConfigs.List.Response) => {
				samplingConfigsList = message.samplingConfigsList
				if (
					!userCtx.user.activeSamplingConfigId &&
					samplingConfigsList.length > 0
				) {
					socket.emit("samplingConfigs:setUserActive", {
						id: samplingConfigsList[0].id
					})
				}
			}
		)
		socket.on(
			"samplingConfigs:delete",
			(message: Sockets.SamplingConfigs.Delete.Response) => {
				toaster.success({ title: "Sampling Config Deleted" })
			}
		)
		socket.on(
			"samplingConfigs:update",
			(message: Sockets.SamplingConfigs.Update.Response) => {
				toaster.success({ title: "Sampling Config Updated" })
			}
		)
		socket.on(
			"samplingConfigs:create",
			(message: Sockets.SamplingConfigs.Create.Response) => {
				toaster.success({ title: "Sampling Config Created" })
			}
		)

		socket.emit("samplingConfigs:get", { id: userCtx.user.activeSamplingConfigId })
		socket.emit("samplingConfigs:list", {})
	})

	onDestroy(() => {
		socket.off("samplingConfigs:get")
		socket.off("samplingConfigs:list")
		socket.off("samplingConfigs:delete")
		socket.off("samplingConfigs:update")
		socket.off("samplingConfigs:create")
	})
</script>

<div class="text-foreground min-h-100 p-4">
	{#if showSelectSamplingConfig}
		<!-- ENABLE / DISABLE WEIGHTS -->
		<div
			class="animate-fade-in border-surface-500/25 min-h-full rounded-lg border p-2 shadow-lg"
		>
			<button
				type="button"
				class="btn preset-tonal-primary mb-4"
				onclick={handleBackToSidebar}
			>
				<Icons.ArrowLeft /> Back
			</button>
			<h2 class="mb-4 text-lg font-bold">
				Enable/Disable Weight Options
			</h2>
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
				disabled={!!sampling && sampling.isImmutable}
			>
				<Icons.X size={16} />
			</button>
		</div>
		<div
			class="mb-6 flex flex-col items-start gap-2 sm:flex-row sm:items-center"
		>
			<select
				class="select select-sm bg-background border-muted rounded border"
				onchange={handleSelectChange}
				bind:value={userCtx.user.activeSamplingConfigId}
				disabled={unsavedChanges}
			>
				{#each samplingConfigsList.filter((w) => w.isImmutable) as w}
					<option value={w.id}>
						{w.name}{#if w.isImmutable}*{/if}
					</option>
				{/each}
				{#each samplingConfigsList.filter((w) => !w.isImmutable) as w}
					<option value={w.id}>
						{w.name}{#if w.isImmutable}*{/if}
					</option>
				{/each}
			</select>
		</div>
		<div class="mb-4 flex gap-2">
			<button
				type="button"
				class="btn btn-sm preset-tonal-primary w-full"
				onclick={handleSelectSamplingConfig}
			>
				<Icons.CheckSquare size={16} />
				Select Samplers
			</button>
			<button
				type="button"
				class="btn btn-sm preset-filled-success-500 w-full"
				onclick={handleUpdate}
				disabled={(!!sampling && sampling.isImmutable) ||
					!unsavedChanges}
			>
				<Icons.Save size={16} /> Save
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
						? 'border-red-500'
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
					<p class="mt-1 text-sm text-red-500" role="alert">
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

<Modal
	open={showDeleteModal}
	onOpenChange={(e) => (showDeleteModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
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
	{/snippet}
</Modal>
