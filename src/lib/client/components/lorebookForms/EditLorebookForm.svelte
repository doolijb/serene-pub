<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"
	import type { SocketEventMap } from "$lib/client/sockets/typedSocket"
	import { sameFormValue } from "$lib/client/forms/sameFormValue"

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

	let {
		lorebookId,
		hasUnsavedChanges = $bindable(false),
		mode = $bindable("view")
	}: Props = $props()

	const socket = useTypedSocket()

	// Tag-related state
	let tagsList: SelectTag[] = $state([])
	let tagSearchInput = $state("")
	let showTagSuggestions = $state(false)

	// Both "lorebooks:get" and "lorebooks:update" carry `tags`; optional here
	// because a draft is built before either has answered.
	type EditableLorebook = Omit<
		NonNullable<Sockets.Lorebooks.Get.Response["lorebook"]>,
		"tags"
	> & { tags?: string[] }

	let editLorebook: EditableLorebook | undefined = $state()
	let originalLorebook: EditableLorebook | undefined = $state()
	let validationErrors: ValidationErrors = $state({})
	let isLoading = $state(true)
	let loadError = $state("")

	/**
	 * The three fields this form edits, compared the forgiving way
	 * (`sameFormValue`): a description typed and cleared is `""` where the
	 * row held `null`, and tags are a set. The rest of the row is not the
	 * form's, so a push that moves it (a stamp, a count) is not an edit.
	 */
	const editedFields = (l: EditableLorebook | undefined) =>
		l ? { name: l.name, description: l.description, tags: l.tags } : null
	let isDirty = $derived(
		!!editLorebook &&
			!!originalLorebook &&
			!sameFormValue(
				$state.snapshot(editedFields(editLorebook)),
				$state.snapshot(editedFields(originalLorebook)),
				{ unordered: ["tags"] }
			)
	)
	$effect(() => {
		hasUnsavedChanges = isDirty
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
		const updateReq: Sockets.Lorebooks.Update.Params = {
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

	async function handleLorebooksGet(msg: Sockets.Lorebooks.Get.Response) {
		if (msg.lorebook && msg.lorebook.id === lorebookId) {
			// A re-read while edits are open keeps them: the row underneath
			// moves, the three fields being typed in do not.
			const held = isDirty ? editedFields(editLorebook) : null
			editLorebook = held ? { ...msg.lorebook, ...held } : { ...msg.lorebook }
			originalLorebook = { ...msg.lorebook }
			isLoading = false
			loadError = ""
		} else {
			loadError = "Lorebook not found"
			isLoading = false
		}
		await tick() // Force state to update
	}

	async function handleLorebooksUpdate(
		msg: Sockets.Lorebooks.Update.Response
	) {
		if (msg.lorebook && msg.lorebook.id === lorebookId) {
			// The update response carries the row AND its tags as saved
			// (findings #12/#107); an older server's reply without them keeps
			// the ones on screen rather than blanking them.
			const kept = {
				...msg.lorebook,
				tags: msg.lorebook.tags ?? editLorebook?.tags
			}
			editLorebook = kept
			originalLorebook = { ...kept }
			mode = "view"
			toaster.success({
				title: "Lorebook updated",
				description: `Lorebook "${msg.lorebook.name}" updated successfully.`
			})
		}
	}

	function handleTagsList(msg: SocketEventMap["tags:list"]["response"]) {
		tagsList = msg.tagsList || []
	}

	// BARE: the tag list is the whole of this user's tags, not one lorebook's
	// rows, so it has no interest scope to narrow to. Standing, because
	// `tags:list` is a cascade target — a tag created or renamed elsewhere
	// re-sends it.
	useInterest<"tags:list">("tags:list", handleTagsList)

	/**
	 * This book's row, SCOPED to it. The payload carries the id on
	 * `lorebook.id`, and the NOT-FOUND reply carries it on `lorebookId`
	 * instead, so `SCOPED_EVENTS` reads both and this key hears either — which
	 * is why there is NO bare `lorebooks:get` alongside it. A bare key would
	 * have matched every other book's reply too, and on the server it means
	 * the gate passing for every id while this form is open.
	 *
	 * An effect rather than `useInterest` because the key moves: `lorebookId`
	 * is a prop, and `useInterest` keeps the key it was first given. Declared
	 * above `onMount` so the interest exists before its request goes out
	 * (effects run in creation order, and `onMount` is one of them).
	 */
	$effect(() =>
		declareInterest<"lorebooks:get">(
			interestKey("lorebooks:get", lorebookId),
			handleLorebooksGet
		)
	)

	/**
	 * BARE: `lorebooks:update` has no entry in `SCOPED_EVENTS`, so a `#<id>`
	 * key would match no payload at all. `handleLorebooksUpdate`'s own
	 * `msg.lorebook.id === lorebookId` check stays the filter.
	 */
	useInterest<"lorebooks:update">("lorebooks:update", handleLorebooksUpdate)

	onMount(() => {
		// Load tags list
		socket.emit("tags:list", {})

		const lorebookReq: Sockets.Lorebooks.Get.Params = { id: lorebookId }
		socket.emit("lorebooks:get", lorebookReq)
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		// No `socket.off` here at all: the interest registry releases this
		// form's subscribers as its effects are destroyed.
	})
</script>

{#if isLoading}
	<div class="flex items-center justify-center p-4">
		<div class="text-center">
			<Icons.Loader2 size={24} class="mx-auto mb-2 animate-spin" />
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
		<div class="flex flex-col gap-3">
			<div class="flex gap-2">
				<button
					class="btn btn-sm preset-filled-primary-500"
					onclick={() => (mode = "edit")}
				>
					<Icons.Pencil size={14} /> Edit
				</button>
			</div>
			<!-- Name is already shown in the sidebar's header above these
			     tabs — repeating it here would just be noise. -->
			<section class="card preset-filled-surface-100-900 space-y-1 p-3">
				<p
					class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold"
				>
					<Icons.FileText size={13} />
					Description
				</p>
				{#if editLorebook.description}
					<p class="text-sm leading-relaxed whitespace-pre-wrap">
						{editLorebook.description}
					</p>
				{:else}
					<p class="text-surface-700-300 text-sm italic">
						No description yet. Click Edit to add one.
					</p>
				{/if}
			</section>
			{#if editLorebook.tags && editLorebook.tags.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each editLorebook.tags as tagName}
						{@const tag = tagsList.find((t) => t.name === tagName)}
						<span
							class="chip {tag?.colorPreset ||
								'preset-filled-primary-500'}"
						>
							{tagName}
						</span>
					{/each}
				</div>
			{:else}
				<p class="text-surface-700-300 text-sm italic">No tags yet.</p>
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
					class="btn btn-sm preset-filled-primary-500 w-full"
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
						? 'border-error-500'
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
					<p class="text-error-500 mt-1 text-sm" role="alert">
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
										<span
											class="text-surface-600-400 text-sm"
										>
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
							{@const tag = tagsList.find(
								(t) => t.name === tagName
							)}
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
