<script lang="ts">
	import type { AssistantCreateCharacter } from "$lib/server/db/zodSchemas"
	import type { ZodError } from "zod"
	import { createEventDispatcher } from "svelte"
	import { fade, slide } from "svelte/transition"
	import GeneratingAnimation from "$lib/client/components/chatMessages/GeneratingAnimation.svelte"

	// Props using Svelte 5 runes
	let {
		draft,
		validationStatus = null,
		errors = null,
		generatedFields = [],
		isGenerating = false,
		currentField = null,
		currentFieldIndex = 0,
		totalFields = 0,
		isCorrecting = false,
		correctionAttempt = 0
	}: {
		draft: AssistantCreateCharacter
		validationStatus?: "valid" | "invalid" | "validating" | null
		errors?: ZodError | null
		generatedFields?: string[]
		isGenerating?: boolean
		currentField?: string | null
		currentFieldIndex?: number
		totalFields?: number
		isCorrecting?: boolean
		correctionAttempt?: number
	} = $props()

	// Export a function to clear saving state for a field
	export function clearSavingState(field: string) {
		savingFields.delete(field)
		savingFields = savingFields // Trigger reactivity
	}

	const dispatch = createEventDispatcher<{
		save: void
		cancel: void
		regenerateField: { field: string }
		editField: { field: string; value: any }
		updateField: { field: string; value: any } // For immediate updates via socket
	}>()

	// State
	let isExpanded = true
	let editingField: string | null = $state(null)
	let editingValues: Record<string, any> = $state({})
	let savingFields: Set<string> = $state(new Set())

	// Field labels for display
	const fieldLabels: Record<string, string> = {
		name: "Name",
		description: "Description",
		nickname: "Nickname",
		personality: "Personality",
		scenario: "Scenario",
		firstMessage: "First Message",
		alternateGreetings: "Alternate Greetings",
		exampleDialogues: "Example Dialogues",
		creatorNotes: "Creator Notes",
		groupOnlyGreetings: "Group Only Greetings",
		postHistoryInstructions: "Post-History Instructions",
		source: "Source",
		characterVersion: "Version"
	}

	// Get error message for a field
	function getFieldError(field: string): string | null {
		if (!errors) return null
		const issue = errors.issues.find((i) => i.path.includes(field))
		return issue ? issue.message : null
	}

	// Check if field is valid
	function isFieldValid(field: string): boolean {
		return generatedFields.includes(field) && !getFieldError(field)
	}

	// Handle save
	function handleSave() {
		if (validationStatus === "valid") {
			dispatch("save")
		}
	}

	// Handle cancel
	function handleCancel() {
		dispatch("cancel")
	}

	// Handle regenerate field
	function handleRegenerateField(field: string) {
		dispatch("regenerateField", { field })
	}

	// Handle field edit
	function handleFieldEdit(field: string, value: any) {
		dispatch("editField", { field, value })
	}

	// Start editing a field
	function startEditing(field: string, currentValue: any) {
		editingField = field
		editingValues[field] = currentValue
	}

	// Save field edit
	function saveFieldEdit(field: string) {
		const newValue = editingValues[field]

		// Don't save if value hasn't changed
		if (newValue === (draft as any)[field]) {
			editingField = null
			return
		}

		// Add to saving set
		savingFields.add(field)

		// Dispatch update event
		dispatch("updateField", { field, value: newValue })

		// Clear editing state
		editingField = null
	}

	// Cancel field edit
	function cancelFieldEdit() {
		editingField = null
	}

	// Handle field blur
	function handleFieldBlur(field: string) {
		// Small delay to allow click events on buttons
		setTimeout(() => {
			if (editingField === field) {
				saveFieldEdit(field)
			}
		}, 100)
	}

	// Handle keydown in field
	function handleFieldKeydown(event: KeyboardEvent, field: string) {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			field !== "description" &&
			field !== "personality" &&
			field !== "scenario"
		) {
			event.preventDefault()
			saveFieldEdit(field)
		} else if (event.key === "Escape") {
			cancelFieldEdit()
		}
	}

	// Format array values for display
	function formatArrayValue(value: string[] | undefined | null): string {
		if (!value || value.length === 0) return "Not set"
		return value.join("\n• ")
	}

	// Get all fields that exist in the draft
	let draftFields = $derived(
		Object.entries(draft).filter(
			([key, value]) =>
				value !== null && value !== undefined && value !== ""
		)
	)

	// Count valid/invalid fields
	let validFieldCount = $derived(
		generatedFields.filter((f) => isFieldValid(f)).length
	)
	let invalidFieldCount = $derived(
		generatedFields.filter((f) => !isFieldValid(f)).length
	)
</script>

<div class="character-draft-preview" transition:fade={{ duration: 200 }}>
	<!-- Header -->
	<div class="header">
		<div class="title-section">
			<h3>Character Draft Preview</h3>
			{#if isGenerating}
				<GeneratingAnimation text="Generating" />
			{:else if validationStatus === "validating"}
				<GeneratingAnimation text="Validating" />
			{:else if isCorrecting}
				<span class="status-badge correcting">
					Auto-correcting (attempt {correctionAttempt}/3)
				</span>
			{:else if validationStatus === "valid"}
				<span class="status-badge valid">✓ Valid</span>
			{:else if validationStatus === "invalid"}
				<span class="status-badge invalid">⚠ Needs Review</span>
			{/if}

			<button
				class="collapse-btn"
				on:click={() => (isExpanded = !isExpanded)}
				title={isExpanded ? "Collapse" : "Expand"}
			>
				{isExpanded ? "▼" : "▶"}
			</button>
		</div>

		{#if isGenerating && totalFields > 0}
			<div class="progress-bar">
				<div class="progress-text">
					Generating field {currentFieldIndex + 1} of {totalFields}
					{#if currentField}
						<span class="current-field">
							({fieldLabels[currentField]})
						</span>
					{/if}
				</div>
				<div class="progress-track">
					<div
						class="progress-fill"
						style="width: {(
							(currentFieldIndex / totalFields) *
							100
						).toFixed(0)}%"
					></div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Draft Fields (Collapsible) -->
	{#if isExpanded}
		<div class="fields-container" transition:slide={{ duration: 200 }}>
			{#each draftFields as [field, value]}
				<div class="field-item">
					<div class="field-header">
						<div class="field-label">
							{fieldLabels[field] || field}
							{#if generatedFields.includes(field)}
								{#if isFieldValid(field)}
									<span class="field-status valid">✓</span>
								{:else}
									<span class="field-status invalid">⚠</span>
								{/if}
							{/if}
						</div>
						<button
							class="regenerate-btn"
							on:click={() => handleRegenerateField(field)}
							disabled={isGenerating}
							title="Regenerate this field"
						>
							🔄
						</button>
					</div>

					{#if Array.isArray(value)}
						<div class="field-value array">
							{#if editingField === field}
								<textarea
									bind:value={editingValues[field]}
									on:blur={() => handleFieldBlur(field)}
									on:keydown={(e) =>
										handleFieldKeydown(e, field)}
									class="editable-textarea"
									rows={5}
									placeholder="Enter items, one per line"
									autofocus
								/>
							{:else}
								<div
									class="field-content editable"
									class:saving={savingFields.has(field)}
									on:click={() =>
										startEditing(field, value.join("\n"))}
									role="button"
									tabindex="0"
									on:keydown={(e) =>
										e.key === "Enter" &&
										startEditing(field, value.join("\n"))}
								>
									{#if value.length > 0}
										<ul>
											{#each value as item}
												<li>{item}</li>
											{/each}
										</ul>
									{:else}
										<span class="empty">
											Click to add items...
										</span>
									{/if}
									{#if savingFields.has(field)}
										<span class="saving-indicator">
											Saving...
										</span>
									{/if}
								</div>
							{/if}
						</div>
					{:else}
						<div class="field-value">
							{#if editingField === field}
								{#if field === "description" || field === "personality" || field === "scenario"}
									<textarea
										bind:value={editingValues[field]}
										on:blur={() => handleFieldBlur(field)}
										on:keydown={(e) =>
											handleFieldKeydown(e, field)}
										class="editable-textarea"
										rows={6}
										placeholder={`Enter ${fieldLabels[field] || field}...`}
										autofocus
									/>
								{:else}
									<input
										type="text"
										bind:value={editingValues[field]}
										on:blur={() => handleFieldBlur(field)}
										on:keydown={(e) =>
											handleFieldKeydown(e, field)}
										class="editable-input"
										placeholder={`Enter ${fieldLabels[field] || field}...`}
										autofocus
									/>
								{/if}
							{:else}
								<div
									class="field-content editable"
									class:saving={savingFields.has(field)}
									on:click={() => startEditing(field, value)}
									role="button"
									tabindex="0"
									on:keydown={(e) =>
										e.key === "Enter" &&
										startEditing(field, value)}
								>
									{value || "(empty)"}
									{#if savingFields.has(field)}
										<span class="saving-indicator">
											Saving...
										</span>
									{/if}
								</div>
							{/if}
						</div>
					{/if}

					{#if getFieldError(field)}
						<div
							class="field-error"
							transition:slide={{ duration: 150 }}
						>
							⚠️ {getFieldError(field)}
						</div>
					{/if}
				</div>
			{/each}

			{#if draftFields.length === 0}
				<div class="empty-state">
					<p>No fields generated yet...</p>
				</div>
			{/if}
		</div>

		<!-- Global Errors -->
		{#if errors && errors.issues.length > invalidFieldCount}
			<div class="global-errors" transition:slide={{ duration: 200 }}>
				<h4>Additional Issues:</h4>
				<ul>
					{#each errors.issues.filter((i) => !i.path || i.path.length === 0) as issue}
						<li>{issue.message}</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}

	<!-- Actions -->
	<div class="actions">
		<button
			class="btn btn-secondary"
			on:click={handleCancel}
			disabled={isGenerating}
		>
			Cancel
		</button>
		<button
			class="btn btn-primary"
			on:click={handleSave}
			disabled={isGenerating || validationStatus !== "valid"}
		>
			Save Character
		</button>
	</div>
</div>

<style>
	.character-draft-preview {
		background: var(--surface-2);
		border: 1px solid var(--border-color);
		border-radius: 8px;
	}

	.header {
		margin-bottom: 0.75rem;
		padding: 1rem 1rem 0 1rem;
	}

	.title-section {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.title-section h3 {
		margin: 0;
		font-size: 1.125rem;
		color: var(--text-primary);
	}

	.collapse-btn {
		margin-left: auto;
		background: transparent;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		cursor: pointer;
		font-size: 0.875rem;
		color: var(--text-secondary);
		transition: all 0.2s;
	}

	.collapse-btn:hover {
		background: var(--surface-3);
		color: var(--text-primary);
	}

	.status-badge {
		padding: 0.25rem 0.625rem;
		border-radius: 4px;
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.status-badge.valid {
		background: var(--success-bg, #d4edda);
		color: var(--success-text, #155724);
	}

	.status-badge.invalid {
		background: var(--warning-bg, #fff3cd);
		color: var(--warning-text, #856404);
	}

	.status-badge.correcting {
		background: var(--info-bg, #d1ecf1);
		color: var(--info-text, #0c5460);
	}

	.progress-bar {
		margin-top: 0.5rem;
	}

	.progress-text {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin-bottom: 0.375rem;
	}

	.current-field {
		font-weight: 500;
		color: var(--text-primary);
	}

	.progress-track {
		height: 4px;
		background: var(--surface-3);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--primary-color);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.fields-container {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		margin-bottom: 0.75rem;
		max-height: 400px;
		overflow-y: auto;
		padding: 0 1rem;
	}

	/* Custom scrollbar */
	.fields-container::-webkit-scrollbar {
		width: 6px;
	}

	.fields-container::-webkit-scrollbar-track {
		background: var(--surface-1);
		border-radius: 3px;
	}

	.fields-container::-webkit-scrollbar-thumb {
		background: var(--border-color);
		border-radius: 3px;
	}

	.fields-container::-webkit-scrollbar-thumb:hover {
		background: var(--text-tertiary);
	}

	.field-item {
		background: var(--surface-1);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0.75rem;
	}

	.field-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.375rem;
	}

	.field-label {
		font-weight: 600;
		color: var(--text-primary);
		font-size: 0.8125rem;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.field-status {
		font-size: 0.875rem;
	}

	.field-status.valid {
		color: var(--success-text, #155724);
	}

	.field-status.invalid {
		color: var(--warning-text, #856404);
	}

	.regenerate-btn {
		background: transparent;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		padding: 0.1875rem 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		transition: all 0.2s;
	}

	.regenerate-btn:hover:not(:disabled) {
		background: var(--surface-3);
		transform: rotate(180deg);
	}

	.regenerate-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.field-value {
		padding: 0.625rem;
		background: var(--surface-2);
		border-radius: 4px;
		color: var(--text-primary);
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.5;
		font-size: 0.875rem;
		position: relative;
	}

	.field-content {
		min-height: 1.5rem;
	}

	.field-content.editable {
		cursor: text;
		padding: 0.5rem;
		margin: -0.5rem;
		border-radius: 4px;
		transition:
			background-color 0.2s,
			box-shadow 0.2s;
	}

	.field-content.editable:hover {
		background: var(--surface-3);
		box-shadow: 0 0 0 1px var(--border-color);
	}

	.field-content.editable:focus {
		outline: none;
		box-shadow: 0 0 0 2px var(--primary-color);
	}

	.field-content.saving {
		opacity: 0.6;
		pointer-events: none;
	}

	.saving-indicator {
		position: absolute;
		top: 0.375rem;
		right: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-style: italic;
	}

	.editable-input,
	.editable-textarea {
		width: 100%;
		padding: 0.5rem;
		background: var(--surface-1);
		border: 2px solid var(--primary-color);
		border-radius: 4px;
		color: var(--text-primary);
		font-family: inherit;
		font-size: 0.875rem;
		line-height: 1.5;
		resize: vertical;
		transition: border-color 0.2s;
	}

	.editable-input:focus,
	.editable-textarea:focus {
		outline: none;
		border-color: var(--primary-hover);
		box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.1);
	}

	.editable-textarea {
		min-height: 100px;
	}

	.field-value.array ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.field-value.array li {
		margin-bottom: 0.25rem;
	}

	.field-value .empty {
		color: var(--text-tertiary);
		font-style: italic;
	}

	.field-error {
		margin-top: 0.375rem;
		padding: 0.375rem 0.5rem;
		background: var(--error-bg, #f8d7da);
		color: var(--error-text, #721c24);
		border-radius: 4px;
		font-size: 0.8125rem;
	}

	.empty-state {
		text-align: center;
		padding: 1.5rem;
		color: var(--text-tertiary);
		font-size: 0.875rem;
	}

	.global-errors {
		background: var(--error-bg, #f8d7da);
		border: 1px solid var(--error-border, #f5c6cb);
		border-radius: 6px;
		padding: 0.75rem;
		margin: 0 1rem 0.75rem 1rem;
	}

	.global-errors h4 {
		margin: 0 0 0.375rem 0;
		color: var(--error-text, #721c24);
		font-size: 0.8125rem;
	}

	.global-errors ul {
		margin: 0;
		padding-left: 1.25rem;
		color: var(--error-text, #721c24);
		font-size: 0.8125rem;
	}

	.actions {
		display: flex;
		gap: 0.625rem;
		justify-content: flex-end;
		padding: 0.75rem 1rem 1rem 1rem;
		border-top: 1px solid var(--border-color);
	}

	.btn {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		border: none;
		font-size: 0.8125rem;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-primary {
		background: var(--primary-color);
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--primary-hover);
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.btn-secondary {
		background: transparent;
		color: var(--text-primary);
		border: 1px solid var(--border-color);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--surface-3);
	}
</style>
