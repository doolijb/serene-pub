<script lang="ts">
	/**
	 * How it starts: the four creation modes, one line each. A genre may
	 * suggest one (the chip), never lock it. Branch and next chapter ask which
	 * session they follow.
	 */
	import * as Icons from "@lucide/svelte"
	import { SESSION_CREATION_MODES, type SessionCreationMode } from "@serene-pub/sdk"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import { CREATION_MODE_WORDS, followableSessions } from "./creationModes"

	type FollowRow = Sockets.Sessions.List.Response["sessionList"][number]

	interface Props {
		mode: SessionCreationMode
		proposed: SessionCreationMode | null
		genreName: string
		/** The chosen genre's id: sessions are followed within one genre. */
		genreId: string | null
		from: number | null
		sessions: readonly FollowRow[]
		onmode: (m: SessionCreationMode) => void
		onfrom: (id: number) => void
		cardClass: string
	}
	let {
		mode,
		proposed,
		genreName,
		genreId,
		from,
		sessions,
		onmode,
		onfrom,
		cardClass
	}: Props = $props()

	let filter = $state("")

	const follows = $derived(mode === "branch" || mode === "next-chapter")
	const candidates = $derived(follows ? followableSessions(sessions, { genreId, mode }) : [])
	const shown = $derived.by(() => {
		const q = filter.trim().toLowerCase()
		if (!q || candidates.length <= 8) return candidates
		return candidates.filter((r) => (r.name ?? "").toLowerCase().includes(q))
	})
	const fromName = $derived(
		sessions.find((r) => r.id === from)?.name || "Untitled session"
	)
	const headingId = "start-mode-heading"
	const followHeadingId = "start-follow-heading"
</script>

<section class={cardClass} aria-labelledby={headingId}>
	<h3 id={headingId} class="text-sm font-medium">How it starts</h3>
	<div class="mt-2 flex flex-col gap-1" role="radiogroup" aria-labelledby={headingId}>
		{#each SESSION_CREATION_MODES as m (m)}
			{@const selected = m === mode}
			<button
				type="button"
				role="radio"
				aria-checked={selected}
				data-creation-mode={m}
				class="hover:bg-surface-200-800 flex min-h-11 w-full items-center gap-2.5 rounded-base px-2 py-1.5 text-left {selected
					? 'sidebar-row-active'
					: ''}"
				onclick={() => onmode(m)}
			>
				<span class="min-w-0 flex-1">
					<span class="flex items-center gap-2">
						<span class="text-lead font-medium">{CREATION_MODE_WORDS[m].label}</span>
						{#if proposed === m}
							<span
								class="badge preset-tonal-primary text-meta"
								title="{genreName} suggests starting this way"
							>
								Suggested
							</span>
						{/if}
					</span>
					<span class="text-surface-600-400 block text-xs">{CREATION_MODE_WORDS[m].line}</span>
				</span>
				{#if selected}
					<Icons.Check size={16} class="text-primary-500 shrink-0" aria-hidden="true" />
				{/if}
			</button>
		{/each}
	</div>

	{#if follows}
		<h4 id={followHeadingId} class="mt-3 text-sm font-medium">
			{mode === "branch" ? "Branch which session?" : "Which session does this follow?"}
		</h4>
		{#if candidates.length === 0}
			<p class="text-surface-600-400 mt-1 text-xs">
				{mode === "branch"
					? `You have no ${genreName} sessions to branch yet.`
					: `You have no ${genreName} sessions to follow yet.`}
			</p>
		{:else}
			{#if candidates.length > 8}
				<input
					type="text"
					class="input mt-2 w-full"
					placeholder="Filter sessions"
					aria-label="Filter sessions"
					bind:value={filter}
				/>
			{/if}
			<ul class="mt-2 flex flex-col gap-1" role="radiogroup" aria-labelledby={followHeadingId}>
				{#each shown as r (r.id)}
					{@const selected = r.id === from}
					<li>
						<button
							type="button"
							role="radio"
							aria-checked={selected}
							class="hover:bg-surface-200-800 flex min-h-11 w-full items-center gap-2.5 rounded-base px-2 py-1.5 text-left {selected
								? 'sidebar-row-active'
								: ''}"
							onclick={() => onfrom(r.id as number)}
						>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-lead font-medium">
									{r.name || "Untitled session"}
								</span>
								<span class="text-surface-600-400 block text-xs">
									{r.messageCount != null ? `${r.messageCount} messages · ` : ""}{timeAgo(
										r.updatedAt as string | Date | undefined
									)}
								</span>
							</span>
							{#if selected}
								<Icons.Check size={16} class="text-primary-500 shrink-0" aria-hidden="true" />
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="text-surface-600-400 mt-2 text-xs">
			{#if mode === "branch"}
				A branch keeps that session's name, cast, lorebook and settings. Change them afterwards in its settings.
			{:else if from != null}
				It continues on {fromName}'s lorebook.
			{/if}
		</p>
	{/if}
</section>
