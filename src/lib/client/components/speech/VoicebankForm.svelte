<script lang="ts">
	/**
	 * 🚧 The voicebank entry form — a dialog over the Voices panel. An entry
	 * names one voice of a **loadout's** model and the settings it is spoken
	 * with. The loadout decides the model; the voice id is picked from that
	 * model's own voices (speech facts), or typed when the list is typed or
	 * empty; a voice-designing model has no voice id (the description is the
	 * voice). The shared `VoiceFields` carry Description, Language, Speed, the
	 * model's dials and the try-out.
	 *
	 * Refusals from the server arrive as `error` and are shown beside Save.
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import type { SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
	import type {
		VoicebankLoadoutOption,
		VoicebankVoiceView
	} from "$lib/shared/speech/voicebank"
	import VoiceFields from "./VoiceFields.svelte"
	import VoicePicker from "./VoicePicker.svelte"
	import { voicesFromFacts } from "./voicePicker"
	import {
		draftOf,
		draftProblem,
		emptyDraft,
		loadoutModelLine,
		type VoicebankDraft
	} from "./voicebankRows"

	interface Props {
		open: boolean
		/** The entry being edited, or null for a new one. */
		entry: VoicebankVoiceView | null
		/** The text→audio loadouts an entry may speak through. */
		loadouts: VoicebankLoadoutOption[]
		/** A new entry starts on this loadout when given (and filled). */
		initialLoadoutId?: number | null
		/** Speech facts of the CHOSEN loadout's model, when known. */
		facts: SpeechFacts | null
		busy: boolean
		/** The server's refusal, shown beside Save. */
		error: string | null
		/** The chosen loadout changed (also on open): the host loads that model's facts. */
		onLoadoutChange?: (loadoutId: number | null) => void
		onSave: (draft: VoicebankDraft) => void
		onCancel: () => void
	}
	let {
		open,
		entry,
		loadouts,
		initialLoadoutId = null,
		facts,
		busy,
		error,
		onLoadoutChange,
		onSave,
		onCancel
	}: Props = $props()

	const defaultLoadoutId = $derived(
		(loadouts.find((l) => l.id === initialLoadoutId && l.filled) ??
			loadouts.find((l) => l.isDefault && l.filled) ?? loadouts.find((l) => l.filled))?.id ?? null
	)

	let draft = $state<VoicebankDraft>(emptyDraft())
	// Re-seed whenever the dialog opens on a (possibly different) entry.
	let seeded: unknown = Symbol()
	$effect(() => {
		if (!open) {
			seeded = Symbol()
			return
		}
		if (seeded === entry) return
		seeded = entry
		draft = entry ? draftOf(entry) : emptyDraft(defaultLoadoutId)
	})
	$effect(() => {
		if (open) onLoadoutChange?.(draft.loadoutId)
	})

	const loadoutOptions = $derived(
		loadouts.map((l) => ({
			value: String(l.id),
			label: l.name,
			hint: loadoutModelLine(l),
			disabled: !l.filled
		}))
	)
	let loadoutValue = $state<string | null>(null)
	$effect(() => {
		loadoutValue = draft.loadoutId == null ? null : String(draft.loadoutId)
	})
	function pickLoadout(v: string) {
		const id = v ? Number(v) : null
		if (id === draft.loadoutId) return
		draft.loadoutId = id
		draft.voiceId = ""
	}

	const voices = $derived(voicesFromFacts(facts))
	const designsVoice = $derived(facts?.controls.designsVoice === true)
	const problem = $derived(draftProblem(draft, { designsVoice }))
	const typedOnly = $derived(facts?.voicesFrom === "typed" || !voices.length)
	const tryBlocked = $derived(
		draft.loadoutId == null
			? "Pick a loadout first."
			: !facts
				? "This loadout's model has not reported its voices yet."
				: designsVoice
					? draft.voice.description.trim()
						? null
						: "Describe the voice first."
					: draft.voiceId.trim()
						? null
						: "Pick a voice first."
	)
	const tryRequest = () => ({
		loadoutId: draft.loadoutId,
		voiceId: designsVoice ? "" : draft.voiceId.trim()
	})
	const LABELS = [
		["gender", "Gender"],
		["accent", "Accent"],
		["age", "Age"],
		["useCase", "Use case"]
	] as const
</script>

{#if open}
	<Dialog {open} onOpenChange={(e) => !e.open && onCancel()}>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-xl flex-col gap-4 @container/vbform overflow-y-auto p-6 shadow-xl"
				>
					<header class="flex items-start justify-between gap-3">
						<div>
							<Dialog.Title class="h2 text-lg font-bold">
								{entry ? `Edit ${entry.name}` : "New voice"}
							</Dialog.Title>
							<Dialog.Description
								class="text-surface-600-400 mt-1 text-sm"
							>
								A named voice on a loadout's model. Cards and
								sessions pick it by name.
							</Dialog.Description>
						</div>
						<Dialog.CloseTrigger
							class="btn-icon btn-icon-sm preset-tonal-surface"
							aria-label="Close"
						>
							<Icons.X size={16} aria-hidden="true" />
						</Dialog.CloseTrigger>
					</header>

					<div class="flex flex-col gap-1">
						<label class="text-xs font-semibold" for="vb-name">
							Name
						</label>
						<input
							id="vb-name"
							class="input text-sm"
							bind:value={draft.name}
							maxlength="80"
							autocomplete="off"
						/>
					</div>
					{#if loadouts.length}
						<Select
							label="Loadout"
							options={loadoutOptions}
							bind:value={loadoutValue}
							onValueChange={pickLoadout}
							placeholder="Pick a loadout"
							disabled={busy}
							describedBy="vb-loadout-help"
						/>
						<FieldHelp id="vb-loadout-help">
							The loadout whose model speaks this voice. Change its model in Loadouts and the voice follows.
						</FieldHelp>
					{/if}

					{#if draft.loadoutId != null && !designsVoice}
						<VoicePicker
							{voices}
							value={draft.voiceId || null}
							onchange={(k) => (draft.voiceId = k ?? "")}
							lede="Which of the model's voices this entry speaks with."
							origin={facts?.voicesFrom}
							notice={facts?.notice}
							deprecatedOn={facts?.deprecatedOn}
							allowTyped={typedOnly}
							disabled={busy}
						/>
					{/if}

					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" class="checkbox" bind:checked={draft.enabled} disabled={busy} />
						Enabled
					</label>

					<VoiceFields
						bind:draft={draft.voice}
						controls={facts?.controls ?? null}
						mayPickVoice={true}
						idPrefix="vb"
						{tryRequest}
						{tryBlocked}
						disabled={busy}
					>
						{#snippet after()}
							<div class="grid grid-cols-2 gap-3 @min-[32rem]/vbform:grid-cols-4">
								{#each LABELS as [key, label] (key)}
									<div class="flex flex-col gap-1">
										<label class="text-xs font-semibold" for="vb-label-{key}">{label}</label>
										<input
											id="vb-label-{key}"
											class="input text-sm"
											value={draft.labels[key] ?? ""}
											oninput={(e) => (draft.labels = { ...draft.labels, [key]: e.currentTarget.value })}
											maxlength="40"
											autocomplete="off"
											disabled={busy}
										/>
									</div>
								{/each}
							</div>
						{/snippet}
					</VoiceFields>

					{#if error}
						<p
							class="text-error-600-400 flex items-start gap-1.5 text-sm"
							role="alert"
						>
							<Icons.AlertTriangle
								size={14}
								class="mt-0.5 shrink-0"
								aria-hidden="true"
							/>
							{error}
						</p>
					{/if}
					<footer class="flex items-center justify-end gap-2">
						{#if problem}
							<span class="text-surface-600-400 mr-auto text-xs">
								{problem}
							</span>
						{/if}
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={onCancel}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn preset-filled-primary-500"
							disabled={busy || !!problem}
							onclick={() => onSave(draft)}
						>
							{entry ? "Save" : "Create"}
						</button>
					</footer>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}
