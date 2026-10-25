<script lang="ts">
	/**
	 * New config and Duplicate, from the Sampling view: the question
	 * Admin › Sampling's add form asks (name, modality, copy from), as a small
	 * dialog. The parameters are tuned in the editor the create lands on.
	 *
	 * Names are unique within a modality. A name taken in the list is said
	 * here before anything is sent; a refusal from the server arrives as
	 * `error` and the dialog stays open on the name that has to change.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { S } from "@serene-pub/sdk"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		nameTaken,
		shapeOf,
		type SamplingListRow,
		type SamplingNewSeed
	} from "./samplingList"

	interface Props {
		open: boolean
		/** Every config, for the copy-from list and the name check. */
		rows: readonly SamplingListRow[]
		/** What the form starts as each time it opens. */
		seed: SamplingNewSeed
		/** The config a modality's copy-from starts on when it is switched. */
		defaultFromFor: (shape: string) => number | null
		/** A refusal from the server, shown under the name. */
		error?: string
		busy?: boolean
		onCreate: (choice: SamplingNewSeed) => void
		onClose: () => void
	}

	let {
		open,
		rows,
		seed,
		defaultFromFor,
		error,
		busy = false,
		onCreate,
		onClose
	}: Props = $props()

	const MODALITIES = [
		{ shape: S.textGen, label: "Text", hint: "Large language models" },
		{ shape: S.imageGen, label: "Image", hint: "Image generation" }
	]
	const NOTHING = "none"

	let name = $state("")
	let shape = $state<string>(S.textGen)
	let from = $state<string>(NOTHING)
	let localError = $state<string | null>(null)
	/** The name the server's `error` was raised for; edited away, it goes. */
	let errorFor = $state<string | null>(null)

	// Re-seeded on every open: the dialog stays mounted between them.
	$effect(() => {
		if (!open) return
		name = seed.name
		shape = seed.shape
		from = seed.fromId == null ? NOTHING : String(seed.fromId)
		localError = null
		errorFor = null
	})
	$effect(() => {
		if (error) errorFor = name
	})

	const ofShape = $derived(rows.filter((r) => shapeOf(r) === shape))
	const shownError = $derived(
		localError ??
			(errorFor !== null && errorFor === name ? error : undefined)
	)

	function pickShape(next: string) {
		if (next === shape) return
		shape = next
		const d = defaultFromFor(next)
		from = d == null ? NOTHING : String(d)
	}

	function submit(e: SubmitEvent) {
		e.preventDefault()
		const trimmed = name.trim()
		localError = !trimmed
			? "A sampling config needs a name."
			: nameTaken(trimmed, shape, rows)
				? `${shape === S.imageGen ? "An image" : "A text"} sampling config named "${trimmed}" already exists.`
				: null
		if (localError) return
		onCreate({
			name: trimmed,
			shape,
			fromId: from === NOTHING ? null : Number(from)
		})
	}
</script>

<Dialog {open} onOpenChange={(e) => !e.open && onClose()}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md p-6 shadow-xl"
				aria-labelledby="sampling-new-title"
			>
				<form class="flex flex-col gap-4" onsubmit={submit} novalidate>
					<header class="flex flex-col gap-1">
						<h2 id="sampling-new-title" class="h4">
							New sampling config
						</h2>
						<p class="text-surface-600-400 text-sm">
							Its parameters are tuned in the editor it opens in.
						</p>
					</header>

					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="sampling-new-name"
						>
							Name
						</label>
						<input
							id="sampling-new-name"
							class="input"
							type="text"
							autocomplete="off"
							bind:value={name}
							aria-invalid={!!shownError}
							aria-describedby={shownError
								? "sampling-new-name-error"
								: "sampling-new-name-help"}
							oninput={() => (localError = null)}
						/>
						{#if shownError}
							<p
								id="sampling-new-name-error"
								class="text-error-600-400 text-sm"
								role="alert"
							>
								{shownError}
							</p>
						{:else}
							<p
								id="sampling-new-name-help"
								class="text-surface-600-400 text-xs"
							>
								Unique within its modality.
							</p>
						{/if}
					</div>

					<fieldset class="flex flex-col gap-1">
						<legend class="mb-1 text-sm font-semibold">
							Modality
						</legend>
						<div class="grid grid-cols-2 gap-2">
							{#each MODALITIES as m (m.shape)}
								<label
									class={[
										"card flex cursor-pointer flex-col gap-0.5 rounded-base p-3 text-sm",
										shape === m.shape
											? "sidebar-row-active"
											: "preset-tonal-surface"
									]}
								>
									<span class="flex items-center gap-2">
										<input
											type="radio"
											name="sampling-new-modality"
											class="accent-primary"
											value={m.shape}
											checked={shape === m.shape}
											onchange={() => pickShape(m.shape)}
										/>
										<span class="font-medium">
											{m.label}
										</span>
									</span>
									<span class="text-surface-600-400 text-xs">
										{m.hint}
									</span>
								</label>
							{/each}
						</div>
						<p class="text-surface-600-400 text-xs">
							Text and image sampling share no parameters, and a
							config keeps its modality.
						</p>
					</fieldset>

					<div class="flex flex-col gap-1">
						<Select
							label="Copy from"
							options={[
								...ofShape.map((r) => ({
									value: String(r.id),
									label: `${r.name}${r.isImmutable ? " (built in)" : ""}`
								})),
								{
									value: NOTHING,
									label: "Nothing switched on"
								}
							]}
							bind:value={from}
							describedBy="sampling-new-from-help"
						/>
						<p
							id="sampling-new-from-help"
							class="text-surface-600-400 text-xs"
						>
							A parameter switched off is not sent, so the backend
							uses its own value.
						</p>
					</div>

					<footer class="flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={onClose}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="btn preset-filled-primary-500"
							disabled={busy || !name.trim()}
						>
							Create
						</button>
					</footer>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
