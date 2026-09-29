<script lang="ts">
	import { Dialog, Portal, Switch } from "@skeletonlabs/skeleton-svelte"
	import { z } from "zod"

	/**
	 * A new lorebook, and the one thing it needs.
	 *
	 * No starting set and no preset: every capability is available in every
	 * lorebook, so there is nothing to choose here that could be chosen wrong.
	 * What the workspace shows follows what the book comes to hold.
	 */
	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		/** `attachToSession` is meaningless unless the switch was offered. */
		onConfirm: (details: { name: string; attachToSession: boolean }) => void
		onCancel: () => void
		/** Closes this and opens the import flow instead. */
		onImportInstead: () => void
		/** Hidden rather than disabled when the switch would do nothing. */
		canOfferAttachToSession?: boolean
		/** What the session the book would be read into is called. */
		sessionName?: string | null
		/** A refusal from the server, shown under the name. */
		error?: string
	}

	let {
		open = $bindable(),
		onOpenChange,
		onConfirm,
		onCancel,
		onImportInstead,
		canOfferAttachToSession = false,
		sessionName = null,
		error
	}: Props = $props()

	const nameSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})

	let name = $state("")
	let attachToSession = $state(true)
	let inputRef: HTMLInputElement | null = $state(null)
	let validationErrors: Record<string, string> = $state({})

	// Re-seed on each open: the dialog stays mounted, so a second open would
	// otherwise inherit the last name typed.
	$effect(() => {
		if (open) {
			name = ""
			attachToSession = true
			validationErrors = {}
		}
	})

	// The cursor lands in the name field, which is the only thing to fill in.
	$effect(() => {
		if (open && inputRef) inputRef.focus()
	})

	const isValid = $derived(
		!!name.trim() && Object.keys(validationErrors).length === 0
	)

	const shownError = $derived(validationErrors.name ?? error)

	function validateForm(): boolean {
		const result = nameSchema.safeParse({ name })
		if (result.success) {
			validationErrors = {}
			return true
		}
		const errors: Record<string, string> = {}
		for (const issue of result.error.errors)
			if (issue.path.length > 0)
				errors[issue.path[0] as string] = issue.message
		validationErrors = errors
		return false
	}

	function confirm() {
		if (!validateForm()) return
		onConfirm({
			name: name.trim(),
			attachToSession: attachToSession && canOfferAttachToSession
		})
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
				class="card bg-surface-100-900 max-h-full max-w-lg space-y-6 overflow-y-auto p-6 shadow-xl"
				role="dialog"
				aria-labelledby="new-lorebook-title"
				aria-describedby="new-lorebook-description"
			>
				<header class="space-y-1">
					<h2 id="new-lorebook-title" class="h2">New lorebook</h2>
					<p
						id="new-lorebook-description"
						class="text-surface-600-400 text-sm"
					>
						One name is all it needs. Everything else, cast, dates,
						nesting, branches, appears as you use it.
					</p>
				</header>
				<article class="space-y-5">
					<div class="form-field">
						<label for="new-lorebook-name" class="font-semibold">
							Name
						</label>
						<input
							id="new-lorebook-name"
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
								? "new-lorebook-name-error"
								: undefined}
							onkeydown={(e) => {
								if (e.key === "Enter" && isValid) confirm()
							}}
							oninput={() => {
								if (validationErrors.name) {
									const { name: _name, ...rest } =
										validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if shownError}
							<p
								id="new-lorebook-name-error"
								class="text-error-500 mt-1 text-sm"
								role="alert"
							>
								{shownError}
							</p>
						{/if}
					</div>

					{#if canOfferAttachToSession}
						<Switch
							name="new-lorebook-attach"
							checked={attachToSession}
							onCheckedChange={(e) =>
								(attachToSession = e.checked)}
							class="flex items-center gap-2"
						>
							<Switch.Control
								class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
							>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
							<Switch.Label class="text-sm">
								{sessionName
									? `Read it into ${sessionName}`
									: "Read it into this session"}
							</Switch.Label>
						</Switch>
					{/if}

					<button
						class="btn btn-sm preset-tonal-surface"
						type="button"
						onclick={onImportInstead}
					>
						Start from an import instead
					</button>
				</article>
				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-filled-surface-500"
						onclick={onCancel}
						type="button"
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-primary-500"
						onclick={confirm}
						disabled={!isValid}
						type="button"
					>
						Create
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
