<script lang="ts">
	/**
	 * 🚧 The card form's **Speech** tab (speech build E1; design §6.1): who
	 * speaks for the character when a line is read aloud.
	 *
	 * - **Spoken aloud**: whether the character's lines are spoken at all.
	 * - **Voice**: pick a voicebank voice as the base (administrators; everyone
	 *   else sees its name), then layer this character's own description,
	 *   language, speed, seed and dials over it with the shared voice fields.
	 * - **Narrator**: an optional override. A voicebank voice only, no prose and
	 *   no settings (the narrator uses its own); blank uses the session's
	 *   narrator, then the pub's narration default.
	 *
	 * The draft is bound; the form writes it into
	 * `extensions.serenepub.timbre` on its normal Save.
	 */
	import { getContext, onMount } from "svelte"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { canPickVoice } from "$lib/shared/characters/timbre"
	import type { VoicebankPickableVoice } from "$lib/shared/speech/voicebank"
	import VoicePicker from "$lib/client/components/speech/VoicePicker.svelte"
	import { voicesFromPickable } from "$lib/client/components/speech/voicePicker"
	import VoiceFields from "$lib/client/components/speech/VoiceFields.svelte"
	import {
		voiceDraftOfTimbre,
		voiceDraftToTimbreParts,
		type VoiceDraft
	} from "$lib/client/components/speech/voiceFields"
	import VoiceTryout from "$lib/client/components/speech/VoiceTryout.svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import { narratorTryRequest, voiceTryRequest, type TimbreDraft } from "./voiceTab"
	import { Switch } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		characterName: string
		timbre: TimbreDraft
		/** Admins: open the Loadouts view's Voices panel. */
		openVoices?: () => void
	}
	let { characterName, timbre = $bindable(), openVoices }: Props = $props()

	const userCtx: { user?: { isAdmin?: boolean | null } | null } | undefined =
		getContext("userCtx")
	const mayPick = $derived(canPickVoice(userCtx?.user))
	const who = $derived(characterName.trim() || "this character")

	let pickable = $state<VoicebankPickableVoice[] | null>(null)
	let topControls = $state<Sockets.Voicebank.Pickable.Response["controls"]>(null)

	onMount(() => {
		const release = requestWithInterest("voicebank:pickable", {}, (res) => {
			pickable = res.voices
			topControls = res.controls ?? null
		})
		return release
	})

	const voices = $derived(voicesFromPickable(pickable))
	const picked = $derived(
		timbre.voice ? (pickable?.find((v) => v.slug === timbre.voice) ?? null) : null
	)
	const controls = $derived(picked?.controls ?? topControls ?? null)
	const nameOf = (slug: string | null) =>
		slug ? (voices.find((v) => v.key === slug)?.name ?? slug) : null
	const voiceName = $derived(nameOf(timbre.voice))
	const narratorName = $derived(nameOf(timbre.narrationVoice))
	const noVoices = $derived(pickable !== null && pickable.length === 0)

	// The shared fields edit a VoiceDraft; the card keeps its timbre draft.
	// Description and language pass through raw (no trim while typing).
	function readDraft(): VoiceDraft {
		return voiceDraftOfTimbre({
			description: timbre.description,
			language: timbre.language,
			settings: timbre.settings
		})
	}
	function writeDraft(v: VoiceDraft) {
		const parts = voiceDraftToTimbreParts(v, timbre.settings)
		timbre.description = v.description
		timbre.language = v.language
		timbre.settings = parts.settings ?? {}
	}

	const narratorRequest = $derived(narratorTryRequest(timbre, mayPick))
</script>

<section class="@container/speech panel-card flex flex-col gap-5">
	<div>
		<h2 class="text-sm font-medium">Speech</h2>
		<FieldHelp>
			Who speaks for {who} when a line is read aloud.
		</FieldHelp>
	</div>

	<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
		<div>
			<p class="text-sm font-medium" id="timbre-spoken-label">Spoken aloud</p>
			<FieldHelp>
				Off, their lines stay text even when the session reads aloud. Travels
				with the card.
			</FieldHelp>
		</div>
		<Switch
			name="timbre-spoken"
			checked={timbre.spoken}
			onCheckedChange={(e) => (timbre.spoken = e.checked)}
		>
			<Switch.Control
				class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
			>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
			<Switch.Label class="sr-only">Spoken aloud</Switch.Label>
		</Switch>
	</div>

	<div class="flex min-w-0 flex-col gap-3" data-testid="timbre-voice">
		<h3 class="text-sm font-medium">Voice</h3>
		<VoiceFields
			bind:draft={readDraft, writeDraft}
			{controls}
			mayPickVoice={mayPick}
			idPrefix="timbre"
			tryRequest={() => voiceTryRequest(timbre, mayPick)}
			tryTitle="Try the voice"
			tryVoiceLabel={voiceName}
		>
			{#snippet before()}
				{#if mayPick}
					{#if noVoices}
						<p class="text-sm text-surface-600-400">
							No voice set up on this pub yet.
							{#if openVoices}
								<button type="button" class="underline" onclick={openVoices}
									>Set up voices in Loadouts</button
								>
							{/if}
						</p>
					{:else}
						<VoicePicker
							{voices}
							bind:value={timbre.voice}
							origin="voicebank"
							lede="The base voice for {who}'s lines. What you set below is layered over it."
							none={{
								label: "Auto",
								consequence: `Narration picks a voice for ${who}, apart from the narrator's, and keeps it for the session.`
							}}
							emptyText="Loading voices."
						/>
						{#if picked?.loadoutName}
							<FieldHelp>Runs on the loadout {picked.loadoutName}.</FieldHelp>
						{/if}
					{/if}
				{:else}
					<div class="flex flex-col gap-1">
						<p class="text-sm"><Badge size="md">{voiceName ?? "Auto"}</Badge></p>
						<FieldHelp>An administrator picks voices on this pub.</FieldHelp>
					</div>
				{/if}
			{/snippet}
		</VoiceFields>
	</div>

	<div class="flex min-w-0 flex-col gap-3" data-testid="timbre-narrator">
		<h3 class="text-sm font-medium">Narrator</h3>
		<FieldHelp>
			Who reads the prose around {who}'s lines. Leave it blank to use the
			session's narrator, then the pub's narration default. The narrator uses
			its own settings.
		</FieldHelp>
		{#if mayPick}
			{#if !noVoices}
				<VoicePicker
					{voices}
					bind:value={timbre.narrationVoice}
					origin="voicebank"
					lede="Override narrator: the voice picked here reads in place of the session's narrator."
					none={{
						label: "Session narrator",
						consequence: "Uses the session's narrator, then the pub's narration default."
					}}
					emptyText="Loading voices."
				/>
			{/if}
		{:else}
			<div class="flex flex-col gap-1">
				<p class="text-sm"><Badge size="md">{narratorName ?? "Session narrator"}</Badge></p>
				<FieldHelp>An administrator picks the narrator on this pub.</FieldHelp>
			</div>
		{/if}
		{#if narratorRequest}
			<VoiceTryout
				title="Try the narrator"
				request={() => narratorTryRequest(timbre, mayPick) ?? {}}
				mayPickVoice={false}
				designsVoice={false}
				voiceLabel={narratorName}
			/>
		{/if}
	</div>
</section>
