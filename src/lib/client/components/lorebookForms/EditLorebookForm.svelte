<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte"
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"

	// Zod validation schema
	const lorebookSchema = z.object({
		name: z.string().min(1, "Name is required").trim(),
		description: z.string().optional()
	})

	type ValidationErrors = Record<string, string>

	interface Props {
		lorebookId: number
		hasUnsavedChanges?: boolean
		mode?: "view" | "edit"
	}

	let { lorebookId, hasUnsavedChanges = $bindable(false), mode = $bindable("view") }: Props = $props()

	const socket = skio.get()

	// Tag-related state
	let tagsList: SelectTag[] = $state([])
	let tagSearchInput = $state("")
	let showTagSuggestions = $state(false)

	let editLorebook: Sockets.Lorebook.Response["lorebook"] | undefined =
		$state()
	let originalLorebook: Sockets.Lorebook.Response["lorebook"] | undefined =
		$state()
	let validationErrors: ValidationErrors = $state({})
	let isLoading = $state(true)
	let loadError = $state("")

	$effect(() => {
		hasUnsavedChanges =
			JSON.stringify(editLorebook) !== JSON.stringify(originalLorebook)
	})

	// Filtered tags for suggestions
	let filteredTags = $derived.by(() => {
		if (!tagSearchInput)
			return tagsList.filter(
				(tag) =>
					!(editLorebook?.tags || []).some(
						(selectedTag) =>
							selectedTag.toLowerCase() === tag.name.toLowerCase()
					)
			)
		return tagsList.filter(
			(tag) =>
				tag.name.toLowerCase().includes(tagSearchInput.toLowerCase()) &&
				!(editLorebook?.tags || []).some(
					(selectedTag) =>
						selectedTag.toLowerCase() === tag.name.toLowerCase()
				)
		)
	})

	// Tag helper functions
	function addTag(tagName: string) {
		const trimmedName = tagName.trim()
		if (!trimmedName || !editLorebook) return

		// Check for case-insensitive duplicates
		const isDuplicate = (editLorebook.tags || []).some(
			(existingTag) =>
				existingTag.toLowerCase() === trimmedName.toLowerCase()
		)
		if (isDuplicate) return

		editLorebook.tags = [...(editLorebook.tags || []), trimmedName]
		tagSearchInput = ""
		showTagSuggestions = false
	}

	function removeTag(tagName: string) {
		if (editLorebook) {
			editLorebook.tags = (editLorebook.tags || []).filter(
				(tag) => tag !== tagName
			)
		}
	}

	function handleTagInputKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && tagSearchInput.trim()) {
			e.preventDefault()
			addTag(tagSearchInput)
		} else if (e.key === "Escape") {
			showTagSuggestions = false
		}
	}

	function handleSave() {
		if (!validateForm()) return
		const updateReq: Sockets.Lorebooks.Update.Call = {
			lorebook: editLorebook!
		}
		socket.emit("lorebooks:update", updateReq)
	}

	function validateForm(): boolean {
		if (!editLorebook) return false

		const result = lorebookSchema.safeParse({
			name: editLorebook.name,
			description: editLorebook.description
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
	function handleCancel() {
		editLorebook = { ...originalLorebook! }
		mode = "view"
	}

	onMount(() => {
		socket.on(
			"lorebooks:get",
			async (msg: Sockets.Lorebooks.Get.Response) => {
				if (msg.lorebook && msg.lorebook.id === lorebookId) {
					editLorebook = { ...msg.lorebook }
					originalLorebook = { ...msg.lorebook }
					isLoading = false
					loadError = ""
				} else {
					loadError = "Lorebook not found"
					isLoading = false
				}
				await tick() // Force state to update
			}
		)
		socket.on(
			"lorebooks:update",
			async (msg: Sockets.Lorebooks.Update.Response) => {
				if (msg.lorebook && msg.lorebook.id === lorebookId) {
					editLorebook = { ...msg.lorebook }
					originalLorebook = { ...msg.lorebook }
					mode = "view"
					toaster.success({
						title: "Lorebook Updated",
						description: `Lorebook "${msg.lorebook.name}" updated successfully.`
					})
				}
			}
		)
		socket.on("tags:list", (msg: any) => {
			tagsList = msg.tagsList || []
		})

		// Load tags list
		socket.emit("tags:list", {})

		const lorebookReq: Sockets.Lorebooks.Get.Params = { id: lorebookId }
		socket.emit("lorebooks:get", lorebookReq)
	})

	onDestroy(() => {
		socket.off("lorebooks:get")
		socket.off("lorebooks:update")
		socket.off("tags:list")
	})
</script>

{#if isLoading}
	<div class="flex items-center justify-center p-4">
		<div class="text-center">
			<Icons.Loader size={24} class="mx-auto mb-2 animate-spin" />
			<p>Loading lorebook...</p>
		</div>
	</div>
{:else if loadError}
	<div class="flex items-center justify-center p-4">
		<div class="text-center">
			<Icons.AlertTriangle
				size={24}
				class="text-error-500 mx-auto mb-2"
			/>
			<p class="text-error-500">{loadError}</p>
		</div>
	</div>
{:else if editLorebook}
	{#if mode === "view"}
		<div class="flex flex-col gap-4">
			<button class="btn btn-sm preset-filled-primary-500 self-start" onclick={() => (mode = "edit")}>
				<Icons.Pencil size={14} /> Edit
			</button>
			<div>
				<p class="text-base font-semibold">{editLorebook.name}</p>
				{#if editLorebook.description}
					<p class="text-surface-500 mt-2 text-sm whitespace-pre-wrap">{editLorebook.description}</p>
				{/if}
			</div>
			{#if editLorebook.tags && editLorebook.tags.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each editLorebook.tags as tagName}
						{@const tag = tagsList.find((t) => t.name === tagName)}
						<span class="chip {tag?.colorPreset || 'preset-filled-primary-500'}">{tagName}</span>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
	<div class="flex flex-col gap-6">
		<div class="flex gap-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600 w-full"
				onclick={handleCancel}
			>
				Cancel
			</button>
			<button
				class="btn btn-sm preset-filled-success-500 w-full"
				onclick={handleSave}
				disabled={!hasUnsavedChanges}
			>
				<Icons.Save size={16} />
				Update
			</button>
		</div>
		<div>
			<label class="font-semibold" for="lorebookName">Name*</label>
			<input
				id="lorebookName"
				class="input input-lg w-full {validationErrors.name
					? 'border-red-500'
					: ''}"
				type="text"
				placeholder="Enter lorebook name"
				bind:value={editLorebook.name}
				required
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
		<div>
			<label class="font-semibold" for="lorebookDescription">
				Description
			</label>
			<textarea
				id="lorebookDescription"
				class="textarea input-lg w-full"
				placeholder="Describe this lorebook (optional)"
				bind:value={editLorebook.description}
				rows={2}
			></textarea>
		</div>

		<!-- Tags Section -->
		<div>
			<label class="font-semibold" for="tagInput">Tags</label>
			<div class="relative">
				<input
					id="tagInput"
					type="text"
					bind:value={tagSearchInput}
					class="input w-full"
					placeholder="Add a tag..."
					onfocus={() => (showTagSuggestions = true)}
					onblur={() =>
						setTimeout(() => (showTagSuggestions = false), 200)}
					onkeydown={handleTagInputKeydown}
				/>

				<!-- Tag suggestions dropdown -->
				{#if showTagSuggestions && filteredTags.length > 0}
					<div
						class="bg-surface-100-900 absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border shadow-lg"
					>
						{#each filteredTags as tag}
							<button
								type="button"
								class="hover:bg-surface-200-800 w-full px-3 py-2 text-left transition-colors"
								onclick={() => addTag(tag.name)}
							>
								<span
									class="chip mr-2 {tag.colorPreset ||
										'preset-filled-primary-500'}"
								>
									{tag.name}
								</span>
								{#if tag.description}
									<span class="text-muted-foreground text-sm">
										- {tag.description}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Selected tags display -->
			{#if editLorebook.tags && editLorebook.tags.length > 0}
				<div class="mt-2 flex flex-wrap gap-2">
					{#each editLorebook.tags as tagName}
						{@const tag = tagsList.find((t) => t.name === tagName)}
						<button
							type="button"
							class="chip {tag?.colorPreset ||
								'preset-filled-primary-500'} group relative"
							onclick={() => removeTag(tagName)}
							title="Click to remove tag"
						>
							{tagName}
							<Icons.X
								size={14}
								class="ml-1 opacity-60 group-hover:opacity-100"
							/>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
	{/if}
{/if}
