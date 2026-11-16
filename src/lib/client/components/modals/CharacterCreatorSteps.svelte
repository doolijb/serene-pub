<script lang="ts">
	/**
	 * The character creator's step panes. `CharacterCreatorModal` loads this
	 * when it opens, so the panes (and the avatar crop editor) stay off the
	 * first page. The modal owns all state; this renders it and calls back.
	 */
	import * as Icons from "@lucide/svelte"
	import Avatar from "../Avatar.svelte"
	import FileDropzone from "../FileDropzone.svelte"
	import AvatarCropEditor from "../media/AvatarCropEditor.svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import type { MediaFrame } from "$lib/shared/media/frame"

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

	interface Props {
		currentStep: number
		characterData: CharacterData
		validationErrors: Record<string, string>
		cropOpen: boolean
		cropSrc: string
		cropFrame: MediaFrame | null
		handleAvatarChange: (details: FileAcceptDetails) => void
		onCropSaved: (frame: MediaFrame | null) => void
		clearAvatarSelection: () => void
		clearValidationError: (field: string) => void
	}

	let {
		currentStep,
		characterData = $bindable(),
		validationErrors,
		cropOpen = $bindable(),
		cropSrc,
		cropFrame,
		handleAvatarChange,
		onCropSaved,
		clearAvatarSelection,
		clearValidationError
	}: Props = $props()

	/**
	 * Unique per creator instance. Several creators can be open at once — the
	 * characters panel's, the home page's character and persona creators — so
	 * the steps take their ids from `$props.id()`; every `<label for>` and
	 * `aria-describedby` resolves inside its own creator (2026-09-17). Same
	 * idiom as `MessageComposer` and `EntryFireTest`.
	 */
	const uid = $props.id()
	const ids = {
		name: `${uid}-name`,
		nameError: `${uid}-name-error`,
		nickname: `${uid}-nickname`,
		description: `${uid}-description`,
		descriptionError: `${uid}-description-error`,
		personality: `${uid}-personality`,
		firstMessage: `${uid}-first-message`
	}
</script>

{#if currentStep === 0}
	<!-- Step 1: Name & Nickname -->
	<div class="space-y-6">
		<div class="space-y-2 text-center">
			<h3 class="h3">Let's start with the basics</h3>
		</div>

		<div class="space-y-4">
			<!-- Name Field -->
			<div class="space-y-2">
				<label class="flex gap-1 font-semibold" for={ids.name}>
					Name*
					<span
						class="duration-fast flex items-center opacity-50 transition-opacity hover:opacity-100"
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
					id={ids.name}
					type="text"
					bind:value={characterData.name}
					class="input {validationErrors.name
						? 'border-error-500 focus:border-error-500'
						: ''}"
					placeholder="Enter character name..."
					aria-required="true"
					aria-invalid={validationErrors.name ? "true" : "false"}
					aria-describedby={validationErrors.name
						? ids.nameError
						: undefined}
					oninput={() => clearValidationError("name")}
				/>
				{#if validationErrors.name}
					<p
						class="text-error-600-400 mt-1 text-sm"
						id={ids.nameError}
						role="alert"
					>
						{validationErrors.name}
					</p>
				{/if}
			</div>

			<!-- Nickname Field -->
			<div class="space-y-2">
				<label class="flex gap-1 font-semibold" for={ids.nickname}>
					Nickname (Optional)
					<span
						class="duration-fast flex items-center opacity-50 transition-opacity hover:opacity-100"
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
					id={ids.nickname}
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
			<h4 class="mb-3 flex items-center gap-2 text-sm font-semibold">
				<Icons.Sparkles size={16} class="text-primary-500" />
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
						The character's full or primary name (e.g., "Elizabeth Bennet",
						"Sherlock Holmes")
					</p>
					<p>
						<strong>Nickname:</strong>
						A shorter, informal name or title (e.g., "Lizzy", "Detective
						Holmes"). If provided, the nickname will be used in conversations
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
				Upload an image to represent your character. This step is
				optional but helps personalize your character.
			</p>
		</div>

		<!-- The crop editor renders in place: this modal is a
		     dialog already, and a second dialog would sit
		     outside its content — hidden and unclickable. -->
		<AvatarCropEditor
			inline
			open={cropOpen}
			onOpenChange={(e) => (cropOpen = e.open)}
			src={cropSrc}
			frame={cropFrame}
			subject={`${
				characterData.nickname || characterData.name || "this character"
			}'s avatar`}
			onSave={onCropSaved}
		/>
		<div class="flex items-center gap-6" hidden={cropOpen}>
			<!-- Avatar Preview -->
			<div class="flex-shrink-0">
				<Avatar
					src={characterData._avatar || avatarSrc(characterData)}
					char={characterData}
					size="xl"
				/>
			</div>

			<!-- Upload Area -->
			<div class="flex-1 space-y-3">
				<FileDropzone
					name="character-avatar"
					accept="image/*"
					hint="PNG, JPG or GIF"
					onFileAccept={handleAvatarChange}
				/>

				{#if characterData._avatarFile}
					<button
						type="button"
						class="btn btn-sm preset-tonal w-full"
						onclick={() => (cropOpen = true)}
					>
						<Icons.Crop size={16} />
						Adjust crop
					</button>
					<button
						type="button"
						class="btn btn-sm preset-tonal-error w-full"
						onclick={clearAvatarSelection}
					>
						<Icons.Trash2 size={16} />
						Remove image
					</button>
				{/if}
				<p class="text-xs opacity-60">
					Supported formats: JPG, PNG, GIF. The image will be resized
					automatically to fit the interface.
				</p>
			</div>
		</div>

		<!-- Example -->
		<div class="bg-primary-500/10 rounded-lg p-4">
			<h4 class="mb-2 flex items-center gap-2 text-sm font-semibold">
				<Icons.Sparkles size={16} class="text-primary-500" />
				Tip
			</h4>
			<p class="text-sm opacity-75">
				A good avatar helps bring your character to life and makes
				conversations more engaging. You can always change it later.
			</p>
		</div>
	</div>
{:else if currentStep === 2}
	<!-- Step 3: Description -->
	<div class="space-y-6">
		<div class="space-y-2 text-center">
			<h3 class="h3">Describe your character</h3>
			<p class="text-sm opacity-75">
				Write a description that captures your character's appearance,
				background, and key traits. This is essential for the AI to
				understand your character.
			</p>
		</div>

		<div class="space-y-2">
			<label class="flex gap-1 font-semibold" for={ids.description}>
				Description*
				<span
					class="duration-fast flex items-center opacity-50 transition-opacity hover:opacity-100"
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
				id={ids.description}
				rows="8"
				bind:value={characterData.description}
				class="input {validationErrors.description
					? 'border-error-500 focus:border-error-500'
					: ''}"
				placeholder="Describe your character..."
				aria-required="true"
				aria-invalid={validationErrors.description ? "true" : "false"}
				aria-describedby={validationErrors.description
					? ids.descriptionError
					: undefined}
				oninput={() => clearValidationError("description")}
			></textarea>
			{#if validationErrors.description}
				<p
					class="text-error-600-400 mt-1 text-sm"
					id={ids.descriptionError}
					role="alert"
				>
					{validationErrors.description}
				</p>
			{/if}
			<div class="space-y-2 text-xs opacity-60">
				<p>
					<strong>Include:</strong>
					Physical appearance, age, background, occupation, or role
				</p>
				<p>
					<strong>Avoid:</strong>
					Personality traits (save for the next step), specific scenarios,
					or conversations
				</p>
			</div>
		</div>

		<!-- Example -->
		<div class="bg-primary-500/10 rounded-lg p-4">
			<h4 class="mb-2 flex items-center gap-2 text-sm font-semibold">
				<Icons.Sparkles size={16} class="text-primary-500" />
				Example
			</h4>
			<p class="text-sm opacity-75">
				"Dr. John Watson is a former army doctor in his late 30s with
				short blonde hair and kind blue eyes. He's practical, loyal, and
				brave, often serving as the moral compass to his brilliant but
				eccentric flatmate. Having served in Afghanistan, he brings
				medical expertise and military discipline to their adventures."
			</p>
		</div>
	</div>
{:else if currentStep === 3}
	<!-- Step 4: Personality -->
	<div class="space-y-6">
		<div class="space-y-2 text-center">
			<h3 class="h3">Define their personality</h3>
			<p class="text-sm opacity-75">
				Describe how your character thinks, feels, and behaves. This
				step is optional but helps create more authentic interactions.
			</p>
		</div>

		<div class="space-y-2">
			<label class="flex gap-1 font-semibold" for={ids.personality}>
				Personality (Optional)
				<span
					class="duration-fast flex items-center opacity-50 transition-opacity hover:opacity-100"
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
				id={ids.personality}
				rows="6"
				bind:value={characterData.personality}
				class="input"
				placeholder="Describe their personality traits and quirks..."
				aria-label="Character personality"
			></textarea>
			<div class="space-y-2 text-xs opacity-60">
				<p>
					<strong>Include:</strong>
					Personality traits, values, quirks, speaking style, emotional
					tendencies
				</p>
				<p>
					Is your character "optimistic and curious", "sarcastic but
					caring", or "methodical and analytical"?
				</p>
				<p>
					This helps the AI understand how your character should
					behave and respond in conversations.
				</p>
			</div>
		</div>

		<!-- Example -->
		<div class="bg-primary-500/10 rounded-lg p-4">
			<h4 class="mb-2 flex items-center gap-2 text-sm font-semibold">
				<Icons.Sparkles size={16} class="text-primary-500" />
				Example
			</h4>
			<p class="text-sm opacity-75">
				"Watson is patient and methodical, with a dry sense of humor.
				He's fiercely loyal to his friends and has a strong moral
				compass. While not as brilliant as Holmes, he's practical and
				grounded, often providing the emotional intelligence that Holmes
				lacks. He tends to be modest about his own abilities."
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
				. The first message teaches the AI how your character acts, speaks,
				and responds.
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
						that shows the AI your character's voice, tone, and behavior
						patterns. It significantly improves response quality.
					</p>
				</div>
			</div>
		</div>

		<div class="space-y-2">
			<label class="font-semibold" for={ids.firstMessage}>
				First message (optional but recommended)
			</label>
			<textarea
				id={ids.firstMessage}
				rows="6"
				bind:value={characterData.firstMessage}
				class="input"
				placeholder="Write their opening message..."
				aria-label="Character first message"
			></textarea>
			<p class="text-xs opacity-60">
				This serves as a <strong>training example</strong>
				that helps the AI understand your character's communication style
				and behavior patterns.
			</p>
		</div>

		<!-- Example -->
		<div class="bg-primary-500/10 rounded-lg p-4">
			<h4 class="mb-2 flex items-center gap-2 text-sm font-semibold">
				<Icons.Sparkles size={16} class="text-primary-500" />
				Example with key elements
			</h4>
			<div class="space-y-3">
				<p class="text-sm italic opacity-75">
					"*Dr. Watson looks up from his medical journal, adjusting
					his reading glasses with a warm smile* Ah, good to see you!
					I was just reviewing some fascinating case notes. Please,
					have a seat and tell me - what brings you to Baker Street
					today?"
				</p>
				<div
					class="border-primary-500/20 border-t pt-3 text-xs opacity-60"
				>
					<p class="mb-1">
						<strong>Notice how this example:</strong>
					</p>
					<ul class="list-inside list-disc space-y-1">
						<li>Uses *asterisks* for actions and descriptions</li>
						<li>Shows personality through warm, welcoming tone</li>
						<li>
							Establishes setting (Baker Street, medical context)
						</li>
						<li>Demonstrates speaking patterns and vocabulary</li>
						<li>
							Ends with an engaging question to continue
							conversation
						</li>
					</ul>
				</div>
			</div>
		</div>
	</div>
{/if}
