<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import EmbeddingStatusIcon from "../EmbeddingStatusIcon.svelte"
	import RowMenu from "../menus/RowMenu.svelte"

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
				class="bg-surface-200-800 grid h-10 w-10 shrink-0 place-items-center rounded-[9px]"
			>
				<Icons.UsersRound
					size={20}
					class="text-surface-600-400"
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
						class="text-surface-600-400 truncate text-left text-xs"
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
						<span class="text-surface-600-400 text-[11px]">
							+{tags.length - 1}
						</span>
					{/if}
				</span>
			{/if}
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && (onclick || onEdit || onExport || onDelete || onTogglePersona || onSetDefaultPersona || onMoveToFolder)}
			<RowMenu
				label="Character"
				triggerClass="btn btn-sm hover:bg-surface-200-800 data-[state=open]:bg-surface-200-800 shrink-0 p-3"
				items={[
					onclick && {
						label: "View",
						icon: Icons.Eye,
						onSelect: handleClick
					},
					onEdit && {
						label: "Edit",
						icon: Icons.Pencil,
						onSelect: () => onEdit?.(character.id!)
					},
					onTogglePersona && {
						label: character.isPersona
							? "Not a persona"
							: "Use as persona",
						icon: Icons.UserRound,
						onSelect: () => onTogglePersona?.(character)
					},
					onSetDefaultPersona && {
						label: character.isDefaultPersona
							? "Default persona"
							: "Set as default persona",
						icon: Icons.UserRoundCheck,
						disabled: !!character.isDefaultPersona,
						onSelect: () => onSetDefaultPersona?.(character.id!)
					},
					onMoveToFolder && {
						label: "Move to folder…",
						icon: Icons.FolderInput,
						onSelect: () => onMoveToFolder?.(character)
					},
					onExport && {
						label: "Export",
						icon: Icons.Download,
						onSelect: () => onExport?.(character)
					},
					onDelete && { separator: true },
					onDelete && {
						label: "Delete",
						icon: Icons.Trash2,
						destructive: true,
						onSelect: () => onDelete?.(character.id!)
					}
				]}
			/>
		{/if}
	{/snippet}
</SidebarListItem>
