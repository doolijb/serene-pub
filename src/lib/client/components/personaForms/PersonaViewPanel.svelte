<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Avatar, Tabs } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onDestroy, onMount } from "svelte"
	import EntityGalleryTab from "$lib/client/components/gallery/EntityGalleryTab.svelte"

	// embedding/embeddingModel/vectorizedAt are deliberately excluded from
	// the "personas:get" response (see personasGet's `columns` restriction)
	// — this type mirrors that rather than hand-declaring the full
	// SelectPersona shape, so the two can't drift out of sync.
	type ViewedPersona = NonNullable<Sockets.Personas.Get.Response["persona"]>

	interface Props {
		personaId: number
		onBack: () => void
		onEdit: () => void
		onSession: () => void
		onExport?: (persona: ViewedPersona) => void
	}

	let { personaId, onBack, onEdit, onSession, onExport }: Props = $props()

	const socket = useTypedSocket()

	let persona = $state<ViewedPersona | null>(null)
	let isLoading = $state(true)

	onMount(() => {
		socket.on("personas:get", (msg: Sockets.Personas.Get.Response) => {
			if (msg.persona?.id === personaId) {
				persona = msg.persona
				isLoading = false
			}
		})
		socket.emit("personas:get", {
			id: personaId
		} satisfies Sockets.Personas.Get.Params)
	})

	onDestroy(() => {
		socket.off("personas:get")
	})

	let tags = $derived(
		(persona as any)?.personaTags
			?.map((pt: any) => pt.tag?.name)
			.filter(Boolean) ?? []
	)

	let activeTab = $state("details")
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
	<!-- Header -->
	<div class="flex shrink-0 items-center gap-2 pb-3">
		<button
			class="btn btn-sm preset-filled-surface-400-600 p-2"
			onclick={onBack}
			title="Back to list"
		>
			<Icons.ChevronLeft size={16} />
		</button>
		<h2 class="flex-1 truncate font-semibold">{persona?.name || ""}</h2>
		<button
			class="btn btn-sm preset-filled-surface-400-600 p-2"
			onclick={onSession}
			title="Open sessions"
		>
			<Icons.MessageSquare size={14} />
		</button>
		{#if persona?.isOwner}
			{#if onExport}
				<button
					class="btn btn-sm preset-filled-surface-400-600 p-2"
					onclick={() => onExport?.(persona!)}
					title="Export persona"
					aria-label="Export persona"
				>
					<Icons.Download size={14} />
				</button>
			{/if}
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={onEdit}
				title="Edit persona"
			>
				<Icons.Pencil size={14} /> Edit
			</button>
		{/if}
	</div>

	{#if isLoading}
		<div class="flex flex-1 items-center justify-center">
			<Icons.Loader2 size={24} class="text-surface-400 animate-spin" />
		</div>
	{:else if persona}
		<Tabs
			value={activeTab}
			onValueChange={(e) => (activeTab = e.value)}
			class="flex min-h-0 flex-1 flex-col"
		>
			<Tabs.List class="flex shrink-0 gap-1">
				<Tabs.Trigger value="details">
					<Icons.User size={16} /> Details
				</Tabs.Trigger>
				<Tabs.Trigger value="gallery">
					<Icons.Images size={16} /> Gallery
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content
				value="details"
				class="min-h-0 flex-1 overflow-y-auto"
			>
				<div class="flex flex-col gap-3">
					<!-- Avatar + name -->
					<div class="card preset-filled-surface-100-900 flex items-center gap-3 p-3">
						<Avatar class="h-16 min-h-16 w-16 min-w-16">
							<Avatar.Image
								src={avatarSrc(persona, { full: true }) || ""}
								alt={persona.name}
								class="object-cover"
							/>
							<Avatar.Fallback>
								<Icons.User size={32} />
							</Avatar.Fallback>
						</Avatar>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<p class="truncate text-lg font-bold">
									{persona.name}
								</p>
								{#if persona.isDefault}
									<span
										class="preset-filled-primary-500 rounded px-1.5 py-0.5 text-xs font-medium"
									>
										Default
									</span>
								{/if}
							</div>
							{#if !persona.isOwner && persona.ownerName}
								<p
									class="text-surface-700-300 truncate text-xs"
								>
									Owned by {persona.ownerName}
								</p>
							{/if}
							{#if tags.length > 0}
								<div class="mt-1.5 flex flex-wrap gap-1">
									{#each tags as tag}
										<span
											class="preset-tonal-surface rounded px-2 py-0.5 text-xs"
										>
											{tag}
										</span>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					<!-- Description -->
					{#if persona.description}
						<section class="card preset-filled-surface-100-900 space-y-1 p-3">
							<p
								class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
							>
								<Icons.FileText size={13} />
								Description
							</p>
							<p
								class="text-sm leading-relaxed whitespace-pre-wrap"
							>
								{persona.description}
							</p>
						</section>
					{/if}
				</div>
			</Tabs.Content>

			<Tabs.Content
				value="gallery"
				class="min-h-0 flex-1 overflow-y-auto"
			>
				<EntityGalleryTab
					entityType="persona"
					entityId={persona.id}
					entityName={persona.name}
					isOwner={!!persona.isOwner}
					currentAvatarMediaId={persona.avatarMediaId ?? null}
				/>
			</Tabs.Content>
		</Tabs>
	{:else}
		<p class="text-surface-700-300 py-8 text-center text-sm">
			Persona not found.
		</p>
	{/if}
</div>
