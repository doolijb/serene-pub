<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Avatar } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onDestroy, onMount } from "svelte"

	interface Props {
		sessionId: number
		onBack: () => void
		onEdit: () => void
		onOpen: () => void
		/** Open the session's connected lorebook, when it has one. */
		onViewLorebook?: (lorebookId: number) => void
		canEdit?: boolean
	}

	let {
		sessionId,
		onBack,
		onEdit,
		onOpen,
		onViewLorebook,
		canEdit = true
	}: Props = $props()

	const socket = useTypedSocket()

	let session = $state<Sockets.Sessions.Get.Response["session"] | null>(null)
	let isLoading = $state(true)

	onMount(() => {
		socket.on("sessions:get", (msg: Sockets.Sessions.Get.Response) => {
			if (msg.session?.id === sessionId) {
				session = msg.session
				isLoading = false
			}
		})
		socket.emit("sessions:get", {
			id: sessionId
		} satisfies Sockets.Sessions.Get.Params)
	})

	onDestroy(() => {
		socket.off("sessions:get")
	})

	let characters = $derived(
		(session as any)?.sessionCharacters
			?.map((cc: any) => cc.character)
			.filter(Boolean) ?? []
	)
	let personas = $derived(
		(session as any)?.sessionPersonas
			?.map((cp: any) => cp.persona)
			.filter(Boolean) ?? []
	)
	let tags = $derived((session as any)?.tags ?? [])
	let lorebookId = $derived((session as any)?.lorebookId ?? null)
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
	<!-- Header -->
	<div class="shrink-0 pb-3">
		<PanelNavHeader
			title={session?.name || "Session"}
			{onBack}
			backLabel="Back to sessions"
			actionsLabel="Session"
		>
			{#snippet primaryAction()}
				<button
					class="btn btn-sm preset-filled-primary-500 shrink-0 p-2"
					onclick={onOpen}
					title="Go to session"
					aria-label="Go to session"
					type="button"
				>
					<Icons.MessageSquare size={16} aria-hidden="true" />
				</button>
			{/snippet}
			<!-- The {#if} lives INSIDE the snippet: a snippet passed as a prop
			     must be a direct child of the component tag. -->
			{#snippet actions()}
				{#if canEdit}
					<button
						class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
						onclick={onEdit}
						type="button"
					>
						<Icons.Pencil size={16} aria-hidden="true" />
						<span>Edit session</span>
					</button>
				{/if}
			{/snippet}
		</PanelNavHeader>
	</div>

	{#if isLoading}
		<div class="flex flex-1 items-center justify-center">
			<Icons.Loader2 size={24} class="text-surface-400 animate-spin" />
		</div>
	{:else if session}
		<div class="flex flex-1 flex-col gap-4 overflow-y-auto">
			<!-- Characters -->
			{#if characters.length > 0}
				<section class="space-y-2">
					<p
						class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
					>
						Characters
					</p>
					<div class="flex flex-col gap-2">
						{#each characters as c}
							<div class="flex items-center gap-2">
								<Avatar class="h-8 min-h-8 w-8 min-w-8">
									<Avatar.Image
										src={avatarSrc(c) || ""}
										alt={c.nickname || c.name}
										class="object-cover"
									/>
									<Avatar.Fallback>
										<Icons.User size={16} />
									</Avatar.Fallback>
								</Avatar>
								<span class="truncate text-sm font-medium">
									{c.nickname || c.name}
								</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Personas -->
			{#if personas.length > 0}
				<section class="space-y-2">
					<p
						class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
					>
						Personas
					</p>
					<div class="flex flex-col gap-2">
						{#each personas as p}
							<div class="flex items-center gap-2">
								<Avatar class="h-8 min-h-8 w-8 min-w-8">
									<Avatar.Image
										src={avatarSrc(p) || ""}
										alt={p.name}
										class="object-cover"
									/>
									<Avatar.Fallback>
										<Icons.UserCog size={16} />
									</Avatar.Fallback>
								</Avatar>
								<span class="truncate text-sm font-medium">
									{p.name}
								</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Scenario -->
			{#if session.scenario}
				<section class="space-y-1">
					<p
						class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
					>
						Scenario
					</p>
					<p class="text-sm leading-relaxed whitespace-pre-wrap">
						{session.scenario}
					</p>
				</section>
			{/if}

			<!-- Tags -->
			{#if tags.length > 0}
				<section class="space-y-1">
					<p
						class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
					>
						Tags
					</p>
					<div class="flex flex-wrap gap-1">
						{#each tags as tag}
							<span
								class="preset-tonal-surface rounded px-2 py-0.5 text-xs"
							>
								{tag}
							</span>
						{/each}
					</div>
				</section>
			{/if}
		</div>

		<!-- Below the details: quick actions for this chat. Edit opens the
		     settings form; View lorebook appears only when one is connected. -->
		<div class="shrink-0 flex flex-col gap-2 pt-3">
			{#if canEdit}
				<button
					class="btn btn-sm preset-tonal-surface w-full justify-start"
					onclick={onEdit}
					type="button"
				>
					<Icons.Pencil size={16} aria-hidden="true" />
					Edit chat
				</button>
			{/if}
			{#if lorebookId != null && onViewLorebook}
				<button
					class="btn btn-sm preset-tonal-surface w-full justify-start"
					onclick={() => onViewLorebook?.(lorebookId)}
					type="button"
				>
					<Icons.BookMarked size={16} aria-hidden="true" />
					View lorebook
				</button>
			{/if}
		</div>
	{:else}
		<p class="text-surface-700-300 py-8 text-center text-sm">
			Session not found.
		</p>
	{/if}
</div>
