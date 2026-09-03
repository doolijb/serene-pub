<script lang="ts">
	import { Dialog, Portal, Switch } from "@skeletonlabs/skeleton-svelte"
	import { z } from "zod"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		/** `checked` is only meaningful when `checkboxLabel` is supplied. */
		onConfirm: (name: string, checked: boolean) => void
		onCancel: () => void
		title?: string
		description?: string
		/**
		 * Opt-in extra toggle. This modal is shared by the Lorebooks, Sampling,
		 * Prompts and Context sidebars — omitting `checkboxLabel` leaves those
		 * three rendering exactly as they did before, which is why this is a
		 * prop rather than a fixed field.
		 *
		 * There is deliberately no disabled state: a caller that only wants the
		 * toggle when it is actionable simply omits the label.
		 */
		checkboxLabel?: string
		checkboxChecked?: boolean
		/**
		 * A refusal from the server, shown under the input.
		 *
		 * Additive and optional: the Lorebooks, Prompts and Context callers pass
		 * nothing and render exactly as before. Sampling passes it because names
		 * are unique per modality, so "Default (Image)" can be taken — and a
		 * caller that keeps this modal OPEN on refusal needs somewhere for the
		 * message to land other than a toast behind the backdrop.
		 */
		error?: string
	}

	let {
		open = $bindable(),
		onOpenChange,
		onConfirm,
		onCancel,
		title,
		description,
		checkboxLabel,
		checkboxChecked = false,
		error
	}: Props = $props()

	let checked = $state(checkboxChecked)

	// Re-seed on each open — the modal stays mounted, so without this a second
	// open would inherit whatever the user left it in last time.
	//
	// The NAME is cleared for the same reason, and it stopped being cosmetic when
	// sampling names became unique per modality: a second Clone arriving
	// pre-filled with the name the first one used is now guaranteed to be
	// refused, so the user had to notice and clear it by hand every time.
	$effect(() => {
		if (open) {
			checked = checkboxChecked
			name = ""
			validationErrors = {}
			staleErrorFor = null
		}
	})

	// Zod validation schema
	const nameSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})

	type ValidationErrors = Record<string, string>

	let name = $state("")
	let inputRef: HTMLInputElement | null = null
	let validationErrors: ValidationErrors = $state({})
	$effect(() => {
		if (open && inputRef) inputRef.focus()
	})
	let isValid = $derived(
		!!name.trim() && Object.keys(validationErrors).length === 0
	)

	/**
	 * The name the server's `error` was raised for.
	 *
	 * A server message describes the value that was SENT. Once the user edits the
	 * field it no longer describes anything on screen, and leaving it up keeps
	 * `aria-invalid="true"` and a `role="alert"` naming a name that is no longer
	 * typed — telling a screen-reader user a valid field is invalid, and giving a
	 * sighted user no way to tell whether the new name was rejected too.
	 */
	let staleErrorFor = $state<string | null>(null)
	$effect(() => {
		if (error) staleErrorFor = name
	})

	// One message under the input, from either source. The local rule wins when
	// both are present: it describes what is wrong with what is typed NOW, while
	// `error` describes the last thing that was sent — and is dropped as soon as
	// the field stops matching what was sent.
	const shownError = $derived(
		validationErrors.name ??
			(staleErrorFor !== null && name === staleErrorFor
				? error
				: undefined)
	)

	function validateForm(): boolean {
		const result = nameSchema.safeParse({ name })

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
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-w-md space-y-6 p-6 shadow-xl"
				role="dialog"
				aria-labelledby="new-name-modal-title"
				aria-describedby="new-name-modal-description"
			>
				<header class="flex justify-between">
					<h2 id="new-name-modal-title" class="h2">
						{title ? title : "Create new"}
					</h2>
				</header>
				<article class="space-y-4">
					{#if description}
						<p
							id="new-name-modal-description"
							class="text-muted-foreground"
						>
							{description}
						</p>
					{/if}
					<div class="form-field">
						<label for="name-input" class="sr-only">Name</label>
						<input
							id="name-input"
							bind:this={inputRef}
							bind:value={name}
							class="input w-full {shownError
								? 'border-error-500'
								: ''}"
							type="text"
							placeholder="Enter a name..."
							aria-required="true"
							aria-invalid={!!shownError}
							aria-describedby={shownError
								? "name-error"
								: undefined}
							onkeydown={(e) => {
								if (e.key === "Enter" && isValid) {
									if (validateForm()) {
										onConfirm(name, checked)
									}
								}
							}}
							oninput={() => {
								if (validationErrors.name) {
									const { name, ...rest } = validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if shownError}
							<p
								id="name-error"
								class="text-error-500 mt-1 text-sm"
								role="alert"
							>
								{shownError}
							</p>
						{/if}
					</div>
					{#if checkboxLabel}
						<Switch
							name="new-name-modal-option"
							{checked}
							onCheckedChange={(e) => (checked = e.checked)}
							class="flex items-center gap-2"
						>
							<Switch.Control
								class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
							>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
							<Switch.Label class="text-sm">
								{checkboxLabel}
							</Switch.Label>
						</Switch>
					{/if}
				</article>
				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-filled-surface-500"
						onclick={onCancel}
						type="button"
						aria-label="Cancel and close modal"
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-primary-500"
						onclick={() => {
							if (validateForm()) {
								onConfirm(name, checked)
							}
						}}
						disabled={!isValid}
						type="button"
						aria-label="Confirm and create new item"
					>
						Confirm
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
