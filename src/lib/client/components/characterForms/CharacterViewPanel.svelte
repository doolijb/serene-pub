<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		declareInterest,
		requestWithInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import EntityGalleryTab from "$lib/client/components/gallery/EntityGalleryTab.svelte"
	import SpritesTab from "$lib/client/components/sprites/SpritesTab.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import DetailHero from "$lib/client/components/panels/DetailHero.svelte"
	import PanelTabStrip from "$lib/client/components/panels/PanelTabStrip.svelte"

	// embedding/embeddingModel/vectorizedAt are deliberately excluded from
	// the "characters:get" response (see charactersGet's `columns`
	// restriction) — this type mirrors that rather than hand-declaring the
	// full SelectCharacter shape, so the two can't drift out of sync.
	type ViewedCharacter = NonNullable<
		Sockets.Characters.Get.Response["character"]
	>

	interface Props {
		characterId: number
		/**
		 * Back to the list. Omitted when the list is already on screen beside
		 * this panel (a view in desk mode), where a "back" that goes nowhere
		 * visible is only a button to explain.
		 */
		onBack?: () => void
		onEdit: () => void
		onSession: () => void
		onExport?: (character: ViewedCharacter) => void
	}

	let { characterId, onBack, onEdit, onSession, onExport }: Props = $props()

	const socket = useTypedSocket()

	let character = $state<ViewedCharacter | null>(null)
	let isLoading = $state(true)

	// The id check stays as belt and braces: the interest key below already
	// narrows the fan-out to this character, and this says the same thing
	// about the payload itself.
	function handleCharactersGet(msg: Sockets.Characters.Get.Response) {
		if (msg.character?.id === characterId) {
			character = msg.character
			isLoading = false
		}
	}

	/**
	 * The character this panel is showing, declared as a SCOPED interest
	 * (`characters:get#<id>`; the payload carries the id on `character.id`,
	 * see `SCOPED_EVENTS`) and asked for in the same effect — so a panel
	 * pointed at another character releases the old key as it takes the new
	 * one, rather than keeping the first id `useInterest` would have read
	 * once. The key is STANDING for as long as the panel lives, because
	 * `characters:get` is a cascade target: a save elsewhere re-sends it and
	 * this panel has to show the new row.
	 */
	$effect(() => {
		const id = characterId
		const release = declareInterest<"characters:get">(
			interestKey("characters:get", id),
			handleCharactersGet
		)
		socket.emit("characters:get", {
			id
		} satisfies Sockets.Characters.Get.Params)
		return release
	})

	/**
	 * The tag records themselves, not their names: `colorPreset` rides along on
	 * the joined row, so a chip is coloured from the payload this panel already
	 * holds rather than a second lookup against the tag list.
	 */
	let tags = $derived(
		((character as any)?.characterTags ?? [])
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

	/**
	 * The folders this user has, so the character's `folderId` can be SHOWN as
	 * the folder's name. BARE and standing: `characterFolders:list` is this
	 * user's whole list with nothing to scope it to, and it is a cascade target
	 * — a rename elsewhere has to land here too.
	 */
	let folders = $state<Sockets.CharacterFolders.List.Response["folders"]>([])
	$effect(() =>
		requestWithInterest(
			"characterFolders:list",
			{},
			(msg: Sockets.CharacterFolders.List.Response) =>
				(folders = msg.folders)
		)
	)

	let folderName = $derived(
		character?.folderId == null
			? undefined
			: folders.find((f) => f.id === character!.folderId)?.name
	)

	/**
	 * How this LIBRARY treats the character — favourite, persona, default
	 * persona, which folder — as one chip row under the name.
	 *
	 * None of it reaches the model, which is why it is here rather than in a
	 * details card: a card would put library bookkeeping among the fields that
	 * are actually the character. Absent entirely when none of it is true.
	 */
	let libraryChips = $derived(
		[
			character?.isFavorite
				? { icon: Icons.Star, label: "Favorite" }
				: undefined,
			character?.isDefaultPersona
				? { icon: Icons.UserRound, label: "Default persona" }
				: character?.isPersona
					? { icon: Icons.UserRound, label: "Persona" }
					: undefined,
			folderName ? { icon: Icons.Folder, label: folderName } : undefined
		].filter(Boolean) as Array<{ icon: any; label: string }>
	)

	/**
	 * Version and ownership on one quiet line. Both are facts about the card
	 * rather than about the character, so they sit together under the name
	 * instead of each claiming a row.
	 */
	let heroMeta = $derived(
		[
			character?.characterVersion
				? `v${character.characterVersion}`
				: undefined,
			!character?.isOwner && character?.ownerName
				? `Owned by ${character.ownerName}`
				: undefined
		].filter(Boolean) as string[]
	)

	let activeTab = $state("details")
	/** Stays true once the Sprites tab has been opened, so switching away does
	 *  not drop and re-request its list. */
	let spritesOpened = $state(false)
	$effect(() => {
		if (activeTab === "sprites") spritesOpened = true
	})

	/** What a character says, what it looks like, and the faces it shows. */
	const VIEW_TABS = [
		{ value: "details", label: "Details", icon: Icons.UserRound },
		{ value: "gallery", label: "Gallery", icon: Icons.Images },
		{ value: "sprites", label: "Sprites", icon: Icons.Drama }
	]
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
	<!-- Header -->
	<div class="shrink-0 pb-3">
		<PanelNavHeader
			title={character?.isPersona ? "Persona" : "Character"}
			{onBack}
			backLabel="Back to list"
			actionsLabel="Character"
			menuItems={[
				{
					label: "View sessions",
					icon: Icons.MessageSquare,
					onSelect: onSession
				},
				character?.isOwner &&
					onExport && {
						label: "Export character",
						icon: Icons.Download,
						onSelect: () => onExport?.(character!)
					}
			]}
		>
			{#snippet primaryAction()}
				{#if character?.isOwner}
					<button
						class="btn btn-sm preset-filled-primary-500 shrink-0 p-2"
						onclick={onEdit}
						title="Edit character"
						aria-label="Edit character"
						type="button"
					>
						<Icons.Pencil size={16} aria-hidden="true" />
					</button>
				{/if}
			{/snippet}
		</PanelNavHeader>
	</div>

	{#if isLoading}
		<div class="flex flex-1 items-center justify-center">
			<Icons.Loader2 size={24} class="text-surface-600-400 animate-spin" />
		</div>
	{:else if character}
		<!-- Hero: the one place this panel says who it is showing, above the
		     tabs so it holds for the gallery as well as the details. -->
		<DetailHero
			class="pb-4"
			title={character.nickname || character.name}
			subtitle={character.nickname && character.name !== character.nickname
				? character.name
				: undefined}
			meta={heroMeta.length ? heroMeta.join(" · ") : undefined}
			image={avatarSrc(character, { full: true })}
			icon={Icons.UsersRound}
			chips={libraryChips.length || tags.length > 0
				? heroChips
				: undefined}
		/>
		<div class="flex min-h-0 flex-1 flex-col">
			<!-- The same strip the character EDIT screen wears, so the two are
			     one idiom rather than two that resemble each other. -->
			<PanelTabStrip
				bind:value={activeTab}
				tabs={VIEW_TABS}
				ariaLabel="Character"
				panelIdPrefix="character-view"
			/>

			<!-- Both panels stay mounted and the inactive one is `hidden`,
			     which is what the gallery needs: it subscribes on mount, and a
			     panel torn down on every tab switch would drop and retake
			     those keys. `hidden` alone hides it — nothing here sets a
			     `display`, so the UA rule stands. -->
			<div
				id="character-view-details"
				role="tabpanel"
				aria-labelledby="character-view-details-tab"
				hidden={activeTab !== "details"}
				class="min-h-0 flex-1 overflow-y-auto"
			>
				<!-- One card per section, so a character sheet reads as a
				     set of things rather than one column of prose. The panes
				     are surface-950, which makes surface-900 the step a card
				     is legible against. A section whose field is empty is not
				     rendered at all: an empty card states a blank where the
				     character simply has none. -->
				<div class="flex flex-col gap-3 pt-3">
					{#if character.description}
						<section class="panel-card">
							<p class="text-surface-600-400 mb-1.5 text-xs">
								Description
							</p>
							<p
								class="text-surface-800-200 text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.description}
							</p>
						</section>
					{/if}

					{#if character.personality}
						<section class="panel-card">
							<p class="text-surface-600-400 mb-1.5 text-xs">
								Personality
							</p>
							<p
								class="text-surface-800-200 text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.personality}
							</p>
						</section>
					{/if}

					{#if character.scenario}
						<section class="panel-card">
							<p class="text-surface-600-400 mb-1.5 text-xs">
								Scenario
							</p>
							<p
								class="text-surface-800-200 text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.scenario}
							</p>
						</section>
					{/if}

					{#if character.firstMessage}
						<section class="panel-card">
							<p class="text-surface-600-400 mb-1.5 text-xs">
								First message
							</p>
							<p
								class="text-surface-800-200 text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.firstMessage}
							</p>
						</section>
					{/if}

					{#if character.alternateGreetings?.length}
						<section class="panel-card">
							<p class="text-surface-600-400 mb-1.5 text-xs">
								Alternate greetings ({character
									.alternateGreetings.length})
							</p>
							<div class="flex flex-col gap-1.5">
								{#each character.alternateGreetings as greeting, i}
									<details>
										<summary
											class="text-surface-600-400 cursor-pointer text-xs"
										>
											Greeting {i + 1}
										</summary>
										<p
											class="text-surface-800-200 mt-1 text-sm leading-relaxed whitespace-pre-wrap"
										>
											{greeting}
										</p>
									</details>
								{/each}
							</div>
						</section>
					{/if}

					{#if character.creatorNotes}
						<section class="panel-card">
							<p class="text-surface-600-400 mb-1.5 text-xs">
								Creator notes
							</p>
							<p
								class="text-surface-800-200 text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.creatorNotes}
							</p>
						</section>
					{/if}
				</div>
			</div>

			<div
				id="character-view-gallery"
				role="tabpanel"
				aria-labelledby="character-view-gallery-tab"
				hidden={activeTab !== "gallery"}
				class="min-h-0 flex-1 overflow-y-auto"
			>
				<EntityGalleryTab
					entityId={character.id}
					entityName={character.nickname || character.name}
					isOwner={!!character.isOwner}
					currentAvatarMediaId={character.avatarMediaId ?? null}
				/>
			</div>

			<div
				id="character-view-sprites"
				role="tabpanel"
				aria-labelledby="character-view-sprites-tab"
				hidden={activeTab !== "sprites"}
				class="min-h-0 flex-1 overflow-y-auto"
			>
				<!-- Mounted only once opened: the tab asks the server for the
				     character's sprites, which a person reading Details never needs. -->
				{#if activeTab === "sprites" || spritesOpened}
					<SpritesTab
						characterId={character.id}
						characterName={character.nickname || character.name}
						isOwner={!!character.isOwner}
					/>
				{/if}
			</div>
		</div>
	{:else}
		<p class="text-surface-700-300 py-8 text-center text-sm">
			Character not found.
		</p>
	{/if}
</div>

{#snippet heroChips()}
	{#each libraryChips as chip (chip.label)}
		<span
			class="bg-surface-200-800 text-surface-800-200 flex max-w-full items-center gap-1 rounded px-2 py-0.5 text-xs"
		>
			<chip.icon size={12} class="shrink-0" aria-hidden="true" />
			<span class="truncate">{chip.label}</span>
		</span>
	{/each}
	{#each tags as tag}
		<span class="rounded px-2 py-0.5 text-xs {tagColorPreset(tag)}">
			{tag.name}
		</span>
	{/each}
{/snippet}
