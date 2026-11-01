<!--
	Spoken lines (speech S8, design §12) — ONE folded row, never a file list.

	Without `sessionId` it is pub-wide (the caller shows it to admins only);
	with one it is that session's own (the caller shows it to the session owner
	or an admin). The server enforces both; hiding is a courtesy.

	Spoken audio is derived (reproducible from script + voice), so Clear asks
	for no confirmation. Replies are gated: the listeners below declare the
	interest, and `requestWithInterest` flushes it ahead of each ask.
-->
<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { formatBytes, spokenLinesLabel } from "./spokenLines"

	let { sessionId, compact = false }: { sessionId?: number; compact?: boolean } = $props()

	let count = $state<number | null>(null)
	let bytes = $state(0)
	let error = $state("")
	let busy = $state(false)

	const scope = $derived(sessionId ?? null)

	function onSummary(res: Sockets.Media.SpokenSummary.Response) {
		if (res.sessionId !== scope) return
		count = res.count
		bytes = res.bytes
		error = ""
	}
	function onCleared(res: Sockets.Media.ClearSpoken.Response) {
		if (res.sessionId !== scope) return
		busy = false
		ask()
	}
	function onError(res: { error: string }) {
		busy = false
		error = res.error
	}

	useInterest<"media:spokenSummary">("media:spokenSummary", onSummary)
	useInterest<"media:clearSpoken">("media:clearSpoken", onCleared)
	useInterest<"media:spokenSummary:error">("media:spokenSummary:error", onError)
	useInterest<"media:clearSpoken:error">("media:clearSpoken:error", onError)

	function ask() {
		const params = sessionId === undefined ? {} : { sessionId }
		// The listeners above hold the interest; this one only flushes it.
		requestWithInterest("media:spokenSummary", params, () => {})()
	}

	function clear() {
		busy = true
		error = ""
		const params = sessionId === undefined ? {} : { sessionId }
		requestWithInterest("media:clearSpoken", params, () => {})()
	}

	$effect(() => {
		sessionId
		ask()
	})
</script>

<div
	class="flex flex-col gap-1"
	data-testid="spoken-lines-row"
	data-scope={sessionId === undefined ? "pub" : "session"}
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="min-w-0 text-sm" aria-live="polite">
			{#if count === null}
				<span class="text-surface-600-400">Spoken lines…</span>
			{:else}
				{spokenLinesLabel(count, bytes)}
			{/if}
		</p>
		<button
			type="button"
			class="btn btn-sm text-error-600-400 hover:preset-tonal-error"
			title="Removes the audio files only; lines can be spoken again."
			disabled={busy || !count}
			onclick={clear}
		>
			<Icons.Trash2 size={16} aria-hidden="true" />
			<span>Clear</span>
		</button>
	</div>
	{#if !compact}
		<p class="text-surface-600-400 text-xs">
			Removes the audio files only; lines can be spoken again.
		</p>
	{/if}
	{#if error}
		<p class="text-error-600-400 text-xs" role="alert">{error}</p>
	{/if}
</div>
