<script lang="ts">
	/**
	 * 🚧 **Try the voice** — hear one line spoken with the voice the person is
	 * still deciding on, before saving. Nothing is kept. The host owns the
	 * overrides (`request`, read at the moment of Try) and saving the seed;
	 * this control sends `voicebank:preview`, plays the clip, and says any
	 * refusal in place (never a toast: Layout skips `voicebank:preview:error`).
	 */
	import * as Icons from "@lucide/svelte"
	import { onDestroy } from "svelte"
	import { v4 as uuid } from "uuid"
	import { INFLECTION_LABELS } from "@serene-pub/sdk"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import {
		VOICE_SEED_MAX,
		VOICE_TRYOUT_SAMPLE_LINE,
		VOICE_TRYOUT_TEXT_MAX
	} from "$lib/shared/speech/voiceTryout"
	import Badge from "$lib/client/components/Badge.svelte"
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import SpeechClip from "./SpeechClip.svelte"
	import {
		bytesToBlob,
		clipCaption,
		parseSeedInput,
		previewParams,
		rerollSeed,
		seedChipLabel,
		seedHint,
		type VoiceTryoutRequest
	} from "./voiceTryout"

	interface Props {
		/** The host's overrides, read at the moment of Try. */
		request: () => VoiceTryoutRequest
		/** Shows Seed + Re-roll (administrators). Everyone gets Try. */
		mayPickVoice: boolean
		/** The speaking model designs its voice from the description (the seed picks the person). */
		designsVoice: boolean
		/** The model takes direction in words: offers Mood (never when designsVoice). */
		takesDirection?: boolean
		/** The seed the host saves. */
		seed?: number | null
		/** Why Try cannot run yet; shown in place of a refusal. Try is disabled. */
		blocked?: string | null
		disabled?: boolean
		/** The heading; the card retargets it ("Try the narration voice"). */
		title?: string
		/** The voice chip on the clip, when the host knows it. */
		voiceLabel?: string | null
	}
	let {
		request,
		mayPickVoice,
		designsVoice,
		takesDirection = false,
		seed = $bindable(null),
		blocked = null,
		disabled = false,
		title = "Try the voice",
		voiceLabel = null
	}: Props = $props()

	const uid = $props.id()
	const socket = useTypedSocket()

	let line = $state(VOICE_TRYOUT_SAMPLE_LINE)
	let mood = $state("")
	let busy = $state(false)
	let refusal = $state<string | null>(null)
	let clipUrl = $state<string | null>(null)
	let caption = $state("")
	let notes = $state<string[]>([])
	let spinning = $state(false)
	let copied = $state(false)
	let copiedTimer: ReturnType<typeof setTimeout> | undefined
	let editingSeed = $state(false)
	let lineEl = $state<HTMLInputElement | null>(null)

	/** Moves focus to the Line field (the card retargets the try-out here). */
	export function focusLine() {
		lineEl?.focus({ preventScroll: true })
	}

	const showMood = $derived(takesDirection && !designsVoice)

	function dropClip() {
		if (clipUrl) URL.revokeObjectURL(clipUrl)
		clipUrl = null
	}
	onDestroy(() => {
		dropClip()
		clearTimeout(copiedTimer)
	})

	async function copySeed() {
		if (seed == null) return
		try {
			await navigator.clipboard.writeText(String(seed))
			copied = true
			clearTimeout(copiedTimer)
			copiedTimer = setTimeout(() => (copied = false), 1500)
		} catch {
			/* no clipboard: the number input still shows it */
			editingSeed = true
		}
	}

	async function tryIt() {
		if (busy || disabled || blocked) return
		busy = true
		refusal = null
		const requestId = uuid()
		try {
			const res = await awaitReply({
				socket,
				event: "voicebank:preview",
				errorEvent: "voicebank:preview:error",
				params: previewParams(request(), {
					requestId,
					text: line,
					seed,
					inflection: showMood && mood ? mood : null
				}),
				match: (r) => r?.requestId === requestId,
				matchError: (d) =>
					(d as { requestId?: string } | undefined)?.requestId === requestId,
				timeoutMs: 65_000
			})
			dropClip()
			clipUrl = URL.createObjectURL(bytesToBlob(res.bytes, res.mime))
			caption = clipCaption(res)
			notes = res.notes ?? []
		} catch (err) {
			refusal =
				err instanceof Error && err.message
					? err.message
					: "The try-out failed."
		} finally {
			busy = false
		}
	}

	function reroll() {
		if (busy) return
		spinning = false
		requestAnimationFrame(() => (spinning = true))
		seed = rerollSeed()
		void tryIt()
	}
</script>

<div class="@container/tryout flex flex-col gap-3">
	<div>
		<h3 class="text-sm font-medium">{title}</h3>
		<FieldHelp>Hear a line before you save. Nothing is kept.</FieldHelp>
	</div>

	<div class="grid gap-4 @min-[32rem]/tryout:grid-cols-2">
		<div class="flex min-w-0 flex-col gap-3">
			<div class="flex flex-col gap-1">
				<label class="text-xs font-semibold" for="{uid}-line">Line</label>
				<input
					id="{uid}-line"
					class="input text-sm"
					bind:this={lineEl}
					bind:value={line}
					maxlength={VOICE_TRYOUT_TEXT_MAX}
					autocomplete="off"
				/>
			</div>

			{#if showMood}
				<div class="flex flex-col gap-1">
					<span class="text-xs font-semibold" id="{uid}-mood">Mood</span>
					<div
						class="flex flex-wrap gap-1.5"
						role="group"
						aria-labelledby="{uid}-mood"
						aria-describedby="{uid}-mood-hint"
					>
						{#each ["", ...INFLECTION_LABELS] as label (label)}
							<button
								type="button"
								class="text-chip rounded-full px-2.5 py-1 {mood === label
									? 'preset-pressed'
									: 'preset-tonal-surface'}"
								aria-pressed={mood === label}
								onclick={() => (mood = label)}>{label || "None"}</button
							>
						{/each}
					</div>
					<FieldHelp id="{uid}-mood-hint">Tries the line said in this mood.</FieldHelp>
				</div>
			{/if}

			{#if mayPickVoice}
				<div class="flex flex-col gap-1">
					<span class="text-xs font-semibold" id="{uid}-seed-label">Seed</span>
					<div class="flex flex-wrap items-center gap-2">
						<Badge size="md" class="font-mono" data-testid="voice-tryout-seed">
							{seed == null ? (designsVoice ? "From the description" : "None") : seedChipLabel(seed)}
						</Badge>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface text-sm"
							disabled={seed == null}
							onclick={copySeed}
						>
							<Icons.Copy size={14} aria-hidden="true" />
							Copy
						</button>
						<span class="text-xs text-surface-600-400" role="status" aria-live="polite"
							>{copied ? "Copied" : ""}</span
						>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface text-sm"
							disabled={busy || disabled || !!blocked}
							onclick={reroll}
						>
							<Icons.Dices
								size={16}
								aria-hidden="true"
								class={spinning ? "tryout-spin" : ""}
								onanimationend={() => (spinning = false)}
							/>
							Re-roll
						</button>
						<button
							type="button"
							class="text-xs underline"
							aria-expanded={editingSeed}
							onclick={() => (editingSeed = !editingSeed)}>Change</button
						>
					</div>
					{#if editingSeed}
						<input
							id="{uid}-seed"
							class="input text-sm"
							type="number"
							step="1"
							min="0"
							max={VOICE_SEED_MAX}
							value={seed}
							oninput={(e) => (seed = parseSeedInput(e.currentTarget.valueAsNumber))}
							placeholder={designsVoice ? "From the description" : "None"}
							aria-labelledby="{uid}-seed-label"
							aria-describedby="{uid}-seed-hint"
						/>
					{/if}
					<FieldHelp id="{uid}-seed-hint">{seedHint(designsVoice)}</FieldHelp>
				</div>
			{/if}
		</div>

		<div class="flex min-w-0 flex-col gap-3">
			<div class="flex flex-wrap items-center gap-2">
				<!-- Secondary: the host's Save/Create is the surface's one filled primary (STYLE-GUIDE). -->
				<button
					type="button"
					class="btn preset-tonal-surface"
					disabled={busy || disabled || !!blocked}
					onclick={tryIt}
				>
					{#if busy}
						<Icons.Loader size={16} class="animate-spin" aria-hidden="true" />
						Trying…
					{:else}
						<Icons.Play size={16} aria-hidden="true" />
						Try
					{/if}
				</button>
			</div>

			{#if blocked}
				<p class="text-xs text-surface-600-400" data-testid="voice-tryout-blocked">{blocked}</p>
			{:else if refusal}
				<p class="text-error-600-400 flex items-start gap-1.5 text-sm" role="alert">
					<Icons.AlertTriangle size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
					{refusal}
				</p>
			{/if}

			{#if clipUrl}
				<div class="flex flex-col gap-1">
					<SpeechClip src={clipUrl} {voiceLabel} autoplay onerror={(m) => (refusal = m)} />
					{#if caption}<p class="text-xs text-surface-600-400">{caption}</p>{/if}
					{#each notes as note (note)}
						<p class="text-xs text-surface-600-400">{note}</p>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	:global(.tryout-spin) {
		animation: tryout-spin var(--transition-duration-base) ease-out 1;
	}
	@keyframes tryout-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.tryout-spin) {
			animation: none;
		}
	}
</style>
