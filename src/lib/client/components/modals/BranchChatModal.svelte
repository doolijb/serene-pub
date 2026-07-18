<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { z } from "zod"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		onConfirm: (title: string) => void
		onCancel: () => void
		initialTitle?: string
	}

	let {
		open = $bindable(),
		onOpenChange,
		onConfirm,
		onCancel,
		initialTitle = ""
	}: Props = $props()

	// Zod validation schema
	const titleSchema = z.object({
		title: z.string().min(1, "Title is required").trim()
	})

	type ValidationErrors = Record<string, string>

	let title = $state(initialTitle)
	let inputRef: HTMLInputElement | null = null
	let validationErrors: ValidationErrors = $state({})

	// Update title when initialTitle changes
	$effect(() => {
		title = initialTitle
	})

	$effect(() => {
		if (open && inputRef) inputRef.focus()
	})

	let isValid = $derived(
		!!title.trim() && Object.keys(validationErrors).length === 0
	)

	function validateForm(): boolean {
		const result = titleSchema.safeParse({ title })

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
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-md">
				<header class="flex justify-between">
					<h2 id="modal-title" class="h2">Branch Chat</h2>
				</header>
				<article class="space-y-4">
					<p id="modal-description" class="text-muted-foreground">
						Create a new chat branch from this message. The new chat will
						include all messages up to this point.
					</p>
					<div class="form-field">
						<label for="title-input" class="sr-only">Chat Title</label>
						<input
							id="title-input"
							bind:this={inputRef}
							bind:value={title}
							class="input w-full {validationErrors.title
								? 'border-error-500'
								: ''}"
							type="text"
							placeholder="Enter chat title..."
							aria-required="true"
							aria-invalid={!!validationErrors.title}
							aria-describedby={validationErrors.title
								? "title-error"
								: undefined}
							onkeydown={(e) => {
								if (e.key === "Enter" && isValid) {
									if (validateForm()) {
										onConfirm(title)
									}
								}
							}}
							oninput={() => {
								if (validationErrors.title) {
									const { title, ...rest } = validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if validationErrors.title}
							<p
								id="title-error"
								class="mt-1 text-sm text-error-500"
								role="alert"
							>
								{validationErrors.title}
							</p>
						{/if}
					</div>
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
								onConfirm(title)
							}
						}}
						disabled={!isValid}
						type="button"
						aria-label="Create branch chat"
					>
						Branch
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
