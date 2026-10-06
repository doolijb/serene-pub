<script lang="ts">
	import {
		onCardImported,
		onImportResolved
	} from "$lib/client/contexts/characterImports.svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { getContext, onDestroy, onMount } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { flip } from "svelte/animate"
	import { fade } from "svelte/transition"
	import { MOTION, motionDuration } from "$lib/client/utils/motion"
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import FileDropzone from "$lib/client/components/FileDropzone.svelte"
	import * as Icons from "@lucide/svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import ViewToolbar from "$lib/client/components/panels/ViewToolbar.svelte"
	import ListCardToggle from "$lib/client/components/panels/ListCardToggle.svelte"
	import { toolbarButtonClass } from "$lib/client/components/panels/toolbarButton"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import CharacterForm from "../characterForms/CharacterForm.svelte"
	import CharacterCreator from "../modals/CharacterCreatorModal.svelte"
	import CharacterUnsavedChangesModal from "../modals/CharacterUnsavedChangesModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { cardFileForUpload } from "$lib/client/utils/cardUpload"
	import { createViewMode } from "$lib/client/utils/viewMode.svelte"
	import CharacterListItem from "../listItems/CharacterListItem.svelte"
	import CharacterViewPanel from "../characterForms/CharacterViewPanel.svelte"
	import CharacterCardItem from "../listItems/CharacterCardItem.svelte"
	import CharacterFolderHeader from "../listItems/CharacterFolderHeader.svelte"
	import CharacterFolderNameModal from "../modals/CharacterFolderNameModal.svelte"
	import CharacterMoveToFolderModal from "../modals/CharacterMoveToFolderModal.svelte"
	import EmptyState from "../EmptyState.svelte"
	import ImportConflictModal from "../modals/ImportConflictModal.svelte"
	import { describeOverwriteLosses } from "$lib/client/lorebooks/overwriteLosses"
	import { lorebookImportedToast } from "$lib/client/lorebooks/lorebookImportedToast"
	import CharacterExportModal from "../modals/CharacterExportModal.svelte"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"
	import type { SocketEventMap } from "$lib/client/sockets/typedSocket"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	const panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	const systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	const userSettingsCtx: UserSettingsCtx = $state(
		getContext("userSettingsCtx")
	)

	// Measures the view's own box, not the window: the same view is 400px in
	// the dock and ~1376px full page, and both must land in the right shape.
	const vm = new ViewModeTracker()

	let characterList: any[] = $state([])
	let isLoading = $state(true)
	// Cards, not the shared default: a character is a portrait first, and
	// this view is the one place the artwork is the row. A stored choice
	// still wins.
	const viewMode = createViewMode(
		"serene-pub:viewMode:charactersSidebar",
		"cards"
	)
	let search = $state("")
	let characterId: number | undefined = $state()
	let viewingId: number | undefined = $state()
	let returnToViewId: number | undefined = $state()

	/**
	 * The row whose detail is showing beside the list in desk mode — the one
	 * being viewed, or the one being edited (editing is entered from a row, so
	 * the row it came from stays marked).
	 */
	let selectedCharacterId = $derived(characterId ?? viewingId)
	let isCreating = $state(false)
	let showCharacterCreator = $state(false)
	let showDeleteModal = $state(false)
	let characterToDelete: number | undefined = $state(undefined)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let showImportModal = $state(false)
	let onEditFormCancel: (() => void) | undefined = $state()
	/** The card's own book, held on the server for the dialog (NOMENCLATURE §16). */
	let importingLorebook: Sockets.Characters.HeldCardBook | null = $state(null)
	/** The dialog's name field, starting at the book's own name. */
	let importingLorebookName = $state("")
	let importingLorebookCharacter: SelectCharacter | null = $state(null)
	let showLorebookImportConfirmationModal = $state(false)
	// Set when lorebooks:import comes back with status "conflict" — the
	// embedded book's uuid matched a lorebook this user already has, but its
	// content differs.
	let lorebookImportConflict:
		| Sockets.Lorebooks.Import.Response["conflict"]
		| undefined = $state(undefined)
	let showLorebookImportConflictModal = $state(false)
	/**
	 * Set while THIS panel has a `lorebooks:import` / `importResolve` in
	 * flight. The replies are bare and reach every tab and every surface the
	 * person has open (the Lorebooks workspace imports too), so a reply is
	 * this panel's to toast or prompt on only when it asked (finding #155).
	 */
	let lorebookImportPending = $state(false)
	// Set when characters:importCard comes back with status "conflict" — the
	// card's uuid matched a character this user already has, but its
	// content differs. The file waits on the server as a held import; the
	// choice names it.
	let characterImportConflict:
		| Sockets.Characters.ImportCard.Response["conflict"]
		| undefined = $state(undefined)
	let showCharacterImportConflictModal = $state(false)
	let exportingCharacter: {
		id: number
		name: string
		nickname?: string | null
		avatar?: string | null
	} | null = $state(null)
	let showExportModal = $state(false)
	let characterFormHasChanges = $state(false)

	// Note: Despite the name "isSafeToClose", this prop actually tracks when there ARE changes
	// It's misnamed in the CharacterForm component - it should be called "hasChanges"

	$effect(() => {
		if (panelsCtx.digest.characterId) {
			const targetId = panelsCtx.digest.characterId
			delete panelsCtx.digest.characterId
			if (characterId !== targetId && characterFormHasChanges) {
				// Promise-based, unlike onEditFormCancel (CharacterForm's own
				// discard flow) — lets the switch actually complete once
				// discard is confirmed instead of silently landing back on
				// the list, since panelsCtx.digest.characterId is already
				// gone by the time an async confirm resolves.
				handleOnClose().then((confirmed) => {
					if (confirmed) characterId = targetId
				})
			} else {
				characterId = targetId
			}
		}
	})

	// Same as above, but opens the read-only detail view instead of the edit
	// form — used when arriving from a context that just wants to look up a
	// character (eg. clicking a name in a session), not edit it.
	$effect(() => {
		if (panelsCtx.digest.viewCharacterId) {
			viewingId = panelsCtx.digest.viewCharacterId
			delete panelsCtx.digest.viewCharacterId
		}
	})

	/**
	 * The filter popout's one pick, on top of whatever the filter box says.
	 *
	 * One at a time rather than a set: `All` is the resting state, and two
	 * picks lit at once would have to mean either "and" or "or" without the
	 * popout being able to say which.
	 */
	type CharacterChip = "all" | "favorite" | "persona" | `tag:${string}`
	let chipFilter: CharacterChip = $state("all")

	/** Whether the toolbar's filter popout is showing. */
	let filterOpen = $state(false)

	/**
	 * A pick for every tag any character carries, taken from the whole list
	 * rather than the filtered one — a set that reshuffled under the cursor as
	 * the filter box narrowed would move the row being aimed at.
	 *
	 * The whole tag record and not just its name: `characters:list` carries
	 * `colorPreset` already, so the popout's dot is coloured from the payload
	 * this view has rather than a second lookup.
	 */
	let chipTags = $derived.by(() => {
		const byName = new Map<string, { name: string; colorPreset?: string }>()
		for (const c of characterList) {
			for (const ct of (c as any).characterTags ?? []) {
				if (!ct?.tag?.name || byName.has(ct.tag.name)) continue
				byName.set(ct.tag.name, {
					name: ct.tag.name,
					colorPreset: ct.tag.colorPreset ?? undefined
				})
			}
		}
		return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
	})

	/**
	 * A tag pick whose tag has left every character reads as `All`, so the
	 * popout only ever shows a pick that is still on the list.
	 */
	let activeChip = $derived.by(() => {
		if (chipFilter.startsWith("tag:")) {
			const name = chipFilter.slice(4)
			return chipTags.some((t) => t.name === name) ? chipFilter : "all"
		}
		return chipFilter
	})

	/** The popout as rendered: the two standing picks, then the tags. */
	let filterOptions: Array<{
		value: CharacterChip
		label: string
		colorPreset?: string
	}> = $derived([
		{ value: "all", label: "All" },
		{ value: "favorite", label: "Favorites" },
		// Between the standing picks and the tags, because it IS a standing
		// pick: "a character you play" is a fact the row carries, not a label
		// somebody attached to it. It narrows this list only — Jump's
		// `characters` scope still searches every character, since a persona
		// is not a kind of row to scope to.
		{ value: "persona", label: "Personas" },
		...chipTags.map((t) => ({
			value: `tag:${t.name}` as CharacterChip,
			label: t.name,
			colorPreset: t.colorPreset
		}))
	])

	/**
	 * What the dismissible chip under the toolbar says. Undefined at `All`,
	 * which is the same condition as "there is no chip".
	 */
	let activeFilterLabel = $derived(
		activeChip === "all"
			? undefined
			: filterOptions.find((o) => o.value === activeChip)?.label
	)

	/** The dot's colour for a tag, or the neutral one an uncoloured tag gets. */
	function tagDotPreset(colorPreset?: string): string {
		return (
			colorPreset ||
			"bg-primary-500/20 text-primary-600 dark:text-primary-400"
		)
	}

	/** A pick applies and closes the popout: one choice, one interaction. */
	function pickFilter(value: CharacterChip) {
		chipFilter = value
		filterOpen = false
	}

	/**
	 * Whether anything is currently hiding rows — the empty state offers to
	 * create a character only when the list is genuinely empty, not when a
	 * filter has emptied it.
	 */
	let listIsNarrowed = $derived(!!search || activeChip !== "all")

	// Filtered list
	let filteredCharacters: any[] = $derived.by(() => {
		let list = [...characterList]
		// Sort favorites first
		list.sort((a, b) => {
			if (a.isFavorite && !b.isFavorite) return -1
			if (!a.isFavorite && b.isFavorite) return 1
			return 0
		})

		// The chip narrows first, then the text: the two stack, so a tag chip
		// plus a typed word means both, never either.
		if (activeChip === "favorite") {
			list = list.filter((c: any) => c.isFavorite)
		} else if (activeChip === "persona") {
			list = list.filter((c: any) => c.isPersona)
		} else if (activeChip.startsWith("tag:")) {
			const name = activeChip.slice(4)
			list = list.filter((c: any) =>
				(c.characterTags ?? []).some(
					(ct: any) => ct?.tag?.name === name
				)
			)
		}

		if (!search) return list

		const searchLower = search.toLowerCase()
		return list.filter((c: any) => {
			// Search by name
			if (c.name!.toLowerCase().includes(searchLower)) return true

			// Search by description
			if (
				c.description &&
				c.description.toLowerCase().includes(searchLower)
			)
				return true

			// Search by tags
			if (c.characterTags) {
				const tagMatch = c.characterTags.some(
					(ct: any) =>
						ct.tag &&
						ct.tag.name.toLowerCase().includes(searchLower)
				)
				if (tagMatch) return true
			}

			return false
		})
	})

	/* ── folders ─────────────────────────────────────────────────────────
	 *
	 * A folder is a shelf in this user's library: flat, a character is in at
	 * most one, and it holds only characters. It is NOT a tag — a tag is a
	 * label many rows share, a folder is where one row lives.
	 */

	let folders: Sockets.CharacterFolders.List.Response["folders"] = $state([])

	/** Which groups are folded away. Persisted so it survives a reload. */
	const COLLAPSED_FOLDERS_KEY = "serene-pub:characterFolders:collapsed"

	function loadCollapsedFolders(): number[] {
		// try/catch and not just a typeof guard: a private window, or storage
		// the user has blocked, THROWS on read rather than answering null.
		try {
			if (typeof localStorage === "undefined") return []
			const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY)
			if (!raw) return []
			const parsed = JSON.parse(raw)
			return Array.isArray(parsed)
				? parsed.filter((id) => typeof id === "number")
				: []
		} catch {
			return []
		}
	}

	// SvelteSet, not `$state(new Set())`: a plain Set's `.add()`/`.delete()`
	// are not reactive, so every header would keep its first expanded state.
	const collapsedFolderIds = new SvelteSet<number>(loadCollapsedFolders())

	function toggleFolder(id: number) {
		if (collapsedFolderIds.has(id)) collapsedFolderIds.delete(id)
		else collapsedFolderIds.add(id)
		try {
			localStorage.setItem(
				COLLAPSED_FOLDERS_KEY,
				JSON.stringify([...collapsedFolderIds])
			)
		} catch {
			// A browser that will not store this still has to fold the group;
			// the choice simply does not outlive the session.
		}
	}

	/**
	 * The list as the folders shape it: everything at the top level first
	 * under no header, then one group per folder in the server's order
	 * (position, then name).
	 *
	 * Built from the ALREADY filtered and sorted list, so a folder the filter
	 * has emptied produces no group and therefore no header (§6.4) — an empty
	 * header would be a promise of rows that are not there. A row whose
	 * `folderId` names a folder this list does not have falls back to the top
	 * level rather than disappearing.
	 */
	let folderGroups = $derived.by(() => {
		const known = new Set(folders.map((f) => f.id))
		const byFolder = new Map<number, any[]>()
		const ungrouped: any[] = []
		for (const c of filteredCharacters) {
			const folderId = (c as any).folderId
			if (folderId == null || !known.has(folderId)) {
				ungrouped.push(c)
				continue
			}
			const bucket = byFolder.get(folderId)
			if (bucket) bucket.push(c)
			else byFolder.set(folderId, [c])
		}
		return {
			ungrouped,
			groups: folders
				.map((folder) => ({
					folder,
					characters: byFolder.get(folder.id) ?? []
				}))
				.filter((group) => group.characters.length > 0)
		}
	})

	/**
	 * A row's tag names, as `characters:update` wants them back.
	 *
	 * ⚠ Load-bearing. That handler runs `processCharacterTags` with whatever
	 * `tags` the payload carries and an ABSENT array reads as an empty one — so
	 * a "minimal" `{ id, isPersona }` payload would strip every tag off the
	 * character as a side effect of flipping one flag. Sending the names it
	 * already has back unchanged is what makes the write a no-op for tags.
	 */
	function characterTagNames(character: any): string[] {
		return ((character.characterTags ?? []) as any[])
			.map((ct) => ct?.tag?.name)
			.filter((name): name is string => !!name)
	}

	/** "Use as persona" / "Not a persona" — the one flag, flipped. */
	function handleTogglePersona(character: any) {
		const next = !character.isPersona
		socket.emit("characters:update", {
			character: {
				id: character.id,
				isPersona: next,
				// Clearing the flag clears the default with it: a default
				// persona the user does not play is not a state worth having,
				// and the handler only acts on an EXPLICIT false.
				...(next ? {} : { isDefaultPersona: false }),
				tags: characterTagNames(character)
			} as unknown as UpdateCharacter
		})
	}

	/** The persona a new session starts with. One per user, server-enforced. */
	function handleSetDefaultPersona(id: number) {
		socket.emit("characters:setDefaultPersona", { characterId: id })
	}

	/* ── folder dialogs ─────────────────────────────────────────────────── */

	/** The name dialog, in whichever of its two modes, or closed. */
	let folderDialog:
		| { mode: "create" }
		| { mode: "rename"; id: number; name: string }
		| null = $state(null)
	let folderDialogError = $state("")
	let folderDialogBusy = $state(false)

	function openCreateFolder() {
		folderDialogError = ""
		folderDialogBusy = false
		folderDialog = { mode: "create" }
	}

	function openRenameFolder(folder: { id: number; name: string }) {
		folderDialogError = ""
		folderDialogBusy = false
		folderDialog = { mode: "rename", id: folder.id, name: folder.name }
	}

	function closeFolderDialog() {
		folderDialog = null
		folderDialogError = ""
		folderDialogBusy = false
	}

	function submitFolderDialog(name: string) {
		if (!folderDialog) return
		folderDialogError = ""
		folderDialogBusy = true
		if (folderDialog.mode === "create")
			socket.emit("characterFolders:create", { name })
		else
			socket.emit("characterFolders:update", {
				id: folderDialog.id,
				name
			})
	}

	/** The folder a confirm is standing over, or null. */
	let folderToDelete: { id: number; name: string } | null = $state(null)

	function confirmDeleteFolder() {
		if (!folderToDelete) return
		socket.emit("characterFolders:delete", { id: folderToDelete.id })
		folderToDelete = null
	}

	/** The character the move dialog is open on, or null. */
	let characterToMove: any = $state(null)

	function openMoveToFolder(character: any) {
		characterToMove = character
	}

	function pickFolderForCharacter(folderId: number | null) {
		if (characterToMove)
			socket.emit("characters:setFolder", {
				characterId: characterToMove.id,
				folderId
			})
		characterToMove = null
	}

	/**
	 * Jump, scoped to this view.
	 *
	 * The overlay's input IS `search` — the same state the toolbar's box binds
	 * — so typing in the overlay narrows the list behind it and leaves it
	 * narrowed when the overlay closes. `getHits` hands over what is ALREADY
	 * on screen rather than running a second search over the same array.
	 *
	 * The effect reads nothing reactive (the registration is closures over
	 * state, not state), so it registers once and its return value is the
	 * unregister Svelte calls on destroy.
	 */
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)
	$effect(() =>
		jumpCtx?.registerScope("characters", {
			label: "Characters",
			placeholder: "Filter characters",
			getQuery: () => search,
			setQuery: (next) => (search = next),
			getHits: () =>
				filteredCharacters.map((c: any) => ({
					kind: "character" as const,
					id: c.id,
					title: c.name,
					subtitle: c.description || undefined
				})),
			// The whole of `handleCharacterClick`, which is the row's own
			// onclick: the read-only detail screen, not the edit form.
			onPick: (hit) => handleViewClick(Number(hit.id))
		})
	)

	/**
	 * What the draft starts as. `{ isPersona: true }` is the whole of "Write a
	 * persona": same creator, same form, one field already true — a persona IS
	 * a character, so a second path to write one would be the parallel form the
	 * merge just deleted.
	 */
	let createPreset: { isPersona?: boolean } | undefined = $state(undefined)

	function startCreate(preset?: { isPersona?: boolean }) {
		// Clear tutorial flag when user interacts with the highlighted button
		if (panelsCtx.digest.tutorial) {
			panelsCtx.digest.tutorial = false
		}
		createPreset = preset

		// Check if easy character creation is enabled — one setting for both,
		// since there is one kind of row to create.
		if (userSettingsCtx.settings?.enableEasyCharacterCreation) {
			showCharacterCreator = true
		} else {
			// Use regular edit form for creation
			isCreating = true
			characterId = undefined
		}
	}

	function handleCreateClick() {
		startCreate()
	}

	function handleCreatePersonaClick() {
		startCreate({ isPersona: true })
	}

	function handleViewClick(id: number) {
		viewingId = id
	}

	function handleEditClick(id: number) {
		characterId = id
		viewingId = undefined
	}

	function handleEditFromView() {
		returnToViewId = viewingId
		characterId = viewingId
		viewingId = undefined
	}

	function closeCharacterForm() {
		isCreating = false
		createPreset = undefined
		characterId = undefined
		characterFormHasChanges = false
		const returnId = returnToViewId
		returnToViewId = undefined
		if (returnId) viewingId = returnId
	}

	function handleDeleteClick(id: number) {
		characterToDelete = id
		showDeleteModal = true
	}

	function confirmDelete() {
		// The id is read out BEFORE the modal state is cleared: the form-close
		// check below compares against the character that was deleted, and
		// `characterToDelete` is already undefined by the time it runs.
		const deletedId = characterToDelete
		if (deletedId !== undefined) {
			socket.emit("characters:delete", { id: deletedId })
		}
		showDeleteModal = false
		characterToDelete = undefined
		// The edit form is showing the row that just went away — close it.
		if (characterId === deletedId) closeCharacterForm()
	}

	function cancelDelete() {
		showDeleteModal = false
		characterToDelete = undefined
	}

	async function handleOnClose() {
		if (characterFormHasChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			return true
		}
	}

	function handleCloseModalDiscard() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}

	function handleCloseModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}

	function handleUnsavedChangesOnOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	function handleImportClick() {
		showImportModal = true
	}

	// The library is a view of its own (the Library), opened beside this one
	// as a tab at the width the sidebar is at — no navigation, so the page
	// underneath and this view's state both stay where they were. What it
	// imports shows up here, and its "Open in Characters" comes back.
	function handleBrowseClick() {
		panelsCtx.openView("library", { toggle: false })
	}

	/** Whether the toolbar's New popout is showing. */
	let newOpen = $state(false)

	/**
	 * The three ways a character gets in, as the New button's menu.
	 *
	 * Each closes the popout before it runs: every one of them either opens a
	 * modal or leaves the page, and a menu still standing over either is a
	 * menu the pointer has to dismiss a second time.
	 */
	const newMenuItems: Array<{
		key: string
		icon: typeof Icons.Plus
		title: string
		blurb: string
		run: () => void
	}> = [
		{
			// The glyph each concept is fixed to (§7): `UsersRound` is the
			// character, `UserRound` the persona. Two items, two ideas, two
			// icons — the pair is the whole reason this menu can hold both.
			key: "write",
			icon: Icons.UsersRound,
			title: "Write a character",
			blurb: "Start from a blank card.",
			run: handleCreateClick
		},
		{
			key: "persona",
			icon: Icons.UserRound,
			title: "Write a persona",
			blurb: "A character you play.",
			run: handleCreatePersonaClick
		},
		{
			key: "browse",
			icon: Icons.Library,
			title: "Browse the library",
			blurb: "Community cards you can import.",
			run: handleBrowseClick
		},
		{
			key: "import",
			icon: Icons.Upload,
			title: "Import a card",
			blurb: "PNG, APNG, JPEG, WEBP, JSON or CHARX.",
			run: handleImportClick
		},
		{
			// Last, and deliberately: the four above add a CHARACTER, this
			// adds a shelf to put them on. Same menu because both answer
			// "make something new here", and a second primary button for one
			// item would be a second call to action on the row.
			key: "folder",
			icon: Icons.FolderPlus,
			title: "New folder",
			blurb: "Group characters in the list.",
			run: openCreateFolder
		}
	]

	function runNewMenuItem(item: (typeof newMenuItems)[number]) {
		newOpen = false
		item.run()
	}

	/**
	 * Up and down walk the menu, wrapping at both ends. A `role="menu"` is
	 * one tab stop with a roving focus, so the arrows are the only way
	 * between its items; Escape and the focus return belong to the popover.
	 */
	function handleNewMenuKeydown(e: KeyboardEvent) {
		const items = [
			...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
				'[role="menuitem"]'
			)
		]
		if (!items.length) return
		const at = items.indexOf(document.activeElement as HTMLElement)
		let next: number
		if (e.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length
		else if (e.key === "ArrowUp")
			next =
				at < 0
					? items.length - 1
					: (at - 1 + items.length) % items.length
		else if (e.key === "Home") next = 0
		else if (e.key === "End") next = items.length - 1
		else return
		e.preventDefault()
		newMenuIndex = next
		items[next].focus()
	}

	/**
	 * Which item holds the menu's single tab stop. Reset on open so the
	 * popover's own initial focus lands on the first row.
	 */
	let newMenuIndex = $state(0)

	function handleNewOpenChange(open: boolean) {
		newOpen = open
		if (open) newMenuIndex = 0
	}

	async function handleFileImport(details: FileAcceptDetails) {
		if (!details.files || details.files.length === 0) return
		showImportModal = false
		// The server's own ceiling, said before a byte is uploaded.
		const upload = await cardFileForUpload(details.files[0])
		if ("refused" in upload) {
			toaster.error({ title: upload.refused })
			return
		}
		socket.emit("characters:importCard", { file: upload.base64 })
	}

	/**
	 * The list pane is itself the drop zone the footer advertises, and a card
	 * dropped on it takes the same path as one chosen in the import dialog —
	 * `handleFileImport` is the single place a card file becomes an
	 * `characters:importCard` emit, conflict handling and all.
	 */
	let isCardDragOver = $state(false)

	function handleCardDragOver(e: DragEvent) {
		// A drop only happens where the default is prevented, so this is what
		// makes the pane a target rather than a page the browser navigates.
		e.preventDefault()
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
		isCardDragOver = true
	}

	function handleCardDragLeave(e: DragEvent) {
		// `dragleave` fires on every child boundary crossed inside the pane, so
		// the highlight drops only when the pointer leaves the pane itself.
		const next = e.relatedTarget
		if (
			next instanceof Node &&
			(e.currentTarget as HTMLElement).contains(next)
		)
			return
		isCardDragOver = false
	}

	function handleCardDrop(e: DragEvent) {
		e.preventDefault()
		isCardDragOver = false
		const files = Array.from(e.dataTransfer?.files ?? [])
		if (!files.length) return
		handleFileImport({ files } as FileAcceptDetails)
	}

	function handleCharacterClick(character: any) {
		handleViewClick(character.id)
	}

	function handleSessionFromView() {
		if (!viewingId) return
		panelsCtx.digest.sessionCharacterId = viewingId
		panelsCtx.openPanel({ key: "sessions", toggle: false })
	}

	function confirmLorebookImport() {
		// The card's book is held on the server since the card import; the
		// dialog names it, and sends the name only when it was changed.
		const book = importingLorebook!
		const name = importingLorebookName.trim()
		const req: Sockets.Lorebooks.Import.Params = {
			heldImportId: book.heldImportId,
			...(name && name !== book.name ? { name } : {})
		}
		lorebookImportPending = true
		socket.emit("lorebooks:import", req)
		showLorebookImportConfirmationModal = false
		importingLorebook = null
		importingLorebookCharacter = null
	}

	function handleOverwriteLorebookImportConflict() {
		if (!lorebookImportConflict) return
		lorebookImportPending = true
		socket.emit("lorebooks:importResolve", {
			action: "overwrite",
			heldImportId: lorebookImportConflict.heldImportId,
			existingId: lorebookImportConflict.existingLorebook.id
		})
		showLorebookImportConflictModal = false
		lorebookImportConflict = undefined
	}

	function handleImportLorebookAsNewFromConflict() {
		if (!lorebookImportConflict) return
		lorebookImportPending = true
		socket.emit("lorebooks:importResolve", {
			action: "createNew",
			heldImportId: lorebookImportConflict.heldImportId,
			existingId: lorebookImportConflict.existingLorebook.id
		})
		showLorebookImportConflictModal = false
		lorebookImportConflict = undefined
	}

	function handleCancelLorebookImportConflict() {
		showLorebookImportConflictModal = false
		lorebookImportConflict = undefined
	}

	function handleOverwriteCharacterImportConflict() {
		if (!characterImportConflict) return
		socket.emit("characters:importResolve", {
			action: "overwrite",
			heldImportId: characterImportConflict.heldImportId,
			existingId: characterImportConflict.existingCharacter.id
		})
		showCharacterImportConflictModal = false
		characterImportConflict = undefined
	}

	function handleImportCharacterAsNewFromConflict() {
		if (!characterImportConflict) return
		socket.emit("characters:importResolve", {
			action: "createNew",
			heldImportId: characterImportConflict.heldImportId,
			existingId: characterImportConflict.existingCharacter.id
		})
		showCharacterImportConflictModal = false
		characterImportConflict = undefined
	}

	function handleCancelCharacterImportConflict() {
		showCharacterImportConflictModal = false
		characterImportConflict = undefined
	}

	function handleExportCharacter(character: {
		id?: number
		name?: string
		nickname?: string | null
		avatar?: string | null
	}) {
		if (!character.id || !character.name) return
		exportingCharacter = {
			id: character.id,
			name: character.name,
			nickname: character.nickname,
			avatar: avatarSrc(character)
		}
		showExportModal = true
	}

	function handleConfirmCharacterExport(options: {
		format: "json" | "png" | "charx"
		lorebookId: number | null
	}) {
		if (!exportingCharacter?.id) return
		socket.emit("characters:exportCard", {
			id: exportingCharacter.id,
			format: options.format,
			lorebookId: options.lorebookId
		})
		showExportModal = false
		exportingCharacter = null
	}

	function handleCancelCharacterExport() {
		showExportModal = false
		exportingCharacter = null
	}

	function cancelLorebookImport() {
		showLorebookImportConfirmationModal = false
		importingLorebook = null
		importingLorebookCharacter = null
	}

	// Declared on the interest registry below, which owns the one listener per
	// event and releases this sidebar's subscribers when it is destroyed.
	function handleCharactersList(
		msg: SocketEventMap["characters:list"]["response"]
	) {
		characterList = msg.characterList
		isLoading = false
	}

	// The generic **:error listener in Layout.svelte already toasts this —
	// this just stops the spinner from spinning forever if the initial
	// fetch fails, so it settles into the (accurate enough) empty state.
	function handleCharactersListError() {
		isLoading = false
	}

	function handleCharacterFoldersList(
		msg: Sockets.CharacterFolders.List.Response
	) {
		folders = msg.folders
	}

	// A create or a rename that landed is the dialog's answer: close it. The
	// refreshed `characterFolders:list` cascade has already been applied above,
	// so the new name is on screen behind it.
	function handleCharacterFoldersWritten() {
		closeFolderDialog()
	}

	// The refusal the dialog shows under its own field — a duplicate name is a
	// correction to make in the box, not a toast that leaves the box looking
	// accepted. Layout's catch-all skips both of these (HANDLED_ERROR_EVENTS).
	function handleCharacterFoldersWriteError(msg: Sockets.ErrorResponse) {
		folderDialogBusy = false
		folderDialogError = msg.error || "Failed to save the folder."
	}

	function handleCharactersImportCard(
		msg: Sockets.Characters.ImportCard.Response
	) {
		if (msg.status === "conflict" && msg.conflict) {
			characterImportConflict = msg.conflict
			showCharacterImportConflictModal = true
			return
		}
		// The toast is the characters-import context's, once for every view.
		if (msg.status === "unchanged") return
		importingLorebook = msg.book || null
		importingLorebookName = msg.book?.name ?? ""
		if (!!importingLorebook) {
			importingLorebookCharacter = msg.character || null
			showLorebookImportConfirmationModal = true
		}
	}

	function handleCharactersImportResolve(
		msg: Sockets.Characters.ImportResolve.Response
	) {
		// The toast is the characters-import context's, once for every view.
		importingLorebook = msg.book || null
		importingLorebookName = msg.book?.name ?? ""
		if (!!importingLorebook) {
			importingLorebookCharacter = msg.character || null
			showLorebookImportConfirmationModal = true
		}
	}

	function handleCharactersExportCard(
		msg: SocketEventMap["characters:exportCard"]["response"]
	) {
		downloadBlob(msg)
		toaster.success({
			title: "Character exported",
			description: `Character card exported as ${msg.filename}`
		})
	}

	function handleCharactersExportCardError(msg: Sockets.ErrorResponse) {
		toaster.error({
			title: msg.error || "Failed to export character"
		})
	}

	function handleLorebooksImport(msg: Sockets.Lorebooks.Import.Response) {
		if (!lorebookImportPending) return
		lorebookImportPending = false
		if (msg.status === "conflict" && msg.conflict) {
			lorebookImportConflict = msg.conflict
			showLorebookImportConflictModal = true
			return
		}
		if (msg.status === "unchanged") {
			toaster.success({
				title: "Lorebook already imported",
				description: `"${msg.lorebook?.name}" is unchanged — using the existing lorebook.`
			})
			return
		}
		const toast = lorebookImportedToast(msg.warnings)
		toaster[toast.kind]({ title: toast.title, description: toast.description })
	}

	function handleLorebooksImportError(msg: Sockets.ErrorResponse) {
		if (!lorebookImportPending) return
		lorebookImportPending = false
		toaster.error({ title: msg.error || "Failed to import lorebook" })
	}

	function handleLorebooksImportResolve(
		msg: Sockets.Lorebooks.ImportResolve.Response
	) {
		if (!lorebookImportPending) return
		lorebookImportPending = false
		const toast = lorebookImportedToast(msg.warnings)
		toaster[toast.kind]({ title: toast.title, description: toast.description })
	}

	function handleLorebooksImportResolveError(msg: Sockets.ErrorResponse) {
		if (!lorebookImportPending) return
		lorebookImportPending = false
		toaster.error({
			title: msg.error || "Failed to resolve lorebook import"
		})
	}

	// The background vectorization queue updates a row's embeddingModel
	// directly in the DB — without this, the list here only ever refreshes
	// on the next explicit characters:list, leaving the embedding-status
	// badge showing stale info until a manual refresh.
	function handleVectorizationItemUpdated(
		msg: Sockets.Vectorization.ItemUpdated.Response
	) {
		if (msg.type !== "character") return
		const target = characterList.find((c: any) => c.id === msg.id)
		if (target) (target as any).embeddingModel = msg.embeddingModel
	}

	/**
	 * This sidebar's `characters:*` replies, on the interest registry. All
	 * BARE — the list is the whole of this user's characters and an import or
	 * an export is about a card, not a row this view already knows the id of,
	 * so none of them has an interest scope to narrow to.
	 *
	 * `characters:list` is STANDING rather than a one-shot: it is a cascade
	 * target, re-sent after every create, update, delete and import, and this
	 * sidebar is what renders it. The request that fills it first is in
	 * `onMount` below; the typed `emit` puts the sync packet naming these keys
	 * ahead of it on the same socket.
	 */
	useInterest<"characters:list">("characters:list", handleCharactersList)
	// The server has no `characters:list:error` emit today — the key is
	// declared anyway, because the registry is the only listener path and a
	// key nobody sends costs one string in a sync packet.
	useInterest<"characters:list:error">(
		"characters:list:error",
		handleCharactersListError
	)
	/**
	 * The folders this list groups by, and the two writes whose reply the name
	 * dialog is waiting on. All BARE — a folder list is this user's whole set,
	 * with nothing to scope it to — and `characterFolders:list` is STANDING for
	 * the same reason `characters:list` is: every folder write, and a folder
	 * DELETE, cascades a fresh one.
	 */
	useInterest<"characterFolders:list">(
		"characterFolders:list",
		handleCharacterFoldersList
	)
	useInterest<"characterFolders:create">(
		"characterFolders:create",
		handleCharacterFoldersWritten
	)
	useInterest<"characterFolders:create:error">(
		"characterFolders:create:error",
		handleCharacterFoldersWriteError
	)
	useInterest<"characterFolders:update">(
		"characterFolders:update",
		handleCharacterFoldersWritten
	)
	useInterest<"characterFolders:update:error">(
		"characterFolders:update:error",
		handleCharacterFoldersWriteError
	)
	// The import events are the characters-import context's; this view takes
	// the outcome for its conflict and lorebook dialogs.
	onCardImported(handleCharactersImportCard)
	onImportResolved(handleCharactersImportResolve)
	useInterest<"characters:exportCard">(
		"characters:exportCard",
		handleCharactersExportCard
	)
	useInterest<"characters:exportCard:error">(
		"characters:exportCard:error",
		handleCharactersExportCardError
	)

	/**
	 * The lorebook half of the card import, on the same terms: a card that
	 * carries a book lands here as `lorebooks:import`, and a name clash comes
	 * back as `lorebooks:importResolve`. All BARE — an import is about a file,
	 * not a book this view already knows the id of, so none of them is in
	 * `SCOPED_EVENTS` and a `#<id>` key would match no payload at all.
	 */
	useInterest<"lorebooks:import">("lorebooks:import", handleLorebooksImport)
	useInterest<"lorebooks:import:error">(
		"lorebooks:import:error",
		handleLorebooksImportError
	)
	useInterest<"lorebooks:importResolve">(
		"lorebooks:importResolve",
		handleLorebooksImportResolve
	)
	useInterest<"lorebooks:importResolve:error">(
		"lorebooks:importResolve:error",
		handleLorebooksImportResolveError
	)

	/**
	 * The per-item vectorization badge, BARE. `vectorization:itemUpdated` has a
	 * scope — the lorebook the item belongs to — but this sidebar does not know
	 * one: it lists every character the user has, across every book, so it
	 * wants every scope. A `#<id>` key here would have no id to put in it.
	 */
	useInterest<"vectorization:itemUpdated">(
		"vectorization:itemUpdated",
		handleVectorizationItemUpdated
	)

	onMount(() => {
		socket.emit("characters:list", {})
		socket.emit("characterFolders:list", {})
		onclose = handleOnClose
	})

	onDestroy(() => {
		// The `characters:*`, `lorebooks:import*` and `vectorization:*`
		// listeners are not here: the interest registry releases this
		// sidebar's subscribers as its effects are destroyed.
		onclose = undefined
	})
</script>

<!-- One group's rows, in whichever view mode is on. A snippet and not a
     repeated block: the ungrouped rows and every folder's rows are the same
     list, and four copies of it is four places for a row's props to drift.
     `label` names the group for a screen reader, so several lists on one pane
     are several NAMED lists rather than several called "Characters list". -->
{#snippet characterRows(items: any[], label: string)}
	{#if viewMode.value === "list"}
		<div class="flex flex-col gap-2" role="list" aria-label={label}>
			{#each items as c (c.id)}
				<div
					animate:flip={{ duration: motionDuration(MOTION.base) }}
					out:fade={{ duration: motionDuration(MOTION.fast) }}
					class="rounded-lg"
				>
					<CharacterListItem
						character={c}
						onclick={handleCharacterClick}
						onEdit={handleEditClick}
						onDelete={handleDeleteClick}
						onExport={handleExportCharacter}
						onTogglePersona={handleTogglePersona}
						onSetDefaultPersona={handleSetDefaultPersona}
						onMoveToFolder={openMoveToFolder}
						contentTitle="Go to character sessions"
						active={vm.mode === "desk" &&
							selectedCharacterId === c.id}
					/>
				</div>
			{/each}
		</div>
	{:else}
		<!--
		The sidebar's grid needs to respond to ITS OWN width (a fixed 25% of
		viewport), not the viewport's width — a viewport-based breakpoint
		(sm/md/lg) gives the same column count whether this sidebar is 300px
		wide (a 1440px window) or 950px wide (a 4K window). A fixed set of named
		breakpoints has the same problem at the other end: capping at
		grid-cols-5 forever means a 4K fullscreen panel (3800px+ wide) renders 5
		columns of ~750px cards instead of more, smaller ones. auto-fill/minmax
		scales column count continuously off the grid's own width with no named
		breakpoints (and no ceiling) at all. 160px is the floor that fits two
		tiles across the desk list pane.
	-->
		<div
			class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3"
			role="list"
			aria-label={label}
		>
			{#each items as c (c.id)}
				<div
					animate:flip={{ duration: motionDuration(MOTION.base) }}
					out:fade={{ duration: motionDuration(MOTION.fast) }}
					class="rounded-lg"
				>
					<CharacterCardItem
						character={c}
						onclick={handleCharacterClick}
						onEdit={handleEditClick}
						onDelete={handleDeleteClick}
						onExport={handleExportCharacter}
						onTogglePersona={handleTogglePersona}
						onSetDefaultPersona={handleSetDefaultPersona}
						onMoveToFolder={openMoveToFolder}
						contentTitle="Go to character sessions"
						active={vm.mode === "desk" &&
							selectedCharacterId === c.id}
					/>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

<div
	use:vm.observe
	class="text-foreground flex h-full min-h-0 flex-col"
	role="region"
	aria-label="Characters management"
>
	<PanelSplit
		mode={vm.mode}
		hasDetail={isCreating || characterId != null || viewingId != null}
		emptyMessage="Pick a character, or create one."
		listWidth="380px"
	>
		{#snippet detail()}
			{#if isCreating}
				<section
					aria-label={createPreset?.isPersona
						? "Create new persona"
						: "Create new character"}
				>
					<CharacterForm
						bind:isSafeToClose={characterFormHasChanges}
						closeForm={closeCharacterForm}
						bind:onCancel={onEditFormCancel}
						initialData={createPreset}
						customTitle={createPreset?.isPersona
							? "New persona"
							: undefined}
						showBack={vm.mode !== "desk"}
					/>
				</section>
			{:else if characterId}
				{#key characterId}
					<section aria-label="Edit character">
						<CharacterForm
							bind:isSafeToClose={characterFormHasChanges}
							{characterId}
							closeForm={closeCharacterForm}
							bind:onCancel={onEditFormCancel}
							showBack={vm.mode !== "desk"}
						/>
					</section>
				{/key}
			{:else if viewingId}
				{#key viewingId}
					<section aria-label="View character" class="h-full">
						<CharacterViewPanel
							characterId={viewingId}
							onBack={vm.mode === "desk"
								? undefined
								: () => (viewingId = undefined)}
							onEdit={handleEditFromView}
							onSession={handleSessionFromView}
							onExport={handleExportCharacter}
						/>
					</section>
				{/key}
			{/if}
		{/snippet}

		{#snippet list()}
			<!-- The whole pane is the drop target: a card is dropped at the
			     list, not at a strip of it, and a zone only a footer accepted
			     would miss every drop aimed at the rows. `relative` is what
			     the dragging overlay at the end of this pane hangs on. -->
			<div
				class="relative flex min-h-0 min-w-0 flex-1 flex-col rounded-lg"
				ondragover={handleCardDragOver}
				ondragleave={handleCardDragLeave}
				ondrop={handleCardDrop}
				role="region"
				aria-label="Characters list and card drop zone"
			>
				<!-- The view toolbar (STYLE-GUIDE §6.3). The three ways a
				     character gets in are behind New — write one, browse the
				     library, or hand over a file; the pane is a drop target as
				     well, which is a fourth way and not a menu item. -->
				<ViewToolbar label="Characters" class="mb-2">
					{#snippet primary()}
						<Popover
							open={newOpen}
							onOpenChange={(e) => handleNewOpenChange(e.open)}
							positioning={{ placement: "bottom-end" }}
						>
							<Popover.Trigger
								class="btn btn-sm preset-filled-primary-500 shrink-0 {panelsCtx
									.digest.tutorial
									? 'ring-primary-500/50 animate-pulse ring-4'
									: ''}"
								title="New character"
								aria-label="New character"
								aria-haspopup="menu"
								aria-expanded={newOpen}
							>
								<Icons.Plus size={16} aria-hidden="true" />
								New
							</Popover.Trigger>
							<Portal>
								<Popover.Positioner class="z-[1000]!">
									<Popover.Content
										class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,280px)] border p-1 shadow-xl"
									>
										<!-- `tabindex={-1}` and not 0: the menu is one tab
										     stop, and the stop is whichever ITEM holds the
										     roving focus. The container takes focus only
										     programmatically. -->
										<div
											role="menu"
											aria-label="New character"
											tabindex={-1}
											class="flex flex-col"
											onkeydown={handleNewMenuKeydown}
										>
											{#each newMenuItems as item, i (item.key)}
												<button
													type="button"
													role="menuitem"
													tabindex={i === newMenuIndex
														? 0
														: -1}
													class="hover:bg-surface-200-800 flex items-start gap-3 rounded-lg px-2.5 py-2 text-left"
													onclick={() =>
														runNewMenuItem(item)}
												>
													<item.icon
														size={18}
														class="text-surface-600-400 mt-0.5 shrink-0"
														aria-hidden="true"
													/>
													<span class="min-w-0">
														<span
															class="block text-sm font-medium"
														>
															{item.title}
														</span>
														<span
															class="text-surface-600-400 block text-xs"
														>
															{item.blurb}
														</span>
													</span>
												</button>
											{/each}
										</div>
									</Popover.Content>
								</Popover.Positioner>
							</Portal>
						</Popover>
					{/snippet}
					{#snippet filter()}
						<PanelFilterInput
							id="character-search"
							bind:value={search}
							placeholder="characters"
							singular="character"
							count={characterList.length}
							aria-label="Filter characters by name, description, or tags"
						/>
					{/snippet}
					{#snippet filterActions()}
						<!-- The tag and favourite picks live in a popout rather
						     than a row of chips: the row grows with the tag
						     list, and the list pane has no sideways room. -->
						<Popover
							open={filterOpen}
							onOpenChange={(e) => (filterOpen = e.open)}
							positioning={{ placement: "bottom-end" }}
						>
							<Popover.Trigger
								class={toolbarButtonClass(activeChip !== "all")}
								title="Filter characters"
								aria-label="Filter characters"
								aria-expanded={filterOpen}
							>
								<Icons.SlidersHorizontal
									size={16}
									aria-hidden="true"
								/>
							</Popover.Trigger>
							<Portal>
								<Popover.Positioner class="z-[1000]!">
									<Popover.Content
										class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,260px)] border p-2 shadow-xl"
									>
										<div
											class="flex max-h-[min(60vh,320px)] flex-col gap-0.5 overflow-y-auto"
											role="radiogroup"
											aria-label="Filter characters"
										>
											{#each filterOptions as option (option.value)}
												{@const checked =
													activeChip === option.value}
												<button
													type="button"
													role="radio"
													aria-checked={checked}
													class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm {checked
														? 'sidebar-row-active'
														: 'hover:bg-surface-200-800'}"
													onclick={() =>
														pickFilter(option.value)}
												>
													{#if option.value.startsWith("tag:")}
														<span
															class="size-2 shrink-0 rounded-full {tagDotPreset(
																option.colorPreset
															)}"
															aria-hidden="true"
														></span>
													{/if}
													<span class="min-w-0 truncate">
														{option.label}
													</span>
												</button>
											{/each}
										</div>
									</Popover.Content>
								</Popover.Positioner>
							</Portal>
						</Popover>
						<ListCardToggle mode={viewMode} label="Characters" />
					{/snippet}
					{#snippet chips()}
						<!-- The one narrowing in force, said once. -->
						{#if activeFilterLabel}
							<span
								class="bg-surface-200-800 text-surface-800-200 flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs"
							>
								<span class="min-w-0 truncate">
									{activeFilterLabel}
								</span>
								<button
									type="button"
									class="hover:text-foreground shrink-0"
									onclick={() => pickFilter("all")}
									title="Clear filter"
									aria-label="Clear filter: {activeFilterLabel}"
								>
									<Icons.X size={12} aria-hidden="true" />
								</button>
							</span>
						{/if}
					{/snippet}
				</ViewToolbar>
				<div class="min-h-0 flex-1 overflow-y-auto">
					{#if isLoading}
						<div class="flex items-center justify-center py-8">
							<Icons.Loader2
								size={20}
								class="text-surface-600-400 animate-spin"
							/>
						</div>
					{:else if filteredCharacters.length === 0}
						<EmptyState
							icon={Icons.Users}
							message={search
								? `No characters found matching "${search}".`
								: activeChip === "favorite"
									? "No favourite characters yet."
									: activeChip === "persona"
										? "No personas yet — mark a character as one from its ⋯ menu."
										: activeChip !== "all"
											? "No characters carry this tag."
											: "No characters yet — create one, or browse ready-made ones from the community."}
							ctaLabel={listIsNarrowed
								? undefined
								: "New character"}
							onCta={listIsNarrowed
								? undefined
								: handleCreateClick}
							secondaryLabel={listIsNarrowed
								? undefined
								: "Browse Characters"}
							onSecondary={listIsNarrowed
								? undefined
								: handleBrowseClick}
						/>
					{:else}
						<!-- Top level first, under no header: the folders are
						     an optional shelf, not a filing system a character
						     has to be inside to be listed. -->
						<div class="flex flex-col gap-2">
							{#if folderGroups.ungrouped.length > 0}
								{@render characterRows(
									folderGroups.ungrouped,
									"Characters"
								)}
							{/if}
							{#each folderGroups.groups as group (group.folder.id)}
								{@const expanded = !collapsedFolderIds.has(
									group.folder.id
								)}
								<div class="flex min-w-0 flex-col">
									<CharacterFolderHeader
										name={group.folder.name}
										count={group.characters.length}
										{expanded}
										onToggle={() =>
											toggleFolder(group.folder.id)}
										onRename={() =>
											openRenameFolder(group.folder)}
										onDelete={() =>
											(folderToDelete = group.folder)}
									/>
									{#if expanded}
										<!-- Indented by the header glyph's
										     width and nothing else (§6.4) —
										     the indent is what says these rows
										     belong to the folder above. -->
										<div class="min-w-0 pl-4">
											{@render characterRows(
												group.characters,
												group.folder.name
											)}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
				<!-- The pane says it is a drop target only while a card is
				     over it. It is always one, and a standing strip saying so
				     costs a line of the list to repeat it at every moment the
				     answer is not needed. `pointer-events-none` keeps the
				     overlay out of the drag the pane is tracking. -->
				{#if isCardDragOver}
					<div
						class="border-primary-500/70 bg-surface-50-950/80 text-surface-800-200 pointer-events-none absolute inset-2 flex items-center justify-center rounded-[12px] border-2 border-dashed text-sm"
					>
						Drop to import this card
					</div>
				{/if}
			</div>
		{/snippet}
	</PanelSplit>
</div>

{#if showDeleteModal}
	<Dialog
		open={showDeleteModal}
		onOpenChange={(e) => (showDeleteModal = e.open)}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
					role="alertdialog"
					aria-labelledby="delete-modal-title"
					aria-describedby="delete-modal-description"
				>
					<div class="p-6">
						<h2
							id="delete-modal-title"
							class="mb-2 text-lg font-bold"
						>
							Delete character?
						</h2>
						<p id="delete-modal-description" class="mb-4">
							Are you sure you want to delete this character? This
							action cannot be undone.
						</p>
						<div
							class="flex justify-end gap-2"
							role="group"
							aria-label="Delete confirmation actions"
						>
							<button
								class="btn preset-filled-surface-500"
								onclick={cancelDelete}
								type="button"
								aria-label="Cancel deletion"
							>
								Cancel
							</button>
							<button
								class="btn preset-filled-error-500"
								onclick={confirmDelete}
								type="button"
								aria-label="Confirm deletion"
							>
								Delete
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if showImportModal}
	<Dialog
		open={showImportModal}
		onOpenChange={(e) => (showImportModal = e.open)}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 w-[min(95vw,560px)] space-y-4 p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">Import a character</h2>
						<div class="space-y-2">
							<div>
								<p
									class="text-surface-600 dark:text-surface-400 mb-2 text-sm"
								>
									Upload a file (PNG, APNG, JPEG, JPG, WEBP,
									JSON, CHARX):
								</p>
								<FileDropzone
									name="character-card"
									accept=".png,.apng,.jpeg,.jpg,.webp,.json,.charx"
									onFileAccept={handleFileImport}
								/>
							</div>
						</div>
						<div class="mt-4 flex gap-2">
							<button
								class="btn preset-filled-surface-500"
								onclick={() => (showImportModal = false)}
							>
								Cancel
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if showLorebookImportConfirmationModal}
	<Dialog
		open={showLorebookImportConfirmationModal}
		onOpenChange={(e) => {
			showLorebookImportConfirmationModal = e.open
			importingLorebook = null
			importingLorebookCharacter = null
		}}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">Import the lorebook?</h2>
						<p class="mb-4">
							A lorebook is associated with this character card.
							Would you like to import it?
						</p>
						<label
							class="mb-2 block font-semibold"
							for="lorebookName"
						>
							Lorebook name
						</label>
						<input
							id="lorebookName"
							name="lorebookName"
							type="text"
							class="input mb-4 w-full"
							bind:value={importingLorebookName}
						/>
						<div class="flex justify-end gap-2">
							<button
								class="btn preset-filled-surface-500"
								onclick={cancelLorebookImport}
							>
								Cancel
							</button>
							<button
								class="btn preset-filled-primary-500"
								onclick={confirmLorebookImport}
							>
								Import lorebook
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if lorebookImportConflict}
	<ImportConflictModal
		open={showLorebookImportConflictModal}
		onOpenChange={(e) => {
			showLorebookImportConflictModal = e.open
			if (!e.open) lorebookImportConflict = undefined
		}}
		entityLabel="Lorebook"
		existingName={lorebookImportConflict.existingLorebook.name}
		losses={describeOverwriteLosses(lorebookImportConflict.losses)}
		onOverwrite={handleOverwriteLorebookImportConflict}
		onImportAsNew={handleImportLorebookAsNewFromConflict}
		onCancel={handleCancelLorebookImportConflict}
	/>
{/if}

{#if characterImportConflict}
	<ImportConflictModal
		open={showCharacterImportConflictModal}
		onOpenChange={(e) => {
			showCharacterImportConflictModal = e.open
			if (!e.open) characterImportConflict = undefined
		}}
		entityLabel="Character"
		existingName={characterImportConflict.existingCharacter.nickname ||
			characterImportConflict.existingCharacter.name}
		onOverwrite={handleOverwriteCharacterImportConflict}
		onImportAsNew={handleImportCharacterAsNewFromConflict}
		onCancel={handleCancelCharacterImportConflict}
	/>
{/if}

<CharacterExportModal
	open={showExportModal}
	onOpenChange={(e) => {
		showExportModal = e.open
		if (!e.open) exportingCharacter = null
	}}
	character={exportingCharacter}
	onConfirm={handleConfirmCharacterExport}
	onCancel={handleCancelCharacterExport}
/>

{#if showUnsavedChangesModal}
	<CharacterUnsavedChangesModal
		open={showUnsavedChangesModal}
		onOpenChange={handleUnsavedChangesOnOpenChange}
		onConfirm={handleCloseModalDiscard}
		onCancel={handleCloseModalCancel}
	/>
{/if}

<!-- Character Creator Modal — the same one for a persona, with the flag
     already set on the draft. -->
<CharacterCreator
	bind:open={showCharacterCreator}
	onOpenChange={(e) => (showCharacterCreator = e.open)}
	initial={createPreset}
/>

<!-- New folder / Rename folder: one dialog, because they ask the same
     question and fail the same way. -->
{#if folderDialog}
	<CharacterFolderNameModal
		open={!!folderDialog}
		onOpenChange={(e) => {
			if (!e.open) closeFolderDialog()
		}}
		mode={folderDialog.mode}
		initialName={folderDialog.mode === "rename" ? folderDialog.name : ""}
		error={folderDialogError}
		busy={folderDialogBusy}
		onSubmit={submitFolderDialog}
		onCancel={closeFolderDialog}
	/>
{/if}

{#if characterToMove}
	<CharacterMoveToFolderModal
		open={!!characterToMove}
		onOpenChange={(e) => {
			if (!e.open) characterToMove = null
		}}
		characterName={characterToMove.nickname || characterToMove.name}
		currentFolderId={characterToMove.folderId ?? null}
		{folders}
		onPick={pickFolderForCharacter}
		onCancel={() => (characterToMove = null)}
	/>
{/if}

<!-- Deleting a folder keeps its characters — `characters.folder_id` is
     ON DELETE SET NULL — so the confirm says so rather than asking the user to
     assume it. -->
{#if folderToDelete}
	<Dialog
		open={!!folderToDelete}
		onOpenChange={(e) => {
			if (!e.open) folderToDelete = null
		}}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 w-[min(95vw,420px)] border p-6 shadow-xl"
					role="alertdialog"
					aria-labelledby="delete-folder-title"
					aria-describedby="delete-folder-description"
				>
					<h2 id="delete-folder-title" class="mb-2 text-lg font-bold">
						Delete “{folderToDelete.name}”?
					</h2>
					<p id="delete-folder-description" class="mb-4 text-sm">
						The folder goes; the characters in it stay. They return
						to the top level of your library.
					</p>
					<div class="flex justify-end gap-2">
						<button
							class="btn preset-filled-surface-500"
							type="button"
							onclick={() => (folderToDelete = null)}
						>
							Cancel
						</button>
						<button
							class="btn preset-filled-error-500"
							type="button"
							onclick={confirmDeleteFolder}
						>
							Delete folder
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}
