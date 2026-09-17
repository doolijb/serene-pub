<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import EmbeddingStatusIcon from "../EmbeddingStatusIcon.svelte"

	interface Props {
		character: Sockets.Characters.List.Response["characterList"][0]
		onclick?: (
			character: Sockets.Characters.List.Response["characterList"][0]
		) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		onExport?: (
			character: Sockets.Characters.List.Response["characterList"][0]
		) => void
		/** Flip `isPersona`. Absent where the menu should not offer it. */
		onTogglePersona?: (
			character: Sockets.Characters.List.Response["characterList"][0]
		) => void
		/** Make this the persona a new session starts with. */
		onSetDefaultPersona?: (id: number) => void
		/** Open the move-to-folder dialog for this row. */
		onMoveToFolder?: (
			character: Sockets.Characters.List.Response["characterList"][0]
		) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
		active?: boolean
	}

	let {
		character,
		onclick,
		onEdit,
		onDelete,
		onExport,
		onTogglePersona,
		onSetDefaultPersona,
		onMoveToFolder,
		showControls = true,
		contentTitle = "Go to character",
		classes = "",
		active = false
	}: Props = $props()

	let menuOpen = $state(false)

	function handleClick() {
		onclick?.(character)
	}

	/**
	 * The row's tags, in the order the server joined them. `characters:list`
	 * carries the whole tag record — `colorPreset` included — so a row's chip
	 * is coloured from the payload it already has rather than a second lookup.
	 */
	const tags = $derived(
		((character as any).characterTags ?? [])
			.map((ct: any) => ct?.tag)
			.filter(Boolean) as Array<{ name: string; colorPreset?: string }>
	)

	/** The chip preset a tag carries, or the neutral one an uncoloured tag gets. */
	function tagColorPreset(tag: { colorPreset?: string }): string {
		return (
			tag.colorPreset ||
			"bg-primary-500/20 text-primary-600 dark:text-primary-400"
		)
	}
</script>

<SidebarListItem
	id={character.id}
	onclick={handleClick}
	{contentTitle}
	itemType="Character"
	{classes}
	showIndex={false}
	{active}
>
	{#snippet content()}
		{#if avatarSrc(character)}
			<img
				src={avatarSrc(character)}
				alt=""
				loading="lazy"
				class="h-10 w-10 shrink-0 rounded-[9px] object-cover object-top"
			/>
		{:else}
			<span
				class="bg-surface-800 grid h-10 w-10 shrink-0 place-items-center rounded-[9px]"
			>
				<Icons.UsersRound
					size={20}
					class="text-surface-400"
					aria-hidden="true"
				/>
			</span>
		{/if}
		<div class="flex min-w-0 flex-1 items-center gap-2">
			<div class="min-w-0 flex-1">
				<div
					class="flex items-center gap-1 text-left text-[15px] font-medium"
					id="character-name-{character.id}"
				>
					<span class="truncate">
						{character.nickname || character.name}
					</span>
					{#if character.isFavorite}
						<!-- The favourite marker is a glyph on the name, not a
						     border on the row: the row's border is the selected
						     state's, and one edge cannot say two things. -->
						<Icons.Star
							size={14}
							class="text-primary-500 shrink-0 fill-current"
							aria-hidden="true"
						/>
						<span class="sr-only">Favorite</span>
					{/if}
					{#if character.isPersona}
						<!-- A badge on the name, exactly like the favourite
						     star: "a character you play" is a fact about this
						     row, not a category of row. The DEFAULT persona is
						     the same glyph filled and titled, never a second
						     chip — the row's one chip slot belongs to its tags
						     (§6.4), and a chip here would evict one. -->
						<span
							class="inline-flex shrink-0"
							title={character.isDefaultPersona
								? "Default persona"
								: "Persona"}
						>
							<Icons.UserRound
								size={14}
								class="text-primary-500 {character.isDefaultPersona
									? 'fill-current'
									: ''}"
								aria-hidden="true"
							/>
						</span>
						<span class="sr-only">
							{character.isDefaultPersona
								? "Default persona"
								: "Persona"}
						</span>
					{/if}
					<EmbeddingStatusIcon
						embeddingModel={character.embeddingModel}
					/>
				</div>
				{#if character.description}
					<div
						class="text-surface-400 truncate text-left text-xs"
						id="character-desc-{character.id}"
					>
						{character.description}
					</div>
				{/if}
			</div>
			{#if tags.length > 0}
				<span class="flex shrink-0 items-center gap-1">
					<span
						class="max-w-24 truncate rounded px-1.5 py-0.5 text-[11px] {tagColorPreset(
							tags[0]
						)}"
					>
						{tags[0].name}
					</span>
					{#if tags.length > 1}
						<span class="text-surface-500 text-[11px]">
							+{tags.length - 1}
						</span>
					{/if}
				</span>
			{/if}
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && (onclick || onEdit || onExport || onDelete || onTogglePersona || onSetDefaultPersona || onMoveToFolder)}
			<div role="none" onclick={(e) => e.stopPropagation()}>
				<Popover
					open={menuOpen}
					onOpenChange={(e) => (menuOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
				>
					<Popover.Trigger
						class="btn btn-sm hover:bg-primary-600-400 shrink-0 p-3 {menuOpen
							? 'bg-primary-600-400'
							: ''}"
						aria-label="Character options"
					>
						<Icons.EllipsisVertical size={16} />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-200-800 w-[min(90vw,240px)] space-y-4 p-4 shadow-xl"
							>
								<header class="popover-menu-title">
									<Icons.User size={18} aria-hidden="true" />
									<p>Character Options</p>
								</header>
								<article class="flex flex-col gap-2">
									{#if onclick}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
											onclick={() => {
												menuOpen = false
												handleClick()
											}}
											type="button"
										>
											<Icons.Eye
												size={16}
												aria-hidden="true"
											/>
											<span>View</span>
										</button>
									{/if}
									{#if onEdit}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
											onclick={() => {
												menuOpen = false
												onEdit?.(character.id!)
											}}
											type="button"
										>
											<Icons.Pencil
												size={16}
												aria-hidden="true"
											/>
											<span>Edit</span>
										</button>
									{/if}
									{#if onTogglePersona}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
											onclick={() => {
												menuOpen = false
												onTogglePersona?.(character)
											}}
											type="button"
										>
											<Icons.UserRound
												size={16}
												aria-hidden="true"
											/>
											<span>
												{character.isPersona
													? "Not a persona"
													: "Use as persona"}
											</span>
										</button>
									{/if}
									{#if onSetDefaultPersona}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
											onclick={() => {
												menuOpen = false
												onSetDefaultPersona?.(
													character.id!
												)
											}}
											type="button"
											disabled={character.isDefaultPersona}
										>
											<Icons.UserRoundCheck
												size={16}
												aria-hidden="true"
											/>
											<span>
												{character.isDefaultPersona
													? "Default persona"
													: "Set as default persona"}
											</span>
										</button>
									{/if}
									{#if onMoveToFolder}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
											onclick={() => {
												menuOpen = false
												onMoveToFolder?.(character)
											}}
											type="button"
										>
											<Icons.FolderInput
												size={16}
												aria-hidden="true"
											/>
											<span>Move to folder…</span>
										</button>
									{/if}
									{#if onExport}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
											onclick={() => {
												menuOpen = false
												onExport?.(character)
											}}
											type="button"
										>
											<Icons.Download
												size={16}
												aria-hidden="true"
											/>
											<span>Export</span>
										</button>
									{/if}
									{#if onDelete}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
											onclick={() => {
												menuOpen = false
												onDelete?.(character.id!)
											}}
											type="button"
										>
											<Icons.Trash2
												size={16}
												aria-hidden="true"
											/>
											<span>Delete</span>
										</button>
									{/if}
								</article>
								<Popover.Arrow>
									<Popover.ArrowTip
										class="!bg-surface-200 dark:!bg-surface-800"
									/>
								</Popover.Arrow>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			</div>
		{/if}
	{/snippet}
</SidebarListItem>
