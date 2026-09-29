<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"

	/**
	 * A narrator response's first step (ruling 2026-09-07): **who speaks**.
	 *
	 * `mode: "world"` is the narrator this modal has always fired — nobody in
	 * particular, describing the scene. `mode: "character"` names a side
	 * character, either from the dropdown or as a name somebody types, and both
	 * are full participants *for that turn*.
	 *
	 * ⚠ **participant ≠ character.** Choosing somebody here does not add them
	 * to the session's cast and does not put them in the rotation. The server
	 * enforces both — nothing writes a cast row, and the message it writes is a
	 * narration row, which the rotation (`rotationTurns`) drops before it matches ids —
	 * but the wording here says so too, because a picker that looks like an
	 * "add someone" control and is not would be worse than no picker.
	 */
	export interface SideCharacterOption {
		id: number
		name: string
		nickname: string | null
	}

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		onFire: (request: {
			instructions: string
			speaker?: { characterId: number | null; name: string | null }
		}) => void
		onCancel: () => void
		narratorName?: string
		/** This person's characters, minus the cast — the dropdown half. */
		sideCharacters?: SideCharacterOption[]
	}

	let {
		open = $bindable(),
		onOpenChange,
		onFire,
		onCancel,
		narratorName = "Narrator",
		sideCharacters = []
	}: Props = $props()

	let instructions = $state("")
	let mode: "world" | "character" = $state("world")
	/** `""` means "nobody picked" — a free-form name is the other route. */
	let pickedId: string = $state("")
	let freeName = $state("")

	$effect(() => {
		// Cleared each time the modal is (re)opened, so leftover text or a
		// speaker from a previous turn doesn't silently carry over — the same
		// reasoning the instructions field has always had, extended to the
		// speaker because a stale one is far more surprising.
		if (open) {
			instructions = ""
			mode = "world"
			pickedId = ""
			freeName = ""
		}
	})

	const trimmedName = $derived(freeName.trim())
	const speakerChosen = $derived(
		mode === "world" || pickedId !== "" || trimmedName.length > 0
	)

	/** The name this turn will be announced under, for the confirm button. */
	const speakingAs = $derived(
		mode === "world"
			? narratorName
			: trimmedName ||
					sideCharacters.find((c) => String(c.id) === pickedId)?.name ||
					"…"
	)

	function confirm() {
		onFire({
			instructions: instructions.trim(),
			speaker:
				mode === "character"
					? {
							characterId: pickedId === "" ? null : Number(pickedId),
							name: trimmedName || null
						}
					: undefined
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
				class="card bg-surface-100-900 w-[min(95vw,520px)] space-y-6 p-6 shadow-xl"
				role="dialog"
				aria-labelledby="narrator-response-title"
			>
				<header class="flex items-center gap-2">
					<Icons.CloudSun size={20} class="text-primary-500" />
					<h2 id="narrator-response-title" class="h2">
						Narrate
					</h2>
				</header>

				<fieldset class="space-y-2">
					<legend class="text-sm font-semibold">Who speaks</legend>
					<label class="flex items-start gap-2 text-sm">
						<input
							type="radio"
							class="radio mt-1"
							name="narrate-speaker-mode"
							value="world"
							bind:group={mode}
						/>
						<span>
							<span class="font-semibold">{narratorName}</span>
							<span class="text-surface-600-400 block text-xs">
								Narrate the environment and atmosphere. Nobody in
								particular is speaking.
							</span>
						</span>
					</label>
					<label class="flex items-start gap-2 text-sm">
						<input
							type="radio"
							class="radio mt-1"
							name="narrate-speaker-mode"
							value="character"
							bind:group={mode}
						/>
						<span>
							<span class="font-semibold">A side character</span>
							<span class="text-surface-600-400 block text-xs">
								Speak as somebody who is not in the cast — a
								shopkeeper, a messenger. They answer this once;
								they do not join the rotation.
							</span>
						</span>
					</label>
				</fieldset>

				{#if mode === "character"}
					<article class="space-y-2">
						<Select
							label="Pick a character"
							class="text-sm"
							options={[
								{ value: "", label: "Nobody — use a name below" },
								...sideCharacters.map((c) => ({
									value: String(c.id),
									label: c.nickname || c.name
								}))
							]}
							bind:value={pickedId}
						/>

						<label
							class="text-sm font-semibold"
							for="side-character-name"
						>
							…or type a name
						</label>
						<input
							id="side-character-name"
							class="input w-full"
							type="text"
							maxlength="120"
							bind:value={freeName}
							placeholder="e.g. The innkeeper, Captain Vell"
						/>
						<p class="text-surface-600-400 text-xs">
							A typed name speaks this turn without being added to
							the cast or the lorebook.
						</p>
					</article>
				{/if}

				<article class="space-y-2">
					<label
						class="text-sm font-semibold"
						for="narrator-instructions"
					>
						Extra instructions (optional)
					</label>
					<textarea
						id="narrator-instructions"
						bind:value={instructions}
						class="textarea w-full"
						rows="4"
						placeholder="e.g. Focus on the weather turning stormy, or have the shopkeeper notice the party..."
					></textarea>
				</article>

				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-filled-surface-500"
						onclick={onCancel}
						type="button"
						aria-label="Cancel"
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-primary-500"
						onclick={confirm}
						type="button"
						disabled={!speakerChosen}
						aria-label="Narrate as {speakingAs}"
					>
						<Icons.CloudSun size={14} /> Narrate as {speakingAs}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
