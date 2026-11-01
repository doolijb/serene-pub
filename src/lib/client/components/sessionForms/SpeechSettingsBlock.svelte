<script lang="ts">
	/**
	 * 🚧 **Read aloud** (seam S7; speech build lane E3): the session's speech
	 * settings drawn as one block. The words are the genre's declarations
	 * (core-catalog `shared/speechFields.ts`); this only falls back when a
	 * declaration says nothing. Every control writes at once through the
	 * form's `onwrite`; a refusal is said under the field. The narrator voice
	 * is picked from the pub's voicebank by whoever may change the field (the
	 * session's owner — lead ruling 2026-10-28: A1 is the card's rule; picking
	 * from the administrator's list is the preset-pick posture). *Read my
	 * lines too* is not drawn: it is declared but not implemented, and is
	 * being unregistered. The session's own spoken audio (the folded *Spoken
	 * lines* row) shows to its owner and to administrators.
	 */
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import VoicePicker from "$lib/client/components/speech/VoicePicker.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import * as Icons from "@lucide/svelte"
	import SpokenLinesRow from "$lib/client/components/media/SpokenLinesRow.svelte"
	import { voicesFromPickable, type PickerVoice } from "$lib/client/components/speech/voicePicker"
	import { fieldDomId } from "./sessionSettingsForm"
	import { TEMPLATE_LINES, isLanguageCode, readAloudChoices, readAloudLine, type SpeechFields } from "./speechSettingsBlock"

	type Field = Sockets.Sessions.SettingsForm.Field

	interface Props {
		fields: SpeechFields
		/** The session, for its folded Spoken lines row. */
		sessionId?: number
		/** The asker may see and clear this session's spoken audio (owner or admin). */
		showSpokenLines?: boolean
		/** 🚧 The genre's seated envoys with their stored voices (absent: none, or not the asker's to change). */
		envoys?: Sockets.Sessions.SettingsForm.SpeechEnvoy[]
		/** What the narrator gets while its override is blank (`speechNarrator`; `loadoutName` is admins' only). */
		narratorLine?: { voiceName: string | null; loadoutName?: string }
		/** The asker administers the pub: they may be told about loadouts. */
		isAdmin?: boolean
		busy: (f: Field) => boolean
		refusal: (f: Field) => string | null
		onwrite: (f: Field, value: unknown | null) => void
	}
	let { fields, sessionId, showSpokenLines = false, envoys = [], narratorLine, isAdmin = false, busy, refusal, onwrite }: Props = $props()

	let voices = $state<PickerVoice[]>([])
	let voicesLoaded = $state(false)
	$effect(() =>
		requestWithInterest("voicebank:pickable", {}, (res) => {
			voices = voicesFromPickable(res?.voices)
			voicesLoaded = true
		})
	)

	const readAloud = $derived(fields.readAloud)
	const template = $derived(fields.template)
	const narrator = $derived(fields.narratorVoice)
	const language = $derived(fields.language)

	/** The declaration's choices and words first; ours only where it gives none. */
	const choicesOf = (f: Field, fallback: Record<string, { label?: string; line: string }>) =>
		f.members?.length
			? f.members.map((m) => ({
					key: m.key,
					label: m.label || fallback[m.key]?.label || m.key,
					line: m.description ?? fallback[m.key]?.line ?? null
				}))
			: Object.entries(fallback).map(([key, v]) => ({ key, label: v.label ?? key, line: v.line }))
	const readChoices = $derived(readAloud ? readAloudChoices(readAloud) : [])
	const readLine = $derived(readAloud ? readAloudLine(readChoices, readAloud.value) : null)
	// "What is read" may be unset — the speak step's own line template — so
	// its first choice clears it (lane D follow-up: `speechTemplate` is
	// `string | null`); a radio's key "" stands for null.
	const templateChoices = $derived(
		template
			? [
					{
						key: "",
						label: "As the pipeline says",
						line: "Whatever the reply's speaking step reads by default, usually the whole line."
					},
					...choicesOf(
						template,
						Object.fromEntries(Object.entries(TEMPLATE_LINES).map(([k, line]) => [k, { line }]))
					)
				]
			: []
	)
	/** The narrator line while no override is set: admins hear of Narration, members of the pub's narrator. */
	const narratorNone = $derived.by(() => {
		const name = narratorLine?.voiceName ?? null
		const who = isAdmin ? "Narration's voice" : "Pub narrator"
		if (name) return { label: `${who} (${name})`, consequence: isAdmin ? "Pick a voice to override it for this session." : "" }
		return {
			label: "No narrator voice yet",
			consequence: isAdmin
				? "Add a voice to Narration under Loadouts → Voices, or pick one here."
				: "Ask an administrator to add a voice, or pick one here."
		}
	})
	const narratorName = (slug: unknown) =>
		typeof slug === "string" && slug ? (voices.find((v) => v.key === slug)?.name ?? slug) : narratorNone.label
	/** An envoy's blank-voice row: the Auto/other-speakers fallback, in words. */
	const fallbackNone = (fb: Sockets.Sessions.SettingsForm.SpeechFallback | undefined) => {
		if (!fb) return { label: "Auto", consequence: "" }
		const name = fb.voiceName
		if (fb.kind === "other-speakers")
			return {
				label: name ? `Other speakers: ${name}` : "Other speakers",
				consequence: "Narration's pinned voice for everyone without their own."
			}
		if (fb.kind === "narrator")
			return {
				label: "Auto: same as the narrator",
				consequence: isAdmin ? "Add a second voice to Narration to give them their own." : ""
			}
		return {
			label: name ? `Auto: ${name}` : "Auto",
			consequence:
				fb.reason === "shared"
					? "Shared with another speaker — Narration has no unused voice."
					: fb.reason === "avoids-narrator"
						? "Avoids the narrator."
						: ""
		}
	}
	const narratorValue = $derived(narrator && typeof narrator.value === "string" && narrator.value ? narrator.value : null)
	let langError = $state<string | null>(null)
	/** Envoy rows whose Details are unfolded. */
	let open = $state<Record<string, boolean>>({})
	const pickOf = (f: Field) => (typeof f.value === "string" && f.value ? f.value : null)
</script>


{#snippet err(f: Field)}
	{#if refusal(f)}<p class="text-error-600-400 text-xs" role="alert">{refusal(f)}</p>{/if}
{/snippet}

{#snippet voiceField(f: Field, label: string, lede: string, none: { label: string; consequence: string }, overridable = false)}
	<div class="flex min-w-0 flex-col gap-1" data-setting={f.id}>
		<p class="text-surface-600-400 text-xs">
			{label}{#if overridable && pickOf(f)}<span data-testid="narrator-override"> · override</span>{/if}
		</p>
		{#if f.editable}
			<VoicePicker
				compact
				{label}
				{voices}
				value={pickOf(f)}
				{lede}
				origin="voicebank"
				{none}
				disabled={busy(f)}
				emptyText={voicesLoaded
					? "No voices in this pub's voicebank yet. Set them up under Loadouts → Voices."
					: "Loading voices…"}
				onchange={(key) => {
					if ((key ?? null) !== pickOf(f)) onwrite(f, key ?? null)
				}}
			/>
		{:else}
			<p class="text-sm">{narratorName(f.value)}</p>
			{#if overridable && !pickOf(f) && narratorNone.consequence && !narratorLine?.voiceName}<p class="text-surface-600-400 text-xs">{narratorNone.consequence}</p>{/if}
			{#if f.readOnlyReason}<p class="text-surface-600-400 text-xs">{f.readOnlyReason}</p>{/if}
		{/if}
		{@render err(f)}
	</div>
{/snippet}

{#if readAloud || template || narrator || language || envoys.length}
	<div class="@container flex flex-col gap-4" data-testid="speech-settings">
		{#if readAloud}
			{@const id = fieldDomId(readAloud)}
			<div class="flex flex-col gap-2" data-setting={readAloud.id}>
				<p id="{id}-label" class="text-surface-600-400 text-xs">{readAloud.label || "Read replies aloud"}</p>
				{#if readAloud.editable}
					<div
						class="bg-surface-100-900 rounded-base flex w-full gap-1 p-1 @sm:w-fit"
						role="group"
						aria-labelledby="{id}-label"
						data-testid="read-aloud-modes"
					>
						{#each readChoices as c (c.key)}
							{@const on = (readAloud.value ?? "") === c.key}
							<button
								type="button"
								class="btn btn-sm rounded-base min-h-8 flex-1 text-chip pointer-coarse:min-h-11 {on
									? 'preset-pressed'
									: 'hover:preset-tonal'}"
								aria-pressed={on}
								disabled={busy(readAloud)}
								data-mode={c.key}
								onclick={() => !on && onwrite(readAloud, c.key)}
							>
								{c.label}
							</button>
						{/each}
					</div>
				{:else}
					<p class="text-sm">{readChoices.find((c) => c.key === (readAloud.value ?? ""))?.label ?? String(readAloud.value ?? "")}</p>
					{#if readAloud.readOnlyReason}<p class="text-surface-600-400 text-xs">{readAloud.readOnlyReason}</p>{/if}
				{/if}
				<p class="text-surface-600-400 text-xs" aria-live="polite" data-testid="read-aloud-line">{readLine ?? ""}</p>
				{@render err(readAloud)}
			</div>
		{/if}

		{#if template}
			{@const tid = fieldDomId(template)}
			{@const current = String(template.value ?? "")}
			<div class="flex flex-col gap-1" data-setting={template.id}>
				<p class="text-surface-600-400 text-xs">{template.label || "What is read"}</p>
				{#if template.editable}
					<Select
						label={template.label || "What is read"}
						labelHidden
						options={templateChoices.map((c) => ({ value: c.key === "" ? "__pipeline__" : c.key, label: c.label, ...(c.line ? { hint: c.line } : {}) }))}
						value={current === "" ? "__pipeline__" : current}
						disabled={busy(template)}
						onValueChange={(v) => {
							const next = v === "__pipeline__" ? "" : v
							if (next !== current) onwrite(template, next === "" ? null : next)
						}}
					/>
					<p id="{tid}-line" class="text-surface-600-400 text-xs">
						{templateChoices.find((c) => c.key === current)?.line ?? ""}
					</p>
				{:else}
					<p class="text-sm">{templateChoices.find((c) => c.key === current)?.label ?? current}</p>
					{#if template.readOnlyReason}<p class="text-surface-600-400 text-xs">{template.readOnlyReason}</p>{/if}
				{/if}
				{@render err(template)}
			</div>
		{/if}

		{#if narrator}
			{@render voiceField(
				narrator,
				narrator.label || "Narrator voice",
				narrator.description || "Who reads the narration, and any line whose speaker has no voice of their own.",
				narratorNone,
				true
			)}
		{/if}

		{#if envoys.length}
			<div class="flex flex-col gap-1" data-testid="speech-envoy-voices">
				<p class="text-surface-600-400 text-xs">Envoy voices</p>
				<p class="text-surface-600-400 text-xs">
					How each envoy in this session sounds. Pick a voice to set one; otherwise Auto picks.
				</p>
				<ul class="flex flex-col gap-2">
					{#each envoys as e (e.slug)}
						{@const did = `envoy-${e.slug}-details`}
						<li class="rounded-base border-surface-200-800 border p-2" data-envoy={e.slug}>
							<div class="flex flex-wrap items-center gap-2 @sm:flex-nowrap">
								<Avatar src={e.avatar} name={e.name} fallback="initial" size="sm" decorative />
								<span class="min-w-0 flex-1 truncate text-sm font-medium @sm:w-32 @sm:flex-none @sm:shrink-0" title={e.name}>{e.name}</span>
								<div class="order-last min-w-0 basis-full @sm:order-none @sm:basis-0 @sm:flex-1" data-setting={e.voice.id}>
									{#if e.voice.editable}
										<VoicePicker
											compact
											label="Voice for {e.name}"
											{voices}
											value={pickOf(e.voice)}
											lede={`Who reads ${e.name}'s lines.`}
											origin="voicebank"
											none={fallbackNone(e.fallback)}
											disabled={busy(e.voice)}
											emptyText={voicesLoaded
												? "No voices in this pub's voicebank yet. Set them up under Loadouts → Voices."
												: "Loading voices…"}
											onchange={(key) => {
												if ((key ?? null) !== pickOf(e.voice)) onwrite(e.voice, key ?? null)
											}}
										/>
									{/if}
								</div>
								<button
									type="button"
									class="btn-icon btn-icon-sm hover:preset-tonal shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
									aria-expanded={!!open[e.slug]}
									aria-controls={did}
									aria-label="Details for {e.name}"
									title="Details for {e.name}"
									onclick={() => (open[e.slug] = !open[e.slug])}
								>
									<Icons.ChevronDown size={16} aria-hidden="true" class={open[e.slug] ? "rotate-180" : ""} />
								</button>
							</div>
							{@render err(e.voice)}
							{#if open[e.slug]}
								<div id={did} class="mt-2 flex flex-col gap-3">
									{@render voiceField(
										e.narrationVoice,
										e.narrationVoice.label,
										`Who reads the prose inside ${e.name}'s lines.`,
										{ label: "Session narrator", consequence: "Uses the session's narrator voice." }
									)}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if language}
			{@const lid = fieldDomId(language)}
			<div class="flex flex-col gap-1" data-setting={language.id}>
				<label class="flex flex-col gap-1 text-xs" for={lid}>
					<span class="text-surface-600-400">{language.label || "Language"} (optional)</span>
					<input
						id={lid}
						class="input w-24 rounded-base"
						type="text"
						maxlength="2"
						placeholder="en"
						value={typeof language.value === "string" ? language.value : ""}
						disabled={busy(language) || !language.editable}
						aria-describedby="{lid}-help"
						onchange={(e) => {
							const v = e.currentTarget.value.trim().toLowerCase()
							if (v && !isLanguageCode(v)) {
								langError = "Use a two-letter language code, such as en or ja."
								return
							}
							langError = null
							onwrite(language, v || null)
						}}
					/>
				</label>
				<p id="{lid}-help" class="text-surface-600-400 text-xs">
					{language.description ||
						"The language this session is spoken in, as a two-letter code such as en or fr. Empty uses the pub's default."}
				</p>
				{#if langError}<p class="text-error-600-400 text-xs" role="alert">{langError}</p>{/if}
				{#if refusal(language)}<p class="text-error-600-400 text-xs" role="alert">{refusal(language)}</p>{/if}
			</div>
		{/if}

		{#if showSpokenLines && sessionId != null}
			<div data-testid="speech-spoken-lines">
				<SpokenLinesRow {sessionId} compact />
			</div>
		{/if}
	</div>
{/if}
