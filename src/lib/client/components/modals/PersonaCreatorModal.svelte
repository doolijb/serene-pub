<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onDestroy, onMount } from "svelte"
	import { z } from "zod"
	import Avatar from "../Avatar.svelte"
	import Dropzone from "../Dropzone.svelte"

	interface Props {
		open: boolean
		onOpenChange?: (e: { open: boolean }) => void
	}

	let { open = $bindable(), onOpenChange }: Props = $props()

	const socket = useTypedSocket()

	// Persona data interface
	interface PersonaData {
		name: string
		description: string
		avatar: string
		isDefault: boolean
		_avatarFile?: File | undefined
		_avatar?: string
	}

	// Zod validation schema (only required fields for creation)
	const personaSchema = z.object({
		name: z.string().min(1, "Name is required").trim(),
		description: z.string().min(1, "Description is required").trim(),
		isDefault: z.boolean().optional()
	})

	type ValidationErrors = Record<string, string>

	// State
	let currentStep = $state(0)
	let personaData: PersonaData = $state({
		name: "",
		description: "",
		avatar: "",
		isDefault: false,
		_avatarFile: undefined,
		_avatar: ""
	})
	let validationErrors: ValidationErrors = $state({})
	let showCancelConfirmation = $state(false)

	// Step definitions
	const steps = [
		{ title: "Name", canSkip: false },
		{ title: "Avatar", canSkip: true },
		{ title: "Description", canSkip: false }
	]

	// Validation functions
	function validateCurrentStep(): boolean {
		const step = steps[currentStep]

		// Only validate required steps
		if (!step.canSkip) {
			if (currentStep === 0) {
				// Step 1: Name is required
				if (!personaData.name.trim()) {
					validationErrors = { name: "Name is required" }
					return false
				}
			} else if (currentStep === 2) {
				// Step 3: Description is required
				if (!personaData.description.trim()) {
					validationErrors = {
						description: "Description is required"
					}
					return false
				}
			}
		}

		validationErrors = {}
		return true
	}

	function validateFinalForm(): boolean {
		const result = personaSchema.safeParse(personaData)

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

	// Avatar handling
	function handleAvatarChange(e: Event) {
		const input = e.target as HTMLInputElement | null
		if (!input || !input.files || input.files.length === 0) return
		const file = input.files[0]
		if (!file) return

		// Set preview
		const previewReader = new FileReader()
		previewReader.onload = (ev2) => {
			personaData._avatar = ev2.target?.result as string
		}
		previewReader.readAsDataURL(file)

		// Store file for later upload
		personaData._avatarFile = file
	}

	// Navigation functions
	function handleNext() {
		// Validate current step if it's required
		if (!steps[currentStep].canSkip && !validateCurrentStep()) {
			return
		}

		if (currentStep < steps.length - 1) {
			currentStep++
		}
	}

	function handlePrevious() {
		if (currentStep > 0) {
			currentStep--
		}
	}

	function handleSave() {
		if (!validateFinalForm()) {
			// Find the first step with validation errors and go to it
			if (validationErrors.name) {
				currentStep = 0
			} else if (validationErrors.description) {
				currentStep = 2
			}
			return
		}

		// Prepare persona data for creation
		const newPersona = {
			...personaData,
			position: 0
		}

		const avatarFile = newPersona._avatarFile
		delete newPersona._avatarFile
		delete newPersona._avatar

		socket.emit("personas:create", {
			persona: newPersona,
			// Client holds a browser File; the server receives it deserialized
			// via socket.io as a Buffer — see the same pattern in
			// PersonaForm.svelte/CharacterForm.svelte.
			avatarFile: avatarFile as unknown as Buffer | undefined
		})
	}

	function resetForm() {
		// Reset form data
		personaData = {
			name: "",
			description: "",
			avatar: "",
			isDefault: false,
			_avatarFile: undefined,
			_avatar: ""
		}
		validationErrors = {}
		currentStep = 0
		open = false
	}

	function handleCancel() {
		if (hasUnsavedData) {
			showCancelConfirmation = true
		} else {
			resetForm()
		}
	}

	function handleCancelConfirm() {
		showCancelConfirmation = false
		resetForm()
	}

	function handleCancelCancel() {
		showCancelConfirmation = false
	}

	function clearValidationError(field: string) {
		if (validationErrors[field]) {
			const { [field]: removed, ...rest } = validationErrors
			validationErrors = rest
		}
	}

	// Computed properties
	let isLastStep = $derived(currentStep === steps.length - 1)
	let isFirstStep = $derived(currentStep === 0)
	let canProceedToNext = $derived(() => {
		// Always allow proceeding on optional steps
		if (steps[currentStep].canSkip) return true

		// For required steps, validate the current step
		return validateCurrentStep()
	})

	// Check if any fields are populated (has unsaved data)
	let hasUnsavedData = $derived(
		personaData.name.trim() !== "" ||
			personaData.description.trim() !== "" ||
			!!personaData._avatarFile
	)

	onMount(() => {
		socket.on("personas:create", (res: any) => {
			if (res.persona) {
				resetForm() // This will close the modal and reset data
			}
		})
	})

	onDestroy(() => {
		socket.off("personas:create")
	})
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open && hasUnsavedData && !showCancelConfirmation) {
			// If trying to close and has unsaved data, show confirmation
			showCancelConfirmation = true
			return
		}
		// Otherwise allow normal close behavior
		onOpenChange?.(e)
	}}
>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
		{#if showCancelConfirmation}
			<!-- Cancel Confirmation View -->
			<header class="flex items-center justify-between">
				<h2 class="h2">Confirm Action</h2>
				<button
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleCancelCancel}
					aria-label="Go back to editing"
				>
					<Icons.X size={16} />
				</button>
			</header>

			<article class="flex min-h-[200px] items-center justify-center">
				<div class="space-y-4 text-center">
					<div class="text-warning-500 mb-4">
						<Icons.AlertTriangle size={48} class="mx-auto" />
					</div>
					<h3 class="h3">Discard Persona?</h3>
					<p class="max-w-md text-sm opacity-75">
						You have unsaved changes to your persona. Are you sure
						you want to discard them and close the creator?
					</p>
				</div>
			</article>

			<footer class="flex justify-end gap-4">
				<button
					class="btn preset-filled-surface-500"
					onclick={handleCancelCancel}
				>
					<Icons.ArrowLeft size={16} />
					Keep Editing
				</button>
				<button
					class="btn preset-filled-error-500"
					onclick={handleCancelConfirm}
				>
					<Icons.Trash2 size={16} />
					Discard Changes
				</button>
			</footer>
		{:else}
			<!-- Normal Form View -->
			<header class="flex items-center justify-between">
				<div>
					<h2 class="h2">Create Persona</h2>
					<p class="text-sm opacity-60">
						Step {currentStep + 1} of {steps.length}: {steps[
							currentStep
						].title}
					</p>
				</div>
				<button
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleCancel}
					aria-label="Close persona creator"
				>
					<Icons.X size={16} />
				</button>
			</header>

			<!-- Progress indicator -->
			<div class="flex gap-2">
				{#each steps as _, index}
					<div
						class="h-2 flex-1 rounded-full {index <= currentStep
							? 'bg-primary-500'
							: 'bg-surface-400'}"
					></div>
				{/each}
			</div>

			<!-- Step content -->
			<article class="min-h-[400px]">
				{#if currentStep === 0}
					<!-- Step 1: Name -->
					<div class="space-y-6">
						<div class="space-y-2 text-center">
							<h3 class="h3">What's your persona's name?</h3>
							<p class="text-sm opacity-75">
								This represents you in conversations. You can
								create multiple personas for different contexts.
							</p>
						</div>

						<div class="space-y-4">
							<!-- Name Field -->
							<div class="space-y-2">
								<label
									class="flex gap-1 font-semibold"
									for="personaCreatorStepName"
								>
									Name*
									<span
										class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
										title="This field will be visible in prompts"
										aria-label="This field will be visible in prompts"
									>
										<Icons.ScanEye
											size={16}
											class="relative top-[1px] inline"
											aria-hidden="true"
										/>
									</span>
								</label>
								<input
									id="personaCreatorStepName"
									type="text"
									bind:value={personaData.name}
									class="input {validationErrors.name
										? 'border-error-500 focus:border-error-500'
										: ''}"
									placeholder="Enter your persona name..."
									aria-required="true"
									aria-invalid={validationErrors.name
										? "true"
										: "false"}
									aria-describedby={validationErrors.name
										? "name-error"
										: undefined}
									oninput={() => clearValidationError("name")}
								/>
								{#if validationErrors.name}
									<p
										class="mt-1 text-sm text-error-500"
										id="name-error"
										role="alert"
									>
										{validationErrors.name}
									</p>
								{/if}
							</div>
						</div>

						<!-- Example -->
						<div class="bg-primary-500/10 rounded-lg p-4">
							<h4
								class="mb-3 flex items-center gap-2 text-sm font-semibold"
							>
								<Icons.Sparkles
									size={16}
									class="text-primary-500"
								/>
								Example & Guidelines
							</h4>
							<div class="space-y-3">
								<div class="space-y-1 text-sm opacity-75">
									<p>
										<strong>Examples:</strong>
										"Alex", "Dr. Smith", "The Investigator"
									</p>
								</div>
								<div
									class="border-primary-500/20 space-y-2 border-t pt-3 text-xs opacity-60"
								>
									<p>
										<strong>Name:</strong>
										Choose something that represents how you
										want to be addressed in conversations. This
										can be your real name, a nickname, or a role-based
										identity.
									</p>
								</div>
							</div>
						</div>
					</div>
				{:else if currentStep === 1}
					<!-- Step 2: Avatar -->
					<div class="space-y-6">
						<div class="space-y-2 text-center">
							<h3 class="h3">Add an avatar</h3>
							<p class="text-sm opacity-75">
								Upload an image to represent yourself. This step
								is optional but helps personalize your persona.
							</p>
						</div>

						<div class="flex items-center gap-6">
							<!-- Avatar Preview -->
							<div class="flex-shrink-0">
								<Avatar
									src={personaData._avatar ||
										personaData.avatar}
									char={personaData}
								/>
							</div>

							<!-- Upload Area -->
							<div class="flex-1 space-y-3">
								<Dropzone id="avatar-upload" onchange={handleAvatarChange} />

								{#if personaData._avatarFile}
									<button
										type="button"
										class="btn btn-sm preset-tonal-error w-full"
										onclick={() => {
											personaData._avatarFile = undefined
											personaData._avatar = ""
										}}
									>
										<Icons.Trash2 size={16} />
										Remove Image
									</button>
								{/if}
								<p class="text-xs opacity-60">
									Supported formats: JPG, PNG, GIF. The image
									will be resized automatically to fit the
									interface.
								</p>
							</div>
						</div>

						<!-- Example -->
						<div class="bg-primary-500/10 rounded-lg p-4">
							<h4
								class="mb-2 flex items-center gap-2 text-sm font-semibold"
							>
								<Icons.Sparkles
									size={16}
									class="text-primary-500"
								/>
								Tip
							</h4>
							<p class="text-sm opacity-75">
								A good avatar helps distinguish your different
								personas and makes conversations more engaging.
								You can always change it later.
							</p>
						</div>
					</div>
				{:else if currentStep === 2}
					<!-- Step 3: Description -->
					<div class="space-y-6">
						<div class="space-y-2 text-center">
							<h3 class="h3">Describe yourself</h3>
							<p class="text-sm opacity-75">
								Write a description that captures your
								background, personality, and how you want to be
								perceived in conversations.
							</p>
						</div>

						<div class="space-y-2">
							<label
								class="flex gap-1 font-semibold"
								for="personaCreatorStepDescription"
							>
								Description*
								<span
									class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
									title="This field will be visible in prompts"
									aria-label="This field will be visible in prompts"
								>
									<Icons.ScanEye
										size={16}
										class="relative top-[1px] inline"
										aria-hidden="true"
									/>
								</span>
							</label>
							<textarea
								id="personaCreatorStepDescription"
								rows="8"
								bind:value={personaData.description}
								class="input {validationErrors.description
									? 'border-error-500 focus:border-error-500'
									: ''}"
								placeholder="Describe yourself and how you want to interact..."
								aria-required="true"
								aria-invalid={validationErrors.description
									? "true"
									: "false"}
								aria-describedby={validationErrors.description
									? "description-error"
									: undefined}
								oninput={() =>
									clearValidationError("description")}
							></textarea>
							{#if validationErrors.description}
								<p
									class="mt-1 text-sm text-error-500"
									id="description-error"
									role="alert"
								>
									{validationErrors.description}
								</p>
							{/if}
							<div class="space-y-2 text-xs opacity-60">
								<p>
									<strong>Include:</strong>
									Your background, interests, communication style,
									or the role you want to play
								</p>
								<p>
									<strong>Examples:</strong>
									"A curious student", "An experienced professional",
									"Someone who loves asking questions"
								</p>
							</div>
						</div>

						<!-- Example -->
						<div class="bg-primary-500/10 rounded-lg p-4">
							<h4
								class="mb-2 flex items-center gap-2 text-sm font-semibold"
							>
								<Icons.Sparkles
									size={16}
									class="text-primary-500"
								/>
								Example
							</h4>
							<p class="text-sm opacity-75">
								"An inquisitive person who enjoys deep
								conversations about philosophy and science. He
								asks thoughtful questions and share insights
								from your background in education. He is an
								empathetic, and genuinely interested in learning
								from others."
							</p>
						</div>
					</div>
				{/if}
			</article>

			<!-- Navigation -->
			<footer class="flex justify-between gap-4">
				<button
					class="btn preset-filled-surface-500"
					onclick={handlePrevious}
					disabled={isFirstStep}
				>
					<Icons.ChevronLeft size={16} />
					Previous
				</button>

				<div class="flex gap-2">
					{#if steps[currentStep].canSkip && !isLastStep}
						<button
							class="btn preset-filled-surface-400-600"
							onclick={handleNext}
						>
							Skip
							<Icons.ChevronRight size={16} />
						</button>
					{/if}

					{#if isLastStep}
						<button
							class="btn preset-filled-success-500"
							onclick={handleSave}
						>
							<Icons.Save size={16} />
							Create Persona
						</button>
					{:else}
						<button
							class="btn preset-filled-primary-500"
							onclick={handleNext}
							disabled={!canProceedToNext}
						>
							Next
							<Icons.ChevronRight size={16} />
						</button>
					{/if}
				</div>
			</footer>
		{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
