<script lang="ts">
	/**
	 * One dialog for both halves of naming a character folder: creating one and
	 * renaming one. They ask the same question with the same field and the same
	 * failure (a name this user already has), so `mode` changes the words and
	 * nothing else — two dialogs would be two places for the error line to
	 * drift.
	 *
	 * The caller owns the socket work. This reports a trimmed name and shows
	 * whatever the server said back, INLINE under the field: a duplicate name is
	 * a correction to make in the box, not a toast that leaves the box looking
	 * accepted.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		mode: "create" | "rename"
		/** The name the field opens on — the folder's own, when renaming. */
		initialName?: string
		/** The server's refusal, shown under the field. Cleared by the caller. */
		error?: string
		/** True between submit and the reply, so the button cannot fire twice. */
		busy?: boolean
		onSubmit: (name: string) => void
		onCancel: () => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		mode,
		initialName = "",
		error = "",
		busy = false,
		onSubmit,
		onCancel
	}: Props = $props()

	let name = $state("")
	/** Local validation, which the field answers before the server is asked. */
	let localError = $state("")

	// Re-seeded every time the dialog opens, so a rename opens on the folder's
	// current name and a create opens empty — and neither inherits the last
	// thing typed into the other.
	$effect(() => {
		if (!open) return
		name = initialName
		localError = ""
	})

	const title = $derived(mode === "create" ? "New folder" : "Rename folder")
	const submitLabel = $derived(mode === "create" ? "Create" : "Rename")

	function submit(event: SubmitEvent) {
		event.preventDefault()
		const trimmed = name.trim()
		if (!trimmed) {
			localError = "Give the folder a name."
			return
		}
		localError = ""
		onSubmit(trimmed)
	}

	const shownError = $derived(localError || error)
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
				class="card bg-surface-100-900 border-surface-300-700 w-[min(95vw,420px)] border p-6 shadow-xl"
				aria-labelledby="character-folder-name-title"
			>
				<form onsubmit={submit} class="flex flex-col gap-4">
					<h2
						id="character-folder-name-title"
						class="flex items-center gap-2 text-lg font-bold"
					>
						<Icons.Folder
							size={18}
							class="text-surface-400"
							aria-hidden="true"
						/>
						{title}
					</h2>
					<div class="flex flex-col">
						<label
							class="text-surface-500 mb-1.5 text-xs"
							for="character-folder-name"
						>
							Name
						</label>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							id="character-folder-name"
							type="text"
							autofocus
							bind:value={name}
							oninput={() => (localError = "")}
							class="input preset-filled-surface-200-800 rounded-[10px]"
							placeholder="Villains"
							aria-invalid={shownError ? "true" : undefined}
							aria-describedby={shownError
								? "character-folder-name-error"
								: undefined}
							disabled={busy}
						/>
						{#if shownError}
							<p
								id="character-folder-name-error"
								class="text-error-500 mt-1.5 text-xs"
								role="alert"
							>
								{shownError}
							</p>
						{/if}
					</div>
					<div class="flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-filled-surface-500"
							onclick={onCancel}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="btn preset-filled-primary-500"
							disabled={busy}
						>
							{submitLabel}
						</button>
					</div>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
