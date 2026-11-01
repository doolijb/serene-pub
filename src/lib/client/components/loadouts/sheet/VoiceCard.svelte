<script lang="ts">
	/**
	 * The loadout editor's **Voice** card — drawn only for a `text->audio`
	 * loadout. Two lines, each written at once (not part of the Save draft):
	 * **Voice** (the narrator; a pick among this loadout's entries) and
	 * **Other speakers** (Auto, or one pinned entry). A refusal is said
	 * under the control that asked.
	 */
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		AUTO_VALUE,
		NO_VOICES_SENTENCE,
		OTHER_SPEAKERS_SENTENCE,
		VOICE_SENTENCE,
		otherSpeakersOptions,
		voiceOptions,
		type SheetVoice
	} from "../loadoutVoices"

	interface Props {
		voices: SheetVoice[]
		defaultVoiceId: number | null
		otherSpeakersVoiceId: number | null
		/** A refusal, said beside the line that asked. */
		problem: { at: "voice" | "others"; text: string } | null
		busy?: boolean
		disabled?: boolean
		onVoice: (id: number) => void
		onOthers: (id: number | null) => void
		onAddVoice?: () => void
	}
	let {
		voices,
		defaultVoiceId,
		otherSpeakersVoiceId,
		problem,
		busy = false,
		disabled = false,
		onVoice,
		onOthers,
		onAddVoice
	}: Props = $props()

	const uid = $props.id()
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="{uid}-h" data-voice-card>
	<div class="flex items-center gap-2">
		<Icons.AudioLines size={16} class="text-surface-600-400" aria-hidden="true" />
		<h3 id="{uid}-h" class="flex-1 text-sm font-medium">Voices</h3>
	</div>

	{#if !voices.length}
		<div class="flex flex-wrap items-center gap-2">
			<p class="text-surface-600-400 min-w-0 flex-1 text-sm">{NO_VOICES_SENTENCE}</p>
			{#if onAddVoice}
				<button type="button" class="btn btn-sm preset-tonal-surface" {disabled} onclick={onAddVoice}>
					<Icons.Plus size={14} aria-hidden="true" />
					Add a voice
				</button>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-x-4 gap-y-3 @lg/editor:grid-cols-2">
			<div class="flex min-w-0 flex-col gap-1" data-voice-line="voice">
				<Select
					label="Voice"
					options={voiceOptions(voices)}
					value={defaultVoiceId == null ? null : String(defaultVoiceId)}
					disabled={disabled || busy}
					onValueChange={(v) => v && onVoice(Number(v))}
				/>
				<p class="text-surface-600-400 text-xs">{VOICE_SENTENCE}</p>
				{#if problem?.at === "voice"}
					<p class="text-error-600-400 text-xs" role="alert">{problem.text}</p>
				{/if}
			</div>
			<div class="flex min-w-0 flex-col gap-1" data-voice-line="others">
				<Select
					label="Other speakers"
					options={otherSpeakersOptions(voices)}
					value={otherSpeakersVoiceId == null ? AUTO_VALUE : String(otherSpeakersVoiceId)}
					disabled={disabled || busy}
					onValueChange={(v) => v && onOthers(v === AUTO_VALUE ? null : Number(v))}
				/>
				<p class="text-surface-600-400 text-xs">{OTHER_SPEAKERS_SENTENCE}</p>
				{#if problem?.at === "others"}
					<p class="text-error-600-400 text-xs" role="alert">{problem.text}</p>
				{/if}
			</div>
		</div>
	{/if}
</section>
