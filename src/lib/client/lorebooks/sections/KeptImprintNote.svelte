<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import type { KeptImprint } from "$lib/shared/entries/types"
	import {
		KEPT_IMPRINT_HEADING,
		KEPT_IMPRINT_WHY,
		keptImprintLine,
		settleImprint
	} from "./keptImprints"

	/**
	 * 🚧 An entry's note: what a replaced reply wrote on it that stayed,
	 * because it was changed after that reply (RF fix 4). One line per write,
	 * each with **Revert** (it overwrites, or removes the entry the reply
	 * added: `error`, STYLE-GUIDE §6.1) and **Keep**, for whoever may edit the
	 * book; a reader is told who can. The book's list comes back without the
	 * line once either is pressed, so nothing here keeps state of its own but
	 * the press in flight and its refusal.
	 */
	interface Props {
		imprints: KeptImprint[]
		/** Whoever may edit the book: the buttons. */
		mayEdit: boolean
	}

	let { imprints, mayEdit }: Props = $props()

	const socket = useTypedSocket()
	let busy = $state<number | null>(null)
	let refusal = $state<string | null>(null)

	async function settle(k: KeptImprint, choice: "revert" | "keep") {
		if (busy !== null) return
		busy = k.id
		refusal = null
		try {
			await settleImprint(socket, { imprintId: k.id, choice })
		} catch (e) {
			refusal = e instanceof Error ? e.message : String(e)
		} finally {
			busy = null
		}
	}
</script>

{#if imprints.length}
	<section
		data-kept-imprints
		class="border-surface-200-800 flex flex-col gap-2 rounded-md border p-2 text-xs"
		aria-label={KEPT_IMPRINT_HEADING}
	>
		<p class="flex items-center gap-1.5 font-medium">
			<Icons.Undo2 size={14} aria-hidden="true" class="shrink-0" />
			<span>{KEPT_IMPRINT_HEADING}</span>
		</p>
		<p class="text-surface-600-400">{KEPT_IMPRINT_WHY}</p>
		<ul class="flex flex-col gap-1.5">
			{#each imprints as k (k.id)}
				<li class="flex flex-wrap items-center gap-2" data-kept-imprint={k.id}>
					<span class="min-w-0 flex-1">{keptImprintLine(k)}</span>
					{#if mayEdit}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface"
							data-kept-keep
							disabled={busy !== null}
							onclick={() => settle(k, "keep")}
						>
							Keep
						</button>
						<button
							type="button"
							class="btn btn-sm preset-tonal-error"
							data-kept-revert
							disabled={busy !== null}
							onclick={() => settle(k, "revert")}
						>
							{#if busy === k.id}
								<Icons.Loader2 size={14} class="animate-spin" aria-hidden="true" />
							{/if}
							Revert
						</button>
					{/if}
				</li>
			{/each}
		</ul>
		{#if !mayEdit}
			<p class="text-surface-600-400">The lorebook's owner can revert it or keep it.</p>
		{/if}
		{#if refusal}
			<p class="text-error-600-400" role="alert" data-kept-refusal>{refusal}</p>
		{/if}
	</section>
{/if}
