<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import * as Icons from "@lucide/svelte"
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
		/** Open the move-to-folder dialog for this tile. */
		onMoveToFolder?: (
			character: Sockets.Characters.List.Response["characterList"][0]
		) => void
		showControls?: boolean
		contentTitle?: string
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
		active = false
	}: Props = $props()

	function handleClick() {
		onclick?.(character)
	}
</script>

<!-- Selection is a RING on a tile, where the shared `.sidebar-row-active`
     treatment cannot be seen: its tonal fill and its inset leading bar both sit
     under the portrait that covers the card edge to edge. The offset keeps the
     ring clear of the artwork so it reads as a frame around the tile. -->
<div
	class="group relative aspect-[3/4] w-full overflow-hidden rounded-xl shadow-md transition-shadow hover:shadow-xl {active
		? 'ring-primary-500 ring-offset-surface-950 ring-2 ring-offset-2'
		: ''}"
	aria-current={active ? "true" : undefined}
>
	<button
		type="button"
		class="absolute inset-0 h-full w-full text-left focus-visible:outline-none"
		onclick={handleClick}
		title={contentTitle}
		aria-label="{contentTitle}: {character.nickname || character.name}"
	>
		{#if avatarSrc(character)}
			<img
				src={avatarSrc(character)}
				alt=""
				loading="lazy"
				class="absolute inset-0 h-full w-full object-cover object-top"
			/>
		{:else}
			<div
				class="bg-surface-300-700 absolute inset-0 flex items-center justify-center"
			>
				<Icons.UsersRound
					class="text-surface-600-400 h-16 w-16"
					aria-hidden="true"
				/>
			</div>
		{/if}

		<div
			class="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-10"
		>
			<span
				class="flex items-center gap-1 truncate text-sm font-bold text-white drop-shadow-sm"
			>
				<span class="truncate">
					{character.nickname || character.name}
				</span>
				{#if character.isPersona}
					<!-- The same badge the list row puts after the name, on the
					     tile's caption rather than in the corner cluster: the corner
					     is the favourite star and the ⋯ menu, and a third thing there
					     starts covering the artwork. -->
					<span
						class="inline-flex shrink-0"
						title={character.isDefaultPersona
							? "Default persona"
							: "Persona"}
					>
						<Icons.UserRound
							size={14}
							class="text-white {character.isDefaultPersona
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
			</span>
			{#if character.description}
				<span class="line-clamp-2 text-xs leading-snug text-white/80">
					{character.description}
				</span>
			{/if}
		</div>
	</button>

	<div class="absolute top-2 right-2 flex items-center gap-1">
		{#if character.isFavorite}
			<span
				class="bg-surface-950/60 grid size-6 place-items-center rounded-full backdrop-blur-sm"
			>
				<Icons.Star
					size={14}
					class="text-primary-500 fill-current"
					aria-hidden="true"
				/>
				<span class="sr-only">Favorite</span>
			</span>
		{/if}
		{#if showControls && (onclick || onEdit || onExport || onDelete || onTogglePersona || onSetDefaultPersona || onMoveToFolder)}
			<RowMenu
				label="Character"
				triggerClass="btn btn-sm bg-surface-950/60 hover:bg-surface-950/85 data-[state=open]:bg-surface-950/85 p-2 text-white backdrop-blur-sm"
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
	</div>
</div>
