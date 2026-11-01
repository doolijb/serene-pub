<script lang="ts">
	/**
	 * 🚧 The **Voices** table of a speaking model's page (speech build, lane
	 * E2; design §6.5): the model's voices off its speech facts, where they
	 * came from, the service's notice, a ⏳ shutdown chip, and **Refresh**
	 * (`models:refreshSpeech`, admin) to ask the service again.
	 *
	 * ⏳ `connections:models` rows carry no `speech` yet (★E1); until they do the
	 * table fills from the Refresh reply. A typed-list editor is not built
	 * (the list is read-only here).
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import type { SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
	import { labelLine, originLine, voicesFromFacts } from "./voicePicker"
	import { shutsDownLine, speechFactsOfRow } from "./voicebankRows"

	interface Props {
		connectionId: number
		/** The `connections:models` row of the speaking model. */
		row: { id: number; model: string }
	}
	let { connectionId, row }: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user: SelectUser } | undefined = getContext("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)

	let fetched = $state<SpeechFacts | null>(null)
	const facts = $derived(fetched ?? speechFactsOfRow(row))
	const voices = $derived(voicesFromFacts(facts))
	const kindOf = $derived(
		new Map((facts?.voices ?? []).map((v) => [v.id, v.kind]))
	)

	let busy = $state(false)
	let error = $state<string | null>(null)

	useInterest<"models:refreshSpeech">("models:refreshSpeech", (res) => {
		if (res.connectionId !== connectionId) return
		const mine = res.results?.find((r) => r.connectionModelId === row.id)
		if (!mine && !res.error) return
		busy = false
		error = mine?.error ?? res.error ?? null
		if (mine?.speech) fetched = mine.speech
	})

	function refresh() {
		busy = true
		error = null
		socket.emit("models:refreshSpeech", {
			connectionId,
			model: row.model
		})
	}

	let playing = $state<string | null>(null)
	let audio: HTMLAudioElement | null = null
	function preview(key: string, url: string) {
		audio?.pause()
		if (playing === key) {
			playing = null
			return
		}
		audio = new Audio(url)
		audio.onended = () => (playing = null)
		audio.onerror = () => (playing = null)
		playing = key
		void audio.play().catch(() => (playing = null))
	}
	$effect(() => () => audio?.pause())
</script>

<section class="flex flex-col gap-2" aria-labelledby="speech-voices-title">
	<div class="flex items-center justify-between gap-2">
		<span id="speech-voices-title" class="text-xs font-semibold">
			Voices
		</span>
		{#if isAdmin}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				disabled={busy}
				onclick={refresh}
			>
				<Icons.RefreshCw
					size={14}
					class={busy ? "animate-spin" : ""}
					aria-hidden="true"
				/>
				Refresh
			</button>
		{/if}
	</div>
	{#if facts}
		<p class="text-surface-600-400 text-xs">
			{originLine(facts.voicesFrom)}
		</p>
		{#if shutsDownLine(facts)}
			<p>
				<span class="chip preset-tonal-warning text-xs">
					⏳ {shutsDownLine(facts)}
				</span>
			</p>
		{/if}
		{#if facts.notice}
			<p class="text-surface-700-300 text-xs">{facts.notice}</p>
		{/if}
	{:else}
		<p class="text-surface-600-400 text-xs">
			No voices known yet.{isAdmin ? " Refresh asks the service." : ""}
		</p>
	{/if}
	{#if error}
		<p class="text-error-600-400 text-xs" role="alert">{error}</p>
	{/if}

	{#if voices.length}
		<div class="max-h-72 overflow-y-auto rounded-lg">
			<table class="table w-full text-xs">
				<thead>
					<tr class="text-surface-600-400 text-left">
						<th scope="col" class="p-1.5">Name</th>
						<th scope="col" class="p-1.5">Labels</th>
						<th scope="col" class="p-1.5">Kind</th>
						<th scope="col" class="p-1.5"><span class="sr-only">Preview</span></th>
					</tr>
				</thead>
				<tbody>
					{#each voices as v (v.key)}
						<tr>
							<td class="p-1.5 font-semibold">{v.name}</td>
							<td class="text-surface-700-300 p-1.5">{labelLine(v) || "—"}</td>
							<td class="p-1.5">{kindOf.get(v.key) ?? "preset"}</td>
							<td class="p-1.5">
								{#if v.previewUrl}
									<button
										type="button"
										class="btn-icon btn-icon-sm preset-tonal-surface"
										aria-label={`${playing === v.key ? "Stop" : "Preview"} ${v.name}`}
										onclick={() => preview(v.key, v.previewUrl!)}
									>
										{#if playing === v.key}
											<Icons.Square size={12} aria-hidden="true" />
										{:else}
											<Icons.Play size={12} aria-hidden="true" />
										{/if}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
