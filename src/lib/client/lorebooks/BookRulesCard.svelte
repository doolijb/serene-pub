<script lang="ts">
	/**
	 * 🚧 Book settings' **Rules** (PLAN-rulesets §4): the rules this book's
	 * stories are told by, which every session started on it adopts.
	 *
	 * A pick is asked about before it is saved, because it is the one choice
	 * here that reaches beyond the book: sessions started afterwards play the
	 * new rules, while sessions already reading the book keep the rules they
	 * started with (a session's rules are fixed at its start). Nothing on the
	 * book itself changes — its entries and cast stay as they are.
	 */
	import * as Icons from "@lucide/svelte"
	import { v4 as uuid } from "uuid"
	import BookRulesPicker from "$lib/client/components/lorebookForms/BookRulesPicker.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { toaster } from "$lib/client/utils/toaster"
	import type { RulesChoice } from "$lib/shared/rulesets/rulesOffer"

	interface Props {
		lorebookId: number
		/** The book's rules as stored (`lorebooks.primary_ruleset`). */
		current: string
	}

	let { lorebookId, current }: Props = $props()

	const socket = useTypedSocket()
	let picked = $state("")
	let choices = $state<RulesChoice[] | null>(null)
	/** The pick being asked about; null when nothing waits. */
	let asking = $state<RulesChoice | null>(null)
	let saving = $state(false)
	let error = $state("")

	// The stored rules are the picker's value whenever nothing is pending —
	// a change made in another tab arrives here through the list.
	$effect(() => {
		if (!asking && !saving) picked = current
	})

	const currentName = $derived(
		choices?.find((c) => c.id === current)?.name ?? "the current rules"
	)

	function onpick(choice: RulesChoice) {
		error = ""
		asking = choice.id === current ? null : choice
	}

	function keep() {
		asking = null
		picked = current
	}

	async function change() {
		if (!asking) return
		const next = asking
		const requestId = uuid()
		saving = true
		error = ""
		try {
			await awaitReply({
				socket,
				event: "lorebooks:update",
				params: {
					lorebook: { id: lorebookId },
					primaryRuleset: next.id,
					requestId
				},
				errorEvent: "lorebooks:update:error",
				fallbackError: "The rules could not be changed.",
				match: (data) => data?.requestId === requestId,
				matchError: (data) =>
					(data as { requestId?: string } | undefined)?.requestId ===
					requestId
			})
			asking = null
			toaster.success({
				title: "Rules changed",
				description: `New sessions on this book play ${next.name}.`
			})
		} catch (err) {
			error =
				err instanceof Error && err.message
					? err.message
					: "The rules could not be changed."
			asking = null
			picked = current
		} finally {
			saving = false
		}
	}
</script>

<section
	class="card preset-filled-surface-100-900 space-y-3 p-3"
	aria-labelledby="book-rules-heading"
	data-lore-book-rules
>
	<p
		id="book-rules-heading"
		class="text-primary-ink flex items-center gap-1.5 text-xs font-semibold"
	>
		<Icons.Scale size={13} aria-hidden="true" />
		Rules
	</p>
	<p class="text-surface-700-300 text-sm">
		The rules this book's stories are told by. Every session you start on
		it plays them.
	</p>
	<BookRulesPicker
		bind:value={picked}
		bind:choices
		labelledby="book-rules-heading"
		disabled={saving}
		{onpick}
	/>
	{#if asking}
		<div
			class="border-surface-200-800 flex flex-col gap-2 rounded-base border p-3"
			role="group"
			aria-label="Change the rules"
			data-lore-book-rules-confirm
		>
			<p class="text-sm">
				Change to <strong>{asking.name}</strong>? New sessions on this
				book play {asking.name}. Sessions already reading it keep
				{currentName}, since a session's rules are set when it starts.
			</p>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={keep}
					disabled={saving}
				>
					Keep {currentName}
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					onclick={change}
					disabled={saving}
				>
					{#if saving}
						<Icons.Loader2
							size={14}
							class="animate-spin"
							aria-hidden="true"
						/>
					{/if}
					Change rules
				</button>
			</div>
		</div>
	{/if}
	{#if error}
		<p class="text-error-600-400 text-sm" role="alert">{error}</p>
	{/if}
</section>
