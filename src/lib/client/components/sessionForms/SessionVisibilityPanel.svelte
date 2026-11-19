<script lang="ts">
	/**
	 * The Visibility tab's body: what of the current user's data this session
	 * exposes to its other participants, and who can see it. The form owns the
	 * fetch and the tab; this draws what it was given.
	 */
	import Badge from "$lib/client/components/Badge.svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		/** The account-visibility response; undefined while it loads. */
		accountVisibility: Sockets.Sessions.AccountVisibility.Response | undefined
		/** Drop the "You are a guest" line where the form's guest banner already says it. */
		omitGuestLine?: boolean
	}

	let { accountVisibility, omitGuestLine = false }: Props = $props()
</script>

				<div class="flex flex-col gap-3 pt-3">
<div
	class="preset-tonal-surface rounded-base text-chip p-4"
>
	<div class="flex items-start gap-2">
		<Icons.Eye size={18} class="mt-0.5 shrink-0" />
		<div class="flex flex-col gap-1">
			<p class="font-semibold">
				What this session sees of your data
			</p>
			<p class="text-surface-600-400">
				Anything you own and add here becomes
				visible to this session's other
				participants, and is read by the pipelines
				that generate its replies. This shows only
				your own data — never what anyone else has
				shared.
			</p>
		</div>
	</div>
</div>

{#if !accountVisibility}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else}
	{#if !(omitGuestLine && accountVisibility.isGuest)}
		<p class="text-sm">
			{#if accountVisibility.isOwner}
				You are the <span class="font-semibold">owner</span>
				of this session.
			{:else if accountVisibility.isGuest}
				You are a <span class="font-semibold">guest</span>
				in this session.
			{:else}
				You are a participant in this session.
			{/if}
		</p>
	{/if}

	{@const ex = accountVisibility.exposed}
	{#if ex.characters.length + ex.personas.length + ex.lorebooks.length === 0}
		<div
			class="bg-surface-100-900 rounded-container text-chip p-4"
		>
			You have not added any of your own characters,
			personas, or lorebooks to this session — so it
			exposes nothing of yours.
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#if ex.characters.length}
				<div
					class="bg-surface-100-900 rounded-container flex flex-col gap-2 p-3"
				>
					<div
						class="flex items-center gap-2 text-sm font-medium"
					>
						<Icons.User size={16} /> Characters
					</div>
					<div class="flex flex-wrap gap-2">
						{#each ex.characters as c}
							<span
								class="preset-tonal-primary rounded-full px-3 py-1 text-xs"
							>
								{c.name}
							</span>
						{/each}
					</div>
				</div>
			{/if}
			{#if ex.personas.length}
				<div
					class="bg-surface-100-900 rounded-container flex flex-col gap-2 p-3"
				>
					<div
						class="flex items-center gap-2 text-sm font-medium"
					>
						<Icons.UserCircle size={16} /> Personas
					</div>
					<div class="flex flex-wrap gap-2">
						{#each ex.personas as p}
							<span
								class="preset-tonal-primary rounded-full px-3 py-1 text-xs"
							>
								{p.name}
							</span>
						{/each}
					</div>
				</div>
			{/if}
			{#if ex.lorebooks.length}
				<div
					class="bg-surface-100-900 rounded-container flex flex-col gap-2 p-3"
				>
					<div
						class="flex items-center gap-2 text-sm font-medium"
					>
						<Icons.BookOpen size={16} /> Lorebooks
					</div>
					<div class="flex flex-wrap gap-2">
						{#each ex.lorebooks as l}
							<span
								class="preset-tonal-primary rounded-full px-3 py-1 text-xs"
							>
								{l.name}
							</span>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<div class="flex flex-col gap-2">
		<p class="text-sm font-medium">
			Who can see the above
		</p>
		{#if accountVisibility.viewers.length === 0}
			<p class="text-surface-600-400 text-sm">
				No one else yet — you are the only
				participant.
			</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each accountVisibility.viewers as v}
					<div
						class="bg-surface-100-900 rounded-container text-chip flex items-center justify-between gap-3 p-3"
					>
						<span
							class="flex items-center gap-2"
						>
							<Icons.User size={16} />
							{v.username}
						</span>
						<Badge size="md" class="capitalize">
							{v.role}
						</Badge>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
				</div>
