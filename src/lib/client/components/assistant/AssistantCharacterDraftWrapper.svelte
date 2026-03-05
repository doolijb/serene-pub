<script lang="ts">
	import type { AssistantCreateCharacter } from "$lib/server/db/zodSchemas"
	import CharacterForm from "$lib/client/components/characterForms/CharacterForm.svelte"
	import * as Icons from "@lucide/svelte"
	import { slide } from "svelte/transition"
	import { createEventDispatcher } from "svelte"
	import * as skio from "sveltekit-io"

	let {
		draft,
		validationStatus = null,
		isGenerating = false,
		chatId
	}: {
		draft: AssistantCreateCharacter
		validationStatus?: "valid" | "invalid" | "validating" | null
		isGenerating?: boolean
		chatId?: number
	} = $props()

	const dispatch = createEventDispatcher<{
		save: void
		cancel: void
	}>()

	const socket = skio.get()
	let isExpanded = $state(true)
	let isSafeToClose = $state(true)
	let formComponent: any = $state(undefined)
	let autoSaveTimer: number | null = null
	let disableCallback = $state(false)
	let currentFormData: any = $state(null)

	// Convert draft to compatible format
	const formData = $derived({
		...draft,
		nickname: draft.nickname ?? "",
		personality: draft.personality ?? "",
		scenario: draft.scenario ?? "",
		firstMessage: draft.firstMessage ?? "",
		creatorNotes: draft.creatorNotes ?? "",
		postHistoryInstructions: draft.postHistoryInstructions ?? "",
		characterVersion: draft.characterVersion ?? "",
		groupOnlyGreetings: draft.groupOnlyGreetings ?? [],
		avatar: "",
		_avatar: "",
		_avatarFile: undefined,
		tags: [],
		isFavorite: false,
		lorebookId: null,
		creatorNotesMultilingual: {}
	})

	// Update form when draft prop changes (when assistant generates new content)
	$effect(() => {
		// Track the draft prop changes by watching formData
		const draftStr = JSON.stringify(formData)

		if (formComponent) {
			// Disable callback temporarily while updating from server
			disableCallback = true
			console.log(
				"[AssistantCharacterDraftWrapper] Draft changed, disabling callback temporarily"
			)

			// Use setTimeout to re-enable after form processes the initialData change
			setTimeout(() => {
				disableCallback = false
				console.log(
					"[AssistantCharacterDraftWrapper] Callback re-enabled"
				)
			}, 200)
		}
	})

	// Callback when form data changes
	function handleFormDataChange(data: any) {
		if (isGenerating) {
			console.log(
				"[AssistantCharacterDraftWrapper] Ignoring form data change - generating"
			)
			return
		}

		console.log(
			"[AssistantCharacterDraftWrapper] Form data changed, scheduling auto-save..."
		)
		currentFormData = data
		scheduleAutoSave()
	}

	// Debounced auto-save function
	function scheduleAutoSave() {
		if (!currentFormData) {
			console.log(
				"[AssistantCharacterDraftWrapper] Skipping auto-save schedule - no form data"
			)
			return
		}

		console.log(
			"[AssistantCharacterDraftWrapper] User edit detected, scheduling auto-save in 3 seconds..."
		)

		// Clear existing timer
		if (autoSaveTimer) {
			clearTimeout(autoSaveTimer)
		}

		// Set new timer for auto-save (3 second delay)
		autoSaveTimer = window.setTimeout(() => {
			console.log(
				"[AssistantCharacterDraftWrapper] Auto-save timer fired, saving..."
			)
			saveDraftToDatabase(currentFormData)
		}, 3000)
	}

	function saveDraftToDatabase(updatedData: any) {
		if (!socket || !chatId || isGenerating) {
			console.log(
				"[AssistantCharacterDraftWrapper] Skipping auto-save:",
				{
					hasSocket: !!socket,
					hasChatId: !!chatId,
					isGenerating
				}
			)
			return
		}

		console.log(
			"[AssistantCharacterDraftWrapper] Auto-saving draft to database..."
		)
		console.log(
			"[AssistantCharacterDraftWrapper] Updated data:",
			updatedData
		)

		// Extract only the draft fields (exclude UI-only fields)
		const draftToSave: Partial<AssistantCreateCharacter> = {
			name: updatedData.name,
			description: updatedData.description,
			nickname: updatedData.nickname || undefined,
			personality: updatedData.personality || undefined,
			scenario: updatedData.scenario || undefined,
			firstMessage: updatedData.firstMessage || undefined,
			alternateGreetings: updatedData.alternateGreetings?.length
				? updatedData.alternateGreetings
				: undefined,
			exampleDialogues: updatedData.exampleDialogues?.length
				? updatedData.exampleDialogues
				: undefined,
			creatorNotes: updatedData.creatorNotes || undefined,
			groupOnlyGreetings: updatedData.groupOnlyGreetings?.length
				? updatedData.groupOnlyGreetings
				: undefined,
			postHistoryInstructions:
				updatedData.postHistoryInstructions || undefined,
			source: updatedData.source?.length ? updatedData.source : undefined,
			characterVersion: updatedData.characterVersion || undefined
		}

		console.log(
			"[AssistantCharacterDraftWrapper] Emitting assistant:updateDraft with:",
			draftToSave
		)

		// Update the draft in chat metadata via socket
		socket.emit(
			"assistant:updateDraft",
			{
				chatId,
				draft: draftToSave
			},
			(response: { success: boolean; error?: string }) => {
				if (response.success) {
					console.log(
						"[AssistantCharacterDraftWrapper] Draft auto-saved successfully"
					)
				} else {
					console.error(
						"[AssistantCharacterDraftWrapper] Failed to auto-save draft:",
						response.error
					)
				}
			}
		)
	}

	function handleSave() {
		dispatch("save")
	}

	function handleCancel() {
		dispatch("cancel")
	}

	function toggleExpanded() {
		isExpanded = !isExpanded
	}
</script>

<div class="border-surface-300-700 bg-surface-50-950 border-b">
	<!-- Header Bar -->
	<div
		class="border-surface-300-700 flex items-center justify-between border-b px-4 py-3"
	>
		<div class="flex items-center gap-3">
			<button
				type="button"
				class="btn btn-icon btn-icon-sm variant-ghost-surface"
				onclick={toggleExpanded}
				aria-label={isExpanded ? "Collapse draft" : "Expand draft"}
			>
				{#if isExpanded}
					<Icons.ChevronDown class="h-4 w-4" />
				{:else}
					<Icons.ChevronRight class="h-4 w-4" />
				{/if}
			</button>
			<h2 class="text-lg font-semibold">Character Draft</h2>
			{#if validationStatus === "valid"}
				<span class="badge variant-filled-success text-xs">Valid</span>
			{:else if validationStatus === "invalid"}
				<span class="badge variant-filled-error text-xs">Invalid</span>
			{:else if validationStatus === "validating"}
				<span class="badge variant-filled-surface text-xs">
					Validating...
				</span>
			{/if}
			{#if isGenerating}
				<span class="badge variant-filled-warning text-xs">
					<Icons.Loader2
						class="mr-1 inline-block h-3 w-3 animate-spin"
					/>
					Generating...
				</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="btn btn-sm variant-ghost-surface"
				onclick={handleCancel}
				disabled={isGenerating}
			>
				<Icons.X class="h-4 w-4" />
				<span>Cancel</span>
			</button>
			<button
				type="button"
				class="btn btn-sm variant-filled-primary"
				onclick={handleSave}
				disabled={validationStatus !== "valid" || isGenerating}
			>
				<Icons.Save class="h-4 w-4" />
				<span>Save Character</span>
			</button>
		</div>
	</div>

	<!-- Collapsible Form Content -->
	{#if isExpanded}
		<div
			class="max-h-[60vh] overflow-y-auto px-4 py-2"
			transition:slide={{ duration: 200 }}
		>
			<CharacterForm
				bind:this={formComponent}
				hideAvatar={true}
				hideActionButtons={true}
				hideFavorite={true}
				hideTitle={true}
				hideTags={true}
				initialData={formData}
				disableDataChangeCallback={disableCallback}
				bind:isSafeToClose
				closeForm={handleSave}
				onCancel={handleCancel}
				onDataChange={handleFormDataChange}
				customTitle="Create Character Preview"
			/>
		</div>
	{/if}
</div>
