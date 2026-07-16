<script lang="ts">
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { onDestroy, onMount } from "svelte"
	import { z } from "zod"
	import Avatar from "../Avatar.svelte"
	import Dropzone from "../Dropzone.svelte"

	interface Props {
		open: boolean
		onOpenChange?: (e: { open: boolean }) => void
	}

	let { open = $bindable(), onOpenChange }: Props = $props()

	const socket = skio.get()

	// Character data interface
	interface CharacterData {
		name: string
		nickname: string
		avatar: string
		description: string
		personality: string
		firstMessage: string
		_avatarFile?: File | undefined
		_avatar?: string
	}

	// Zod validation schema (same as CharacterForm but only required fields)
	const characterSchema = z.object({
		name: z.string().min(1, "Name is required").trim(),
		nickname: z.string().optional(),
		description: z.string().min(1, "Description is required").trim(),
		personality: z.string().optional(),
		firstMessage: z.string().optional()
	})

	type ValidationErrors = Record<string, string>

	// State
	let currentStep = $state(0)
	let characterData: CharacterData = $state({
		name: "",
		nickname: "",
		avatar: "",
		description: "",
		personality: "",
		firstMessage: "",
		_avatarFile: undefined,
		_avatar: ""
	})
	let validationErrors: ValidationErrors = $state({})
	let showCancelConfirmation = $state(false)

	// Step definitions
	const steps = [
		{ title: "Name", canSkip: false },
		{ title: "Avatar", canSkip: true },
		{ title: "Description", canSkip: false },
		{ title: "Personality", canSkip: true },
		{ title: "First Message", canSkip: true }
	]

	// Validation functions
	function validateCurrentStep(): boolean {
		const step = steps[currentStep]

		// Only validate required steps
		if (!step.canSkip) {
			if (currentStep === 0) {
				// Step 1: Name is required
				if (!characterData.name.trim()) {
					validationErrors = { name: "Name is required" }
					return false
				}
			} else if (currentStep === 2) {
				// Step 3: Description is required
				if (!characterData.description.trim()) {
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
		const result = characterSchema.safeParse(characterData)

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
			characterData._avatar = ev2.target?.result as string
		}
		previewReader.readAsDataURL(file)

		// Store file for later upload
		characterData._avatarFile = file
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

		// Prepare character data for creation
		const newCharacter = {
			...characterData,
			alternateGreetings: [],
			exampleDialogues: [],
			creatorNotes: "",
			creatorNotesMultilingual: {},
			groupOnlyGreetings: [],
			postHistoryInstructions: "",
			isFavorite: false,
			lorebookId: null,
			scenario: ""
		}

		const avatarFile = newCharacter._avatarFile
		delete newCharacter._avatarFile
		delete newCharacter._avatar

		socket.emit("characters:create", {
			character: newCharacter,
			avatarFile
		})
	}

	function resetForm() {
		// Reset form data
		characterData = {
			name: "",
			nickname: "",
			avatar: "",
			description: "",
			personality: "",
			firstMessage: "",
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
		characterData.name.trim() !== "" ||
			characterData.nickname.trim() !== "" ||
			characterData.description.trim() !== "" ||
			characterData.personality.trim() !== "" ||
			characterData.firstMessage.trim() !== "" ||
			!!characterData._avatarFile
	)

	onMount(() => {
		socket.on("characters:create", (res: any) => {
			if (res.character) {
				resetForm() // This will close the modal and reset data
			}
		})
	})

	onDestroy(() => {
		socket.off("characters:create")
	})
</script>

<Modal
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
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
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
					<h3 class="h3">Discard Character?</h3>
					<p class="max-w-md text-sm opacity-75">
						You have unsaved changes to your character. Are you sure
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
					<h2 class="h2">Create Character</h2>
					<p class="text-sm opacity-60">
						Step {currentStep + 1} of {steps.length}: {steps[
							currentStep
						].title}
					</p>
				</div>
				<button
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleCancel}
					aria-label="Close character creator"
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
					<!-- Step 1: Name & Nickname -->
					<div class="space-y-6">
						<div class="space-y-2 text-center">
							<h3 class="h3">Let's start with the basics</h3>
						</div>

						<div class="space-y-4">
							<!-- Name Field -->
							<div class="space-y-2">
								<label
									class="flex gap-1 font-semibold"
									for="stepName"
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
									id="stepName"
									type="text"
									bind:value={characterData.name}
									class="input {validationErrors.name
										? 'border-error-500 focus:border-error-500'
										: ''}"
									placeholder="Enter character name..."
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

							<!-- Nickname Field -->
							<div class="space-y-2">
								<label
									class="flex gap-1 font-semibold"
									for="stepNickname"
								>
									Nickname (Optional)
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
									id="stepNickname"
									type="text"
									bind:value={characterData.nickname}
									class="input"
									placeholder="Enter nickname (optional)..."
									aria-label="Character nickname"
								/>
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
										<strong>Name:</strong>
										"Dr. John Watson"
									</p>
									<p>
										<strong>Nickname:</strong>
										"Watson"
									</p>
								</div>
								<div
									class="border-primary-500/20 space-y-2 border-t pt-3 text-xs opacity-60"
								>
									<p>
										<strong>Name:</strong>
										The character's full or primary name (e.g.,
										"Elizabeth Bennet", "Sherlock Holmes")
									</p>
									<p>
										<strong>Nickname:</strong>
										A shorter, informal name or title (e.g.,
										"Lizzy", "Detective Holmes"). If provided,
										the nickname will be used in conversations
										and prompts instead of the full name.
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
								Upload an image to represent your character.
								This step is optional but helps personalize your
								character.
							</p>
						</div>

						<div class="flex items-center gap-6">
							<!-- Avatar Preview -->
							<div class="flex-shrink-0">
								<Avatar
									src={characterData._avatar ||
										characterData.avatar}
									char={characterData}
								/>
							</div>

							<!-- Upload Area -->
							<div class="flex-1 space-y-3">
								<Dropzone id="avatar-upload" onchange={handleAvatarChange} />

								{#if characterData._avatarFile}
									<button
										type="button"
										class="btn btn-sm preset-tonal-error w-full"
										onclick={() => {
											characterData._avatarFile =
												undefined
											characterData._avatar = ""
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
								A good avatar helps bring your character to life
								and makes conversations more engaging. You can
								always change it later.
							</p>
						</div>
					</div>
				{:else if currentStep === 2}
					<!-- Step 3: Description -->
					<div class="space-y-6">
						<div class="space-y-2 text-center">
							<h3 class="h3">Describe your character</h3>
							<p class="text-sm opacity-75">
								Write a description that captures your
								character's appearance, background, and key
								traits. This is essential for the AI to
								understand your character.
							</p>
						</div>

						<div class="space-y-2">
							<label
								class="flex gap-1 font-semibold"
								for="stepDescription"
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
								id="stepDescription"
								rows="8"
								bind:value={characterData.description}
								class="input {validationErrors.description
									? 'border-error-500 focus:border-error-500'
									: ''}"
								placeholder="Describe your character..."
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
									Physical appearance, age, background, occupation,
									or role
								</p>
								<p>
									<strong>Avoid:</strong>
									Personality traits (save for the next step),
									specific scenarios, or conversations
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
								"Dr. John Watson is a former army doctor in his
								late 30s with short blonde hair and kind blue
								eyes. He's practical, loyal, and brave, often
								serving as the moral compass to his brilliant
								but eccentric flatmate. Having served in
								Afghanistan, he brings medical expertise and
								military discipline to their adventures."
							</p>
						</div>
					</div>
				{:else if currentStep === 3}
					<!-- Step 4: Personality -->
					<div class="space-y-6">
						<div class="space-y-2 text-center">
							<h3 class="h3">Define their personality</h3>
							<p class="text-sm opacity-75">
								Describe how your character thinks, feels, and
								behaves. This step is optional but helps create
								more authentic interactions.
							</p>
						</div>

						<div class="space-y-2">
							<label
								class="flex gap-1 font-semibold"
								for="stepPersonality"
							>
								Personality (Optional)
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
								id="stepPersonality"
								rows="6"
								bind:value={characterData.personality}
								class="input"
								placeholder="Describe their personality traits and quirks..."
								aria-label="Character personality"
							></textarea>
							<div class="space-y-2 text-xs opacity-60">
								<p>
									<strong>Include:</strong>
									Personality traits, values, quirks, speaking
									style, emotional tendencies
								</p>
								<p>
									Is your character "optimistic and curious",
									"sarcastic but caring", or "methodical and
									analytical"?
								</p>
								<p>
									This helps the AI understand how your
									character should behave and respond in
									conversations.
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
								"Watson is patient and methodical, with a dry
								sense of humor. He's fiercely loyal to his
								friends and has a strong moral compass. While
								not as brilliant as Holmes, he's practical and
								grounded, often providing the emotional
								intelligence that Holmes lacks. He tends to be
								modest about his own abilities."
							</p>
						</div>
					</div>
				{:else if currentStep === 4}
					<!-- Step 5: First Message -->
					<div class="space-y-6">
						<div class="space-y-2 text-center">
							<h3 class="h3">Set the opening scene</h3>
							<p class="text-sm opacity-75">
								This is technically optional, but <strong>
									highly recommended
								</strong>
								. The first message teaches the AI how your character
								acts, speaks, and responds.
							</p>
						</div>

						<div
							class="bg-warning-500/10 border-warning-500/20 rounded-lg border p-4"
						>
							<div class="flex items-start gap-3">
								<Icons.Lightbulb
									size={20}
									class="text-warning-500 mt-0.5 flex-shrink-0"
								/>
								<div class="space-y-2 text-sm">
									<p
										class="text-warning-700 dark:text-warning-300 font-semibold"
									>
										Why this matters:
									</p>
									<p>
										The first message is like a <strong>
											writing sample
										</strong>
										that shows the AI your character's voice,
										tone, and behavior patterns. It significantly
										improves response quality.
									</p>
								</div>
							</div>
						</div>

						<div class="space-y-2">
							<label class="font-semibold" for="stepFirstMessage">
								First Message (Optional but Recommended)
							</label>
							<textarea
								id="stepFirstMessage"
								rows="6"
								bind:value={characterData.firstMessage}
								class="input"
								placeholder="Write their opening message..."
								aria-label="Character first message"
							></textarea>
							<p class="text-xs opacity-60">
								This serves as a <strong>
									training example
								</strong>
								that helps the AI understand your character's communication
								style and behavior patterns.
							</p>
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
								Example with Key Elements
							</h4>
							<div class="space-y-3">
								<p class="text-sm italic opacity-75">
									"*Dr. Watson looks up from his medical
									journal, adjusting his reading glasses with
									a warm smile* Ah, good to see you! I was
									just reviewing some fascinating case notes.
									Please, have a seat and tell me - what
									brings you to Baker Street today?"
								</p>
								<div
									class="border-primary-500/20 border-t pt-3 text-xs opacity-60"
								>
									<p class="mb-1">
										<strong>
											Notice how this example:
										</strong>
									</p>
									<ul class="list-inside list-disc space-y-1">
										<li>
											Uses *asterisks* for actions and
											descriptions
										</li>
										<li>
											Shows personality through warm,
											welcoming tone
										</li>
										<li>
											Establishes setting (Baker Street,
											medical context)
										</li>
										<li>
											Demonstrates speaking patterns and
											vocabulary
										</li>
										<li>
											Ends with an engaging question to
											continue conversation
										</li>
									</ul>
								</div>
							</div>
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
							Create Character
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
	{/snippet}
</Modal>
