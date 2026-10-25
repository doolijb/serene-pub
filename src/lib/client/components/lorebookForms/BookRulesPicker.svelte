<script lang="ts">
	/**
	 * 🚧 A lorebook's **Rules** (PLAN-rulesets §4, §21; NOMENCLATURE §28 — the
	 * person reads _Rules_ and each ruleset's own name, never "ruleset"): one
	 * radio row per installed ruleset, its name and its line, the way the
	 * session form draws its Rules. No genre stands behind a book, so nothing
	 * is starred or rated.
	 *
	 * The choices come from `lorebooks:rulesChoices`, asked once per mount.
	 * New lorebook and Book settings both use it; each decides when the pick
	 * is sent.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import type { RulesChoice } from "$lib/shared/rulesets/rulesOffer"

	interface Props {
		/** The ruleset id chosen. Bindable; seeded with the default when empty. */
		value?: string
		/** The id of the element that names the group (its heading). */
		labelledby: string
		disabled?: boolean
		/** A pick, after `value` moved — Book settings asks before it saves. */
		onpick?: (choice: RulesChoice) => void
		/** The choices as listed, for a caller that names them. Bindable. */
		choices?: RulesChoice[] | null
	}

	let {
		value = $bindable(""),
		labelledby,
		disabled = false,
		onpick,
		choices = $bindable(null)
	}: Props = $props()

	const socket = useTypedSocket()
	let loadError = $state("")

	onMount(async () => {
		try {
			const reply = await awaitReply({
				socket,
				event: "lorebooks:rulesChoices",
				params: {},
				errorEvent: "lorebooks:rulesChoices:error",
				fallbackError: "The rules could not be listed.",
				match: () => true
			})
			choices = reply.choices
			if (!value) value = reply.defaultId
		} catch (err) {
			loadError =
				err instanceof Error && err.message
					? err.message
					: "The rules could not be listed."
		}
	})

	function choose(choice: RulesChoice) {
		if (disabled || choice.id === value) return
		value = choice.id
		onpick?.(choice)
	}
</script>

{#if loadError}
	<p class="text-error-600-400 text-sm" role="alert">{loadError}</p>
{:else if !choices}
	<p class="text-surface-600-400 flex items-center gap-2 text-sm">
		<Icons.Loader2 size={14} class="animate-spin" aria-hidden="true" />
		Loading the rules…
	</p>
{:else}
	<ul
		class="flex flex-col gap-1"
		role="radiogroup"
		aria-labelledby={labelledby}
		data-book-rules
	>
		{#each choices as r (r.id)}
			{@const selected = value === r.id}
			<li>
				<button
					type="button"
					role="radio"
					aria-checked={selected}
					{disabled}
					data-book-rules-choice={r.id}
					class="hover:bg-surface-200-800 flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-base px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50 {selected
						? 'sidebar-row-active'
						: ''}"
					onclick={() => choose(r)}
				>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-lead font-medium">
							{r.name}
						</span>
						{#if r.subtitle}
							<span
								class="text-surface-600-400 line-clamp-2 block text-xs"
							>
								{r.subtitle}
							</span>
						{/if}
					</span>
					{#if selected}
						<Icons.Check
							size={16}
							class="text-primary-500 shrink-0"
							aria-hidden="true"
						/>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}
