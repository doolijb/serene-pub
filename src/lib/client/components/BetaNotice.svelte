<script lang="ts">
	/**
	 * The beta notice on Home (★R4, 2026-10-24): one tonal line, never
	 * warning- or error-coloured. A 950 inset on the page, 13px muted words,
	 * the gold dot as the only colour, and × to put it away for this version
	 * in this browser (`betaNotice.ts`).
	 *
	 * Starts hidden and is shown once the browser has said it was not
	 * dismissed: storage is not there during SSR, and a line that drew and
	 * then vanished on every visit would be worse than one a frame late.
	 */
	import * as Icons from "@lucide/svelte"
	import { onMount } from "svelte"
	import {
		betaNoticeSentence,
		dismissBetaNotice,
		isBetaNoticeDismissed
	} from "./betaNotice"

	interface Props {
		version: string
		/** The build carries a pre-release suffix (`page.data.isPrerelease`). */
		prerelease?: boolean
	}
	let { version, prerelease = false }: Props = $props()

	let dismissed = $state(true)
	onMount(() => {
		dismissed = isBetaNoticeDismissed(version)
	})

	const sentence = $derived(betaNoticeSentence(version, prerelease))

	function dismiss() {
		dismissed = true
		dismissBetaNotice(version)
	}
</script>

{#if !dismissed}
	<div
		class="bg-surface-50-950 text-surface-600-400 flex w-full items-center gap-2.5 rounded-base py-1.5 pr-1 pl-3 text-chip"
		role="note"
		data-testid="home-beta-notice"
	>
		<span
			class="bg-primary-500 size-1.5 shrink-0 rounded-full"
			aria-hidden="true"
		></span>
		<span class="min-w-0 flex-1">{sentence}</span>
		<button
			type="button"
			class="hover:bg-surface-200-800 hover:text-surface-950-50 grid size-8 shrink-0 place-items-center rounded-lg pointer-coarse:size-11"
			aria-label="Dismiss the beta notice"
			title="Dismiss"
			onclick={dismiss}
		>
			<Icons.X size={14} aria-hidden="true" />
		</button>
	</div>
{/if}
