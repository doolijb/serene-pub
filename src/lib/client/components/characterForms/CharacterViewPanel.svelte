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
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import type { Stroke, StrokeKind } from "@serene-pub/sdk"
	import { strokesOfKind, whenChipText } from "./strokes"
	import { STROKES_ENABLED } from "$lib/shared/characters/strokesFlag"
	import { socketCardStatsApi } from "./cardStatsApi"
	import { cardStatGroups, valueText } from "./cardStats"
	import { getContext } from "svelte"
	import SharePeopleModal from "$lib/client/components/sharing/SharePeopleModal.svelte"
	import SharedWithLine from "$lib/client/components/sharing/SharedWithLine.svelte"

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
		/** **Copy to my characters** landed: open the copy. */
		onCopied?: (id: number) => void
	}

	let { characterId, onBack, onEdit, onSession, onExport, onCopied }: Props =
		$props()

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")

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
	 * Sharing (PLAN-private-messages §6.7). An owner may **Share…** while
	 * accounts are on; a character read through a share is read-only — no
	 * Edit, no gallery or sprite writes (both already follow `isOwner`) — and
	 * offers **Copy to my characters** and **Export card** instead.
	 */
	let isShared = $derived(!!character?.isSharedWithMe && !character?.isOwner)
	let canShare = $derived(
		!!character?.isOwner && !!systemSettingsCtx?.settings?.isAccountsEnabled
	)
	let sharing = $state(false)
	let copyPending = $state(false)

	function handleShareConfirm(userIds: number[]) {
		if (!character) return
		// The reply re-sends `characters:get`, which redraws Shared with.
		socket.emit("characters:share", { characterId: character.id, userIds })
	}

	function handleCopy() {
		if (!character || copyPending) return
		copyPending = true
		socket.emit("characters:duplicate", { characterId: character.id })
	}

	// Only the copy THIS panel asked for opens; a refusal is said by Layout's
	// catch-all and only re-arms the verb here.
	$effect(() =>
		declareInterest<"characters:duplicate">(
			"characters:duplicate",
			(msg) => {
				if (!copyPending) return
				copyPending = false
				if (msg.character?.id) onCopied?.(msg.character.id)
			}
		)
	)
	$effect(() =>
		declareInterest<"characters:duplicate:error">(
			"characters:duplicate:error",
			() => (copyPending = false)
		)
	)

	/**
	 * The card's strokes of one kind, when it is painted in them. Strokes
	 * paused (`STROKES_ENABLED` off): none — the fields show their prose.
	 */
	const strokesFor = (kind: StrokeKind) =>
		STROKES_ENABLED
			? strokesOfKind(((character as any)?.strokes ?? []) as Stroke[], kind)
			: []

	/**
	 * 🚧 The card's stats (§B.4), read for its owner only — a card's stats
	 * are its owner's to see. Shown when the card carries any.
	 */
	const cardStatsApi = socketCardStatsApi(socket)
	let cardStats = $state<Sockets.CardState.Get.Response | null>(null)
	let statGroups = $derived(cardStats ? cardStatGroups(cardStats) : [])
	$effect(() => {
		const id = character?.isOwner ? character.id : null
		cardStats = null
		if (!id) return
		let live = true
		cardStatsApi.read(id).then(
			(res) => {
				if (live) cardStats = res
			},
			() => {}
		)
		return () => {
			live = false
		}
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
			"bg-primary-500/20 text-primary-ink"
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
				? character.isSharedWithMe
					? `Shared by ${character.ownerName} · read only`
					: `Owned by ${character.ownerName}`
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

<!-- One column, its 12px gap the only space between header, hero and tabs
     (STYLE-GUIDE §6.3: no margin or padding wrapper under the header). -->
<div class="flex h-full flex-col gap-3 overflow-hidden">
	<!-- The title is the KIND; the hero below carries the name. Edit is the
	     hero's primary, the rarer actions are this header's ⋯. -->
	<PanelNavHeader
		title={character?.isPersona ? "Persona" : "Character"}
		{onBack}
		backLabel="Back to list"
		actionsLabel="Character"
		menuItems={isShared
			? [
					{
						label: "Copy to my characters",
						icon: Icons.Copy,
						disabled: copyPending,
						onSelect: handleCopy
					},
					onExport && {
						label: "Export card",
						icon: Icons.Download,
						onSelect: () => onExport?.(character!)
					}
				]
			: [
					{
						label: "View sessions",
						icon: Icons.MessageSquare,
						onSelect: onSession
					},
					canShare && {
						label: "Share…",
						icon: Icons.Share2,
						onSelect: () => (sharing = true)
					},
					character?.isOwner &&
						onExport && {
							label: "Export character",
							icon: Icons.Download,
							onSelect: () => onExport?.(character!)
						}
				]}
	/>

	{#if isLoading}
		<LoadingState message="Loading character…" />
	{:else if character}
		<!-- Hero: the one place this panel says who it is showing, above the
		     tabs so it holds for the gallery as well as the details. -->
		<DetailHero
			title={character.nickname || character.name}
			subtitle={character.nickname &&
			character.name !== character.nickname
				? character.name
				: undefined}
			meta={heroMeta.length ? heroMeta.join(" · ") : undefined}
			image={avatarSrc(character, { full: true })}
			icon={Icons.UsersRound}
			chips={libraryChips.length || tags.length > 0
				? heroChips
				: undefined}
			actions={character.isOwner ? heroActions : undefined}
		/>
		{#if character.isOwner}
			<SharedWithLine people={character.sharedWith} class="-mt-1 px-1" />
		{/if}
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
				<!-- Two columns once the detail has the room (notes 14); each card
				     keeps a readable measure. -->
				<div
					class="grid items-start gap-3 pt-3 @3xl/detail:grid-cols-2"
				>
					{#if character.description}
						<section class="panel-card">
							<p class="text-surface-600-400 mb-1.5 text-xs">
								Description
							</p>
							{#if strokesFor("description").length}
								<ul class="flex flex-col gap-1.5" data-view-strokes="description">
									{#each strokesFor("description") as { stroke }, i (i)}
										<li
											class="flex items-start gap-2 text-sm {stroke.when
												?.mode === 'off'
												? 'opacity-60'
												: ''}"
										>
											<span
												class="chip shrink-0 text-meta {stroke.when
													?.mode === 'keywords'
													? 'preset-tonal-primary'
													: 'preset-tonal-surface'}"
												>{whenChipText(stroke.when)}</span
											>
											<span
												class="text-surface-800-200 min-w-0 leading-relaxed whitespace-pre-wrap"
											>
												{#if stroke.label}<span class="font-medium"
														>{stroke.label}:</span
													>{/if}
												{stroke.text}
											</span>
										</li>
									{/each}
								</ul>
							{:else}
								<p
									class="text-surface-800-200 text-sm leading-relaxed whitespace-pre-wrap"
								>
									{character.description}
								</p>
							{/if}
						</section>
					{/if}

					{#if character.personality}
						<section class="panel-card">
							<p class="text-surface-600-400 mb-1.5 text-xs">
								Personality
							</p>
							{#if strokesFor("personality").length}
								<ul class="flex flex-col gap-1.5" data-view-strokes="personality">
									{#each strokesFor("personality") as { stroke }, i (i)}
										<li
											class="flex items-start gap-2 text-sm {stroke.when
												?.mode === 'off'
												? 'opacity-60'
												: ''}"
										>
											<span
												class="chip shrink-0 text-meta {stroke.when
													?.mode === 'keywords'
													? 'preset-tonal-primary'
													: 'preset-tonal-surface'}"
												>{whenChipText(stroke.when)}</span
											>
											<span
												class="text-surface-800-200 min-w-0 leading-relaxed whitespace-pre-wrap"
											>
												{#if stroke.label}<span class="font-medium"
														>{stroke.label}:</span
													>{/if}
												{stroke.text}
											</span>
										</li>
									{/each}
								</ul>
							{:else}
								<p
									class="text-surface-800-200 text-sm leading-relaxed whitespace-pre-wrap"
								>
									{character.personality}
								</p>
							{/if}
						</section>
					{/if}

					{#if statGroups.length}
						<section class="panel-card" data-view-stats>
							<p class="text-surface-600-400 mb-1.5 text-xs">Stats</p>
							<div class="flex flex-col gap-2">
								{#each statGroups as group (group.sheetId ?? "loose")}
									<div>
										<p class="text-surface-600-400 text-meta">
											{group.label}
										</p>
										<dl
											class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm"
										>
											{#each group.rows as row (row.slot.slotId)}
												<dt class="text-surface-600-400">
													{row.slot.label}
												</dt>
												<dd class="text-surface-800-200">
													{valueText(row.slot, row.value ?? row.fallback) ||
														"—"}
												</dd>
											{/each}
										</dl>
									</div>
								{/each}
							</div>
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
		<EmptyState icon={Icons.UserX} message="Character not found." />
	{/if}
</div>

{#snippet heroActions()}
	<button
		type="button"
		class="btn btn-sm preset-filled-primary-500"
		onclick={onEdit}
	>
		<Icons.Pencil size={16} aria-hidden="true" />
		Edit
	</button>
{/snippet}

{#snippet heroChips()}
	{#each libraryChips as chip (chip.label)}
		<span
			class="bg-surface-200-800 text-surface-700-300 flex max-w-full items-center gap-1 rounded px-2 py-0.5 text-xs"
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

{#if character && canShare}
	<SharePeopleModal
		open={sharing}
		title="Share {character.nickname || character.name}"
		initialUserIds={(character.sharedWith ?? []).map((p) => p.id)}
		onConfirm={handleShareConfirm}
		onclose={() => (sharing = false)}
	/>
{/if}
