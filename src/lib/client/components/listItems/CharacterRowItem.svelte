<script lang="ts">
	/**
	 * 🚧 One row of the Characters view (plan §34.4): a character — a card and
	 * its cast members, or one cast member with no card — drawn as a list row
	 * or a tile. Reads a `CharacterRow` from `characters:page`; the pure lines
	 * (reach line, lead, chips) come from `sidebars/characterRowsView`. Each
	 * menu item is offered only when its callback is given.
	 */
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import Avatar from "../Avatar.svelte"
	import Badge from "../Badge.svelte"
	import EmbeddingStatusIcon from "../EmbeddingStatusIcon.svelte"
	import RowMenu, { type RowMenuEntries } from "../menus/RowMenu.svelte"
	import MetaLine from "../panels/MetaLine.svelte"
	import { avatarInitial } from "../avatar"
	import { avatarSrc } from "$lib/client/utils/media"
	import type { CharacterRow } from "$lib/shared/characters/characterRows"
	import { chipsOf, reachLine, rowLead } from "../sidebars/characterRowsView"

	interface Props {
		row: CharacterRow
		layout: "list" | "cards"
		active?: boolean
		onclick?: (row: CharacterRow) => void
		onEdit?: (cardId: number) => void
		onDelete?: (cardId: number) => void
		onExport?: (row: CharacterRow) => void
		/** Flip `isPersona`. Absent where the menu should not offer it. */
		onTogglePersona?: (row: CharacterRow) => void
		/** Make this the persona a new session starts with. */
		onSetDefaultPersona?: (cardId: number) => void
		onMoveToFolder?: (row: CharacterRow) => void
		/** Copy to my characters. Absent where the card is the asker's own. */
		onCopy?: (row: CharacterRow) => void
		contentTitle?: string
	}

	let {
		row,
		layout,
		active = false,
		onclick,
		onEdit,
		onDelete,
		onExport,
		onTogglePersona,
		onSetDefaultPersona,
		onMoveToFolder,
		onCopy,
		contentTitle = "Go to character"
	}: Props = $props()

	function handleClick() {
		onclick?.(row)
	}

	const key = $derived(row.rowKey.replace(/[^A-Za-z0-9_-]/g, "-"))
	const src = $derived(avatarSrc({ avatarMedia: row.face }))
	const shown = $derived(row.nickname || row.shownName)
	const lead = $derived(rowLead(row))
	const reach = $derived(reachLine(row))
	const chips = $derived(chipsOf(row))
	const hasMenu = $derived(
		!!(
			onclick ||
			onEdit ||
			onExport ||
			onDelete ||
			onTogglePersona ||
			onSetDefaultPersona ||
			onMoveToFolder ||
			onCopy
		)
	)
	const personaLabel = $derived(
		row.isDefaultPersona ? "Default persona" : "Persona"
	)

	const menuItems: RowMenuEntries = $derived([
		onclick && { label: "View", icon: Icons.Eye, onSelect: handleClick },
		onEdit &&
			row.cardId != null && {
				label: "Edit",
				icon: Icons.Pencil,
				onSelect: () => onEdit?.(row.cardId!)
			},
		onTogglePersona && {
			label: row.isPersona ? "Not a persona" : "Use as persona",
			icon: Icons.UserRound,
			onSelect: () => onTogglePersona?.(row)
		},
		onSetDefaultPersona &&
			row.cardId != null && {
				label: row.isDefaultPersona
					? "Default persona"
					: "Set as default persona",
				icon: Icons.UserRoundCheck,
				disabled: row.isDefaultPersona,
				onSelect: () => onSetDefaultPersona?.(row.cardId!)
			},
		onMoveToFolder && {
			label: "Move to folder…",
			icon: Icons.FolderInput,
			onSelect: () => onMoveToFolder?.(row)
		},
		onCopy && {
			label: "Copy to my characters",
			icon: Icons.Copy,
			onSelect: () => onCopy?.(row)
		},
		onExport && {
			label: "Export",
			icon: Icons.Download,
			onSelect: () => onExport?.(row)
		},
		onDelete && row.cardId != null && { separator: true as const },
		onDelete &&
			row.cardId != null && {
				label: "Delete",
				icon: Icons.Trash2,
				destructive: true,
				onSelect: () => onDelete?.(row.cardId!)
			}
	])
</script>

{#if layout === "list"}
	<SidebarListItem
		onclick={handleClick}
		{contentTitle}
		itemType="Character"
		itemName={shown}
		showIndex={false}
		{active}
	>
		{#snippet content()}
			<!-- The row's anatomy (STYLE-GUIDE §6.4): the 44px round face, the
			     15px name, one muted meta line, at most one chip with a +N, the
			     kebab. Decorative — the name is beside it. -->
			<Avatar
				{src}
				name={shown}
				fallback={row.hasCard ? "glyph" : "initial"}
				size="md"
				decorative
			/>
			<div class="flex min-w-0 flex-1 items-center gap-2">
				<div class="min-w-0 flex-1">
					<div
						class="text-lead flex items-center gap-1 text-left font-medium"
						id="character-name-{key}"
					>
						<span class="truncate">{shown}</span>
						{#if row.isFavorite}
							<Icons.Star
								size={14}
								class="text-primary-500 shrink-0 fill-current"
								aria-hidden="true"
							/>
							<span class="sr-only">Favorite</span>
						{/if}
						{#if row.isPersona}
							<span
								class="inline-flex shrink-0"
								title={personaLabel}
							>
								<Icons.UserRound
									size={14}
									class="text-primary-500 {row.isDefaultPersona
										? 'fill-current'
										: ''}"
									aria-hidden="true"
								/>
							</span>
							<span class="sr-only">{personaLabel}</span>
						{/if}
						<EmbeddingStatusIcon
							embeddingModel={row.embeddingModel}
						/>
					</div>
					<MetaLine id="character-desc-{key}" items={[reach]}>
						{#if lead}{lead}{/if}
					</MetaLine>
				</div>
				{#if chips.first}
					<span class="flex shrink-0 items-center gap-1">
						<Badge size="sm" tone="surface">{chips.first}</Badge>
						{#if chips.rest.length > 0}
							<span
								class="text-surface-600-400 text-meta"
								title={chips.rest.join(", ")}
							>
								+{chips.rest.length}
							</span>
						{/if}
					</span>
				{/if}
			</div>
		{/snippet}
		{#snippet controls()}
			{#if hasMenu}
				<RowMenu
					label="Character"
					triggerClass="btn btn-sm hover:bg-surface-200-800 data-[state=open]:bg-surface-200-800 shrink-0 p-3"
					items={menuItems}
				/>
			{/if}
		{/snippet}
	</SidebarListItem>
{:else}
	<div
		class="group relative aspect-[3/4] w-full overflow-hidden rounded-xl shadow-md transition-shadow hover:shadow-xl {active
			? 'ring-primary-500 ring-offset-surface-50-950 ring-2 ring-offset-2'
			: ''}"
		aria-current={active ? "true" : undefined}
	>
		<button
			type="button"
			class="absolute inset-0 h-full w-full text-left focus-visible:outline-none"
			onclick={handleClick}
			title={contentTitle}
			aria-label="{contentTitle}: {shown}"
		>
			{#if src}
				<img
					{src}
					alt=""
					loading="lazy"
					class="absolute inset-0 h-full w-full object-cover object-top"
				/>
			{:else}
				<div
					class="bg-surface-300-700 absolute inset-0 flex items-center justify-center"
				>
					{#if row.hasCard}
						<Icons.UsersRound
							class="text-surface-600-400 h-16 w-16"
							aria-hidden="true"
						/>
					{:else}
						<span
							class="text-surface-600-400 text-5xl font-medium"
							aria-hidden="true"
						>
							{avatarInitial(shown)}
						</span>
					{/if}
				</div>
			{/if}

			<div
				class="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-10"
			>
				<span
					class="flex items-center gap-1 truncate text-sm font-bold text-white drop-shadow-sm"
				>
					<span class="truncate">{shown}</span>
					{#if row.isPersona}
						<span class="inline-flex shrink-0" title={personaLabel}>
							<Icons.UserRound
								size={14}
								class="text-white {row.isDefaultPersona
									? 'fill-current'
									: ''}"
								aria-hidden="true"
							/>
						</span>
						<span class="sr-only">{personaLabel}</span>
					{/if}
					<EmbeddingStatusIcon embeddingModel={row.embeddingModel} />
				</span>
				{#if lead}
					<span
						class="line-clamp-2 text-xs leading-snug text-white/80"
					>
						{lead}
					</span>
				{/if}
				<span class="flex items-center gap-1.5 text-xs text-white/70">
					<span class="truncate">{reach}</span>
					{#if chips.first}
						<Badge size="sm" tone="surface" class="shrink-0">
							{chips.first}
						</Badge>
						{#if chips.rest.length > 0}
							<span
								class="text-meta shrink-0"
								title={chips.rest.join(", ")}
							>
								+{chips.rest.length}
							</span>
						{/if}
					{/if}
				</span>
			</div>
		</button>

		<div class="absolute top-2 right-2 flex items-center gap-1">
			{#if row.isFavorite}
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
			{#if hasMenu}
				<RowMenu
					label="Character"
					triggerClass="btn btn-sm bg-surface-950/60 hover:bg-surface-950/85 data-[state=open]:bg-surface-950/85 p-2 text-white backdrop-blur-sm"
					items={menuItems}
				/>
			{/if}
		</div>
	</div>
{/if}
