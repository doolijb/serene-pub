<script lang="ts">
	/**
	 * 🚧 A spoken clip as one compact row — play/pause · elapsed / duration ·
	 * voice chip, with a slim position bar under it. The same look as a
	 * message's spoken-line strip, for app-side clips (Try the voice, the
	 * voicebank rows). Owns its `<audio>`; follows its events, so the button
	 * is always the truth. Position is status, not an action: ink, not gold
	 * (STYLE-GUIDE §1.10, §8).
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	import SpProgress from "$lib/client/components/hostElements/SpProgress.svelte"
	import { formatClock } from "./voiceTryout"
	import { ensureOneSoundAtATime } from "$lib/client/components/host/oneSoundAtATime"

	// The try-out clip yields to any other sound, and any other yields to it (owner 2026-10-29).
	onMount(() => ensureOneSoundAtATime())

	interface Props {
		/** The clip's URL; null shows nothing. */
		src: string | null
		/** The voice that spoke it, when known. */
		voiceLabel?: string | null
		/** Play once whenever `src` changes. A refused play stays quiet. */
		autoplay?: boolean
		/** The browser could not load the clip. */
		onerror?: (message: string) => void
		class?: string
	}
	let {
		src,
		voiceLabel = null,
		autoplay = false,
		onerror,
		class: className = ""
	}: Props = $props()

	let audioEl = $state<HTMLAudioElement | null>(null)
	let playing = $state(false)
	let time = $state(0)
	let duration = $state(0)

	export function play() {
		try {
			void Promise.resolve(audioEl?.play()).catch(() => {})
		} catch {
			/* autoplay refused: the button is there */
		}
	}
	export function pause() {
		audioEl?.pause()
	}
	function toggle() {
		if (playing) pause()
		else play()
	}

	let lastSrc: string | null = null
	$effect(() => {
		const s = src
		if (s !== lastSrc) {
			lastSrc = s
			time = 0
			duration = 0
			playing = false
			if (s && autoplay) queueMicrotask(play)
		}
	})
</script>

{#if src}
	<div class="flex flex-col gap-1.5 {className}" data-testid="speech-clip">
		<div class="flex min-w-0 items-center gap-2">
			<button
				type="button"
				class="btn-icon btn-icon-sm preset-tonal-surface shrink-0 pointer-coarse:size-11"
				aria-label={playing ? "Pause the clip" : "Play the clip"}
				title={playing ? "Pause the clip" : "Play the clip"}
				onclick={toggle}
			>
				{#if playing}
					<Icons.Pause size={16} aria-hidden="true" />
				{:else}
					<Icons.Play size={16} aria-hidden="true" />
				{/if}
			</button>
			<span class="text-xs tabular-nums text-surface-600-400" data-testid="speech-clip-clock"
				>{formatClock(time)} / {formatClock(duration)}</span
			>
			{#if voiceLabel}
				<Badge size="md" class="min-w-0 truncate">{voiceLabel}</Badge>
			{/if}
		</div>
		<div class="text-surface-600-400">
			<SpProgress
				attrs={{ value: String(duration > 0 ? (time / duration) * 100 : 0), max: "100", label: "Clip position" }}
			/>
		</div>
		<audio
			bind:this={audioEl}
			{src}
			preload="auto"
			aria-label="Clip"
			class="hidden"
			onplay={() => (playing = true)}
			onpause={() => (playing = false)}
			onended={() => {
				playing = false
				time = 0
			}}
			ontimeupdate={() => (time = audioEl?.currentTime ?? 0)}
			onloadedmetadata={() => (duration = audioEl?.duration ?? 0)}
			ondurationchange={() => (duration = audioEl?.duration ?? 0)}
			onerror={() =>
				onerror?.(
					"The browser would not load this clip. Reload the page (Ctrl+Shift+R) and try again."
				)}
		></audio>
	</div>
{/if}
