<script lang="ts">
	/**
	 * A **person detail** (PLAN-private-messages §6.6): one account as another
	 * member sees it — name, `@username`, an Admin chip, the one primary
	 * **Message**, and tabs of what the reader may open of theirs. Nothing
	 * here is editable; sharing is done from the owner's side. Not a profile
	 * and not the admin Users detail, which edits the account.
	 */
	import { getContext } from "svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import * as Icons from "@lucide/svelte"
	import type { ConversationsPersonResponse } from "$lib/shared/sockets/conversations"
	import { useConversations } from "$lib/client/contexts/conversations.svelte"
	import PanelNavHeader from "../panels/PanelNavHeader.svelte"
	import DetailHero from "../panels/DetailHero.svelte"
	import PanelTabStrip, { type PanelTab } from "../panels/PanelTabStrip.svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import Avatar from "../Avatar.svelte"
	import AvatarStack from "../AvatarStack.svelte"
	import EmptyState from "../EmptyState.svelte"
	import LoadingState from "../LoadingState.svelte"
	import { personName } from "./groupMessages"
	import { openSubject, type OpenableKind } from "./openSubject"

	interface Props {
		userId: number
		/** Back to the list; only when the list is off screen (compact). */
		onBack?: () => void
		/** Switch the pane to a conversation (Message's answer). */
		onOpenConversation: (conversationId: number) => void
	}

	let { userId, onBack, onOpenConversation }: Props = $props()

	const ctx = useConversations()
	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	let detail = $state<ConversationsPersonResponse | null>(null)
	let failure = $state<string | null>(null)
	let tab = $state("session")
	let messaging = $state(false)
	let messageRefusal = $state<string | null>(null)

	$effect(() => {
		const id = userId
		detail = null
		failure = null
		let live = true
		ctx.person(id)
			.then((reply) => {
				if (live) detail = reply
			})
			.catch((err: unknown) => {
				if (live)
					failure =
						err instanceof Error
							? err.message
							: "That person isn't available."
			})
		return () => {
			live = false
		}
	})

	/** The roster's row while the detail loads, so the hero is not blank. */
	const known = $derived(detail?.person ?? ctx.whoIs(userId))
	const name = $derived(known ? personName(known) : "Person")

	const tabs: PanelTab[] = $derived([
		{
			value: "session",
			label: "Sessions",
			icon: Icons.MessagesSquare,
			count: detail?.sessions.length
		},
		{
			value: "character",
			label: "Characters",
			icon: Icons.UsersRound,
			count: detail?.characters.length
		},
		{
			value: "lorebook",
			label: "Lorebooks",
			icon: Icons.BookOpen,
			count: detail?.lorebooks.length
		}
	])

	async function message() {
		if (messaging) return
		messageRefusal = null
		if (detail?.directConversationId != null) {
			onOpenConversation(detail.directConversationId)
			return
		}
		messaging = true
		try {
			const reply = await ctx.create([userId])
			onOpenConversation(reply.conversation.id)
		} catch (err) {
			messageRefusal =
				err instanceof Error ? err.message : "Couldn't start that conversation."
		} finally {
			messaging = false
		}
	}

	function open(kind: OpenableKind, id: number, title: string) {
		void openSubject(panelsCtx, kind, id, title)
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3" data-person-detail>
	<PanelNavHeader title="Person" {onBack} backLabel="Back to messages" />

	{#if failure}
		<EmptyState icon={Icons.UserX} message={failure} />
	{:else}
		<DetailHero
			title={name}
			subtitle={known ? `@${known.username}` : undefined}
			image={avatarSrc(known)}
			letter={name}
			chips={known?.isAdmin ? adminChip : undefined}
			{actions}
		/>

		{#if !detail}
			<LoadingState message="Loading…" />
		{:else}
			<PanelTabStrip
				{tabs}
				bind:value={tab}
				ariaLabel="What {name} has that you can open"
				panelIdPrefix="person"
			/>
			<div
				id="person-{tab}"
				role="tabpanel"
				aria-labelledby="person-{tab}-tab"
				class="flex flex-col gap-1"
			>
				{#if tab === "session"}
					{#if detail.sessions.length === 0}
						<EmptyState
							icon={Icons.MessagesSquare}
							message="You're not in any of {name}'s sessions."
						/>
					{:else}
						<div role="list" aria-label="Sessions" class="flex flex-col gap-1">
							{#each detail.sessions as s (s.id)}
								<SidebarListItem
									itemType="Session"
									contentTitle={s.title}
									showIndex={false}
									onclick={() => open("session", s.id, s.title)}
								>
									{#snippet content()}
										<AvatarStack
											members={s.faces.map((f) => ({
												name: f.name,
												_avatar: f.src
											}))}
											fallback="initial"
											size="md"
											ring="ring-surface-200-800"
										/>
										{@render lines(s.title, s.subtitle)}
									{/snippet}
								</SidebarListItem>
							{/each}
						</div>
					{/if}
				{:else if tab === "character"}
					{#if detail.characters.length === 0}
						<EmptyState
							icon={Icons.UsersRound}
							message="Nothing of {name}'s is shared with you."
						/>
					{:else}
						<div role="list" aria-label="Characters" class="flex flex-col gap-1">
							{#each detail.characters as c (c.id)}
								<SidebarListItem
									itemType={c.isPersona ? "Persona" : "Character"}
									contentTitle={c.title}
									showIndex={false}
									onclick={() => open("character", c.id, c.title)}
								>
									{#snippet content()}
										<Avatar
											src={c.avatarSrc ?? undefined}
											name={c.title}
											kind={c.isPersona ? "persona" : "character"}
											size="md"
											decorative
										/>
										{@render lines(c.title, c.subtitle)}
									{/snippet}
								</SidebarListItem>
							{/each}
						</div>
					{/if}
				{:else if detail.lorebooks.length === 0}
					<EmptyState
						icon={Icons.BookOpen}
						message="Nothing of {name}'s is shared with you."
					/>
				{:else}
					<div role="list" aria-label="Lorebooks" class="flex flex-col gap-1">
						{#each detail.lorebooks as b (b.id)}
							<SidebarListItem
								itemType="Lorebook"
								contentTitle={b.title}
								showIndex={false}
								onclick={() => open("lorebook", b.id, b.title)}
							>
								{#snippet content()}
									<span
										class="bg-surface-200-800 text-surface-700-300 grid size-10 shrink-0 place-items-center rounded-base"
									>
										<Icons.BookOpen size={18} aria-hidden="true" />
									</span>
									{@render lines(b.title, b.subtitle)}
								{/snippet}
							</SidebarListItem>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

{#snippet lines(title: string, subtitle: string | null)}
	<span class="min-w-0 flex-1 text-left">
		<span class="block truncate text-lead font-medium">{title}</span>
		{#if subtitle}
			<span class="text-surface-600-400 block truncate text-xs">{subtitle}</span>
		{/if}
	</span>
{/snippet}

{#snippet adminChip()}
	<span
		class="preset-tonal-surface text-surface-700-300 rounded px-1.5 py-0.5 text-meta font-medium"
	>
		Admin
	</span>
{/snippet}

{#snippet actions()}
	<div class="flex flex-col items-start gap-1">
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500 min-h-11"
			onclick={message}
			disabled={messaging}
			aria-busy={messaging}
		>
			<Icons.Mail size={16} aria-hidden="true" />
			Message
		</button>
		{#if messageRefusal}
			<p class="text-error-600-400 text-sm" role="alert">{messageRefusal}</p>
		{/if}
	</div>
{/snippet}
