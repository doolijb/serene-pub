<script lang="ts">
	/**
	 * **Share…** for a character or a lorebook (PLAN-private-messages §6.7):
	 * the people on this pub (`conversations:people`), multi-select, the
	 * current recipients pre-ticked. Unticking revokes, and none ticked is a
	 * valid answer (stop sharing), so the confirm is never disabled for an
	 * empty pick — the replace-set the caller emits is the whole answer.
	 *
	 * Not `UserSelectModal`: that picker has no pre-ticked set and refuses an
	 * empty confirm, and both are what a replace-set needs.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import * as Icons from "@lucide/svelte"
	import { getContext, untrack } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import type { ConversationPerson } from "$lib/shared/sockets/conversations"

	interface Props {
		open: boolean
		/** "Share Mira" */
		title: string
		description?: string
		/** Who it is shared with now: pre-ticked. */
		initialUserIds: number[]
		onConfirm: (userIds: number[]) => void
		onclose: () => void
	}

	let {
		open,
		title,
		description = "Pick who can read this and make their own copy. Untick someone to stop sharing with them.",
		initialUserIds,
		onConfirm,
		onclose
	}: Props = $props()

	const userCtx: UserCtx | undefined = getContext("userCtx")

	let people = $state<ConversationPerson[] | null>(null)
	let search = $state("")
	const picked = new SvelteSet<number>()

	// Held only while the dialog is open: the roster is a cascade target, so
	// an account added elsewhere shows up without reopening.
	$effect(() => {
		if (!open) return
		return requestWithInterest(
			"conversations:people",
			{},
			(msg: { people: ConversationPerson[] }) => {
				people = msg.people ?? []
			}
		)
	})

	// Re-tick the current recipients each time it opens. Untracked: the
	// effect must not re-run (and wipe the pick) when the set changes.
	$effect(() => {
		if (!open) return
		const ids = initialUserIds
		untrack(() => {
			picked.clear()
			for (const id of ids) picked.add(id)
			search = ""
		})
	})

	const label = (p: ConversationPerson) => p.displayName || p.username

	let filtered = $derived.by(() => {
		const me = userCtx?.user?.id
		const rows = (people ?? []).filter((p) => p.id !== me)
		const term = search.trim().toLowerCase()
		if (!term) return rows
		return rows.filter(
			(p) =>
				p.username.toLowerCase().includes(term) ||
				!!p.displayName?.toLowerCase().includes(term)
		)
	})

	let unchanged = $derived(
		picked.size === initialUserIds.length &&
			initialUserIds.every((id) => picked.has(id))
	)

	let confirmLabel = $derived(
		picked.size === 0
			? initialUserIds.length
				? "Stop sharing"
				: "Share"
			: `Share with ${picked.size}`
	)

	function toggle(id: number) {
		if (picked.has(id)) picked.delete(id)
		else picked.add(id)
	}

	function confirm() {
		onConfirm([...picked])
		onclose()
	}
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) onclose()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-200-800 flex max-h-[85dvh] w-[min(92vw,480px)] flex-col gap-3 border p-4 shadow-xl"
			>
				<header class="flex min-w-0 items-start gap-2">
					<div class="min-w-0 flex-1">
						<Dialog.Title
							class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
						>
							{title}
						</Dialog.Title>
						<Dialog.Description
							class="text-surface-600-400 mt-0.5 block text-sm"
						>
							{description}
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger
						class="btn btn-sm hover:preset-tonal-surface shrink-0 p-2"
						aria-label="Close"
					>
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>

				<input
					class="input w-full"
					type="search"
					placeholder="Filter people…"
					aria-label="Filter people"
					bind:value={search}
				/>

				<div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
					{#if people === null}
						<LoadingState message="Loading people…" />
					{:else if filtered.length === 0}
						<p class="text-surface-600-400 py-6 text-center text-sm">
							{search.trim()
								? "Nobody matches that filter."
								: "Nobody else has an account on this pub yet."}
						</p>
					{:else}
						<ul class="flex flex-col gap-0.5" aria-label="People">
							{#each filtered as person (person.id)}
								{@const on = picked.has(person.id)}
								<li>
									<button
										type="button"
										class="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-base px-2.5 py-1.5 text-left hover:bg-surface-200-800 {on
											? 'sidebar-row-active'
											: ''}"
										aria-pressed={on}
										onclick={() => toggle(person.id)}
									>
										<Avatar
											src={avatarSrc(person)}
											name={label(person)}
											fallback="initial"
											size="sm"
											decorative
										/>
										<span class="min-w-0 flex-1">
											<span class="block truncate text-sm font-medium">
												{label(person)}
											</span>
											{#if person.displayName}
												<span
													class="text-surface-600-400 block truncate text-xs"
												>
													{person.username}
												</span>
											{/if}
										</span>
										{#if on}
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
				</div>

				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={onclose}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn {picked.size === 0 && initialUserIds.length
							? 'preset-filled-error-500'
							: 'preset-filled-primary-500'}"
						disabled={unchanged}
						onclick={confirm}
					>
						{confirmLabel}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
