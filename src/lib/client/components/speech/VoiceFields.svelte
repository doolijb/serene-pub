<script lang="ts">
	/**
	 * 🚧 **VoiceFields** — the parts of a voice a person edits, shared by the
	 * voicebank entry form and the character card's Speech tab: Description,
	 * Language, Speed, the dials the speaking model lists, and **Try the
	 * voice**. The host owns everything around it (name, loadout, which voice)
	 * and passes `controls`: what the model honours (null = unknown, so only
	 * the prose fields show).
	 *
	 * Layout: one column when the host is narrow, two from 32rem (container
	 * query on this component, not the viewport — it lives in a dialog and in a
	 * sheet).
	 */
	import type { Snippet } from "svelte"
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import type { VoiceControls } from "$lib/shared/speech/voicebank"
	import VoiceTryout from "./VoiceTryout.svelte"
	import type { VoiceTryoutRequest } from "./voiceTryout"
	import {
		descriptionCopy,
		dialLabel,
		dialsOf,
		settingsForTryout,
		speedBoundsOf,
		type VoiceDraft
	} from "./voiceFields"

	interface Props {
		draft: VoiceDraft
		/** What the speaking model honours; null = unknown (prose fields only). */
		controls: VoiceControls | null
		/** Shows Seed + Re-roll in the try-out (administrators). */
		mayPickVoice: boolean
		/** Prefix for the field ids, so two hosts on one page never collide. */
		idPrefix: string
		/** The host's part of the try-out request: `{voiceId, loadoutId}` or `{voice}`. */
		tryRequest: () => VoiceTryoutRequest
		/** Why Try cannot run yet. */
		tryBlocked?: string | null
		tryTitle?: string
		tryVoiceLabel?: string | null
		disabled?: boolean
		/** Host fields above Description. */
		before?: Snippet
		/** Host fields between the dials and the try-out. */
		after?: Snippet
	}
	let {
		draft = $bindable(),
		controls,
		mayPickVoice,
		idPrefix,
		tryRequest,
		tryBlocked = null,
		tryTitle = "Try the voice",
		tryVoiceLabel = null,
		disabled = false,
		before,
		after
	}: Props = $props()

	const copy = $derived(descriptionCopy(controls))
	const bounds = $derived(speedBoundsOf(controls))
	const dials = $derived(dialsOf(controls))
	const numericDials = $derived(dials.filter((d) => d !== "speakerBoost"))
	const hasBoost = $derived(dials.includes("speakerBoost"))

	const request = (): VoiceTryoutRequest => {
		const host = tryRequest()
		return {
			...host,
			description: draft.description,
			language: draft.language,
			settings: settingsForTryout(draft, controls)
		}
	}
	/**
	 * Every write REASSIGNS `draft` (never `draft.x = …`): a host may bind it
	 * through a getter/setter pair (the card's Speech tab maps it onto the
	 * timbre), and a property write on the getter's fresh object would be lost.
	 */
	function put(patch: Partial<VoiceDraft>) {
		draft = { ...draft, ...patch }
	}
	const num = (v: unknown): number | null =>
		typeof v === "number" && Number.isFinite(v) ? v : null

	const boostOptions = [
		{ value: null, label: "The voice's own" },
		{ value: true, label: "On" },
		{ value: false, label: "Off" }
	] as const
</script>

<div class="@container/vfields flex flex-col gap-4" data-voice-fields>
	{@render before?.()}

	<div class="flex flex-col gap-1">
		<label class="text-xs font-semibold" for="{idPrefix}-desc">{copy.label}</label>
		<textarea
			id="{idPrefix}-desc"
			class="textarea text-sm"
			rows="2"
			bind:value={() => draft.description, (v) => put({ description: v ?? "" })}
			placeholder={copy.placeholder}
			{disabled}
			aria-describedby="{idPrefix}-desc-help"
		></textarea>
		<FieldHelp id="{idPrefix}-desc-help">{copy.help}</FieldHelp>
	</div>

	<div class="grid grid-cols-1 gap-3 @min-[32rem]/vfields:grid-cols-2">
		<div class="flex flex-col gap-1">
			<label class="text-xs font-semibold" for="{idPrefix}-lang">Language</label>
			<input
				id="{idPrefix}-lang"
				class="input text-sm"
				bind:value={() => draft.language, (v) => put({ language: v ?? "" })}
				placeholder="The voice's own"
				maxlength="2"
				autocomplete="off"
				{disabled}
				aria-describedby="{idPrefix}-lang-help"
			/>
			<FieldHelp id="{idPrefix}-lang-help">
				Two letters, like en or ja. Blank leaves it to the voice.
			</FieldHelp>
		</div>

		{#if controls}
			<div class="flex flex-col gap-1">
				<label class="text-xs font-semibold" for="{idPrefix}-speed">Speed</label>
				<input
					id="{idPrefix}-speed"
					class="input text-sm"
					type="number"
					step="0.05"
					min={bounds?.min}
					max={bounds?.max}
					bind:value={() => draft.speed, (v) => put({ speed: num(v) })}
					placeholder="The voice's own"
					{disabled}
					aria-describedby="{idPrefix}-speed-help"
				/>
				<FieldHelp id="{idPrefix}-speed-help">
					{bounds
						? `From ${bounds.min} to ${bounds.max}; 1 is the voice's own pace.`
						: "Left to the service when blank."}
				</FieldHelp>
			</div>
		{/if}

		{#each numericDials as dial (dial)}
			<div class="flex flex-col gap-1">
				<label class="text-xs font-semibold" for="{idPrefix}-{dial}">{dialLabel(dial)}</label>
				<input
					id="{idPrefix}-{dial}"
					class="input text-sm"
					type="number"
					step="0.05"
					min="0"
					max="1"
					bind:value={() => draft[dial], (v) => put({ [dial]: num(v) })}
					placeholder="The voice's own"
					{disabled}
					aria-describedby="{idPrefix}-{dial}-help"
				/>
				<FieldHelp id="{idPrefix}-{dial}-help">From 0 to 1. Blank leaves it to the voice.</FieldHelp>
			</div>
		{/each}

		{#if hasBoost}
			<div class="flex flex-col gap-1">
				<span class="text-xs font-semibold" id="{idPrefix}-boost-label">Speaker boost</span>
				<div class="flex flex-wrap gap-1.5" role="group" aria-labelledby="{idPrefix}-boost-label">
					{#each boostOptions as opt (opt.label)}
						<button
							type="button"
							class="text-chip rounded-full px-2.5 py-1 {draft.speakerBoost === opt.value
								? 'preset-pressed'
								: 'preset-tonal-surface'}"
							aria-pressed={draft.speakerBoost === opt.value}
							{disabled}
							onclick={() => put({ speakerBoost: opt.value })}>{opt.label}</button
						>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	{@render after?.()}

	<VoiceTryout
		{request}
		{mayPickVoice}
		designsVoice={controls?.designsVoice === true}
		takesDirection={controls?.instruction === "prose"}
		bind:seed={() => draft.seed, (v) => put({ seed: num(v) })}
		blocked={tryBlocked}
		{disabled}
		title={tryTitle}
		voiceLabel={tryVoiceLabel}
	/>
</div>
