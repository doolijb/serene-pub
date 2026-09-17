<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onDestroy, onMount } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import CharacterSelectModal from "$lib/client/components/modals/CharacterSelectModal.svelte"
	import DeleteLorebookEntryConfirmModal from "$lib/client/components/modals/DeleteLorebookEntryConfirmModal.svelte"
	import BindingSuggestionsPanel from "$lib/client/components/lorebookForms/BindingSuggestionsPanel.svelte"
	import {
		entryChannel,
		type BindingWithRelations
	} from "$lib/client/components/lorebookForms/entryManager"
	import {
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID
	} from "$lib/shared/entries/types"
	import { castPool, type CastMember, type CastRow } from "./castPool"
	import CastDuplicatesPanel from "./cast/CastDuplicatesPanel.svelte"
	import CastMemberForm from "./cast/CastMemberForm.svelte"
	import CastRelationships from "./cast/CastRelationships.svelte"
	import {
		castHeaderLine,
		castReadInLine,
		castRowSentence,
		reviewLine
	} from "./cast/castRelationships"
	import { stateBadge, visibilityBadge } from "./cast/castVocabulary"
	import {
		laterLabel as laterLabelOf,
		splitByMoment,
		type DatedEntryLike
	} from "./graphs/asOf"
	import {
		castKey,
		graphEdges,
		graphNodes,
		nodeNames,
		panelEdges,
		type GraphEdge
	} from "./graphs/graphModel"
	import { loreRoute } from "./loreRoute.svelte"
	import type { EntryDecisions } from "./markers"
	import { CHARACTER_LORE_DOOR } from "./sections"
	import type { PoolSource } from "./sections/types"

	/**
	 * Cast: everyone the book's world holds, and the lore private to each.
	 *
	 * The list column is the cast; the editor column is one member's page —
	 * their identity and standing, then the lore anchored to them, with the
	 * Character Lore editor opening in place when one is picked. The inspector
	 * carries the two review surfaces that act on the cast as a whole:
	 * suggestions the story has earned, and pairs that may be one person.
	 */
	interface Props {
		lorebookId: number
		mode: "desk" | "compact"
		hasUnsavedChanges: boolean
		/** What the newest run of the attached session read in, by entry id. */
		decisions?: EntryDecisions | null
		/** Opens the graph lens on a member. Absent when graphs are off. */
		onViewRelationships?: (castId: number) => void
	}

	let {
		lorebookId,
		mode,
		hasUnsavedChanges = $bindable(false),
		decisions = null,
		onViewRelationships
	}: Props = $props()

	const socket = useTypedSocket()

	/** A character lore row as the wire sends it, which always has an id. */
	type LoreRow = PoolSource & { id: number }

	let castRows = $state<CastRow[]>([])
	let relationships = $state<Sockets.NarrativeGraph.NarrativeRelationship[]>(
		[]
	)
	let graphRows = $state<Sockets.NarrativeGraph.NarrativeNode[]>([])
	let historyEntries = $state<DatedEntryLike[]>([])
	let suggestions = $state<Sockets.BindingSuggestions.Suggestion[]>([])
	let duplicates = $state<
		Sockets.NarrativeGraph.DuplicateCandidates.Candidate[]
	>([])
	/**
	 * Edges this session made, by id.
	 *
	 * ⚠ `SvelteSet`, not `$state(new Set())` — a plain Set in `$state` does not
	 * make `.add()`/`.delete()` reactive, so a Keep would never clear the mark.
	 */
	const newEdgeIds = new SvelteSet<number>()
	let characterList: Sockets.Characters.List.Response["characterList"] =
		$state([])
	let loreEntries = $state<LoreRow[]>([])
	let loading = $state(true)

	let search = $state("")
	let newMenuOpen = $state(false)
	let addingBackground = $state(false)
	let backgroundName = $state("")

	/** Which member a picker is about to write to; null means it creates one. */
	let linkTargetId = $state<number | null>(null)
	let characterPickerOpen = $state(false)

	let deleteTarget = $state<CastMember | null>(null)

	let memberDirty = $state(false)
	let loreDraft = $state<Record<string, any> | null>(null)
	let loreDraftKey = $state<string | null>(null)
	let creatingLore = $state(false)
	let awaitingSave = $state<string | null>(null)

	let inspectorTab = $state<"suggestions" | "duplicates">("suggestions")

	let route = $derived(loreRoute.route)
	let pool = $derived(castPool(castRows, loreEntries, search))
	let allMembers = $derived(castPool(castRows, loreEntries).members)
	let selectedMember = $derived(
		route.castId != null
			? (allMembers.find((m) => m.id === route.castId) ?? null)
			: null
	)
	let selectedRow = $derived(
		selectedMember
			? (castRows.find((r) => r.id === selectedMember.id) ?? null)
			: null
	)
	let anchoredLore = $derived(
		selectedMember ? (pool.lore.get(selectedMember.id) ?? []) : []
	)
	let selectedLore = $derived(
		route.entryId != null
			? (loreEntries.find((e) => e.id === route.entryId) ?? null)
			: null
	)
	let editorOpen = $derived(!!selectedMember || creatingLore)

	let bindingsForEditor = $derived(castRows as BindingWithRelations[])

	/** Alias rows fold into the parent they were absorbed into. */
	let parentNodes = $derived(graphRows.filter((n) => !n.parentNodeId))
	/** Every edge, split into what has happened by the moment and what has not. */
	let momentSplit = $derived(
		splitByMoment(relationships, route.moment, historyEntries)
	)
	let graph = $derived(
		graphNodes({
			cast: parentNodes,
			relationships,
			scopeEntries: []
		})
	)
	let nodeKeys = $derived(new Set(graph.map((n) => n.key)))
	let allEdges = $derived(graphEdges(relationships, nodeKeys, newEdgeIds))
	let names = $derived(nodeNames(graph))
	let inStoryIds = $derived(new Set(momentSplit.inStory.map((r) => r.id)))

	/** How many edges each member is an end of, for their row. */
	let edgeCounts = $derived.by(() => {
		const counts = new Map<number, number>()
		for (const rel of relationships) {
			// An edge from someone to themselves is one relationship, not two.
			const ends = new Set<number>()
			if (rel.from.kind === "cast") ends.add(rel.from.bindingId)
			if (rel.to.kind === "cast") ends.add(rel.to.bindingId)
			for (const id of ends) counts.set(id, (counts.get(id) ?? 0) + 1)
		}
		return counts
	})

	let selectedEdges = $derived(
		selectedMember
			? panelEdges(castKey(selectedMember.id), allEdges, names)
			: []
	)
	let selectedInStory = $derived(
		selectedEdges.filter((row) => inStoryIds.has(row.edge.id)).length
	)

	/** An edge the moment has not reached, or null once it has. */
	function laterFor(edge: GraphEdge): string | null {
		if (!route.moment) return null
		return inStoryIds.has(edge.id)
			? null
			: laterLabelOf(edge, historyEntries)
	}

	/** Whether the newest run read any of a member's lore into the prompt. */
	function readInFor(memberId: number): boolean {
		if (!decisions) return false
		return (pool.lore.get(memberId) ?? []).some(
			(entry) => decisions![entry.id] === "fired"
		)
	}

	let pendingSuggestions = $derived(
		suggestions.filter((s) => s.status === "pending")
	)

	let headerLine = $derived(
		castHeaderLine({
			members: allMembers.length,
			suggested: pendingSuggestions.length,
			duplicates: duplicates.length
		})
	)

	let outstanding = $derived(
		reviewLine({
			suggestions: pendingSuggestions.map((s) => s.surface || s.name),
			duplicates: duplicates.map(
				(c) => [c.nameA, c.nameB] as [string, string]
			)
		})
	)

	let loreDirty = $derived.by(() => {
		if (!loreDraft) return false
		if (creatingLore)
			return !!loreDraft.name?.trim() || !!loreDraft.content?.trim()
		if (!selectedLore) return false
		return (
			JSON.stringify(CHARACTER_LORE_DOOR.toDraft(selectedLore)) !==
			JSON.stringify($state.snapshot(loreDraft))
		)
	})

	$effect(() => {
		hasUnsavedChanges = memberDirty || loreDirty
	})

	// The draft follows the selection and only the selection: re-deriving it on
	// every list arrival would discard what is being typed.
	$effect(() => {
		const key = creatingLore
			? "new"
			: selectedLore
				? `entry#${selectedLore.id}`
				: null
		if (key === loreDraftKey) return
		loreDraftKey = key
		if (creatingLore) return
		loreDraft = selectedLore
			? CHARACTER_LORE_DOOR.toDraft(selectedLore)
			: null
	})

	// A member the book does not hold is not a page to be on.
	$effect(() => {
		if (loading || route.castId == null) return
		if (!castRows.some((r) => r.id === route.castId))
			void loreRoute.navigate({ type: "openCastMember", castId: null })
	})

	function discardLoreDraft() {
		creatingLore = false
		loreDraft = null
		loreDraftKey = null
	}

	async function selectMember(id: number) {
		if (!(await loreRoute.confirmLeave())) return
		discardLoreDraft()
		void loreRoute.navigate({ type: "openCastMember", castId: id })
	}

	async function selectLore(entry: LoreRow) {
		if (!(await loreRoute.confirmLeave())) return
		discardLoreDraft()
		void loreRoute.navigate({ type: "openEntry", entryId: entry.id })
	}

	async function closeLore() {
		if (!(await loreRoute.confirmLeave())) return
		const wasCreating = creatingLore
		discardLoreDraft()
		if (!wasCreating) void loreRoute.navigate({ type: "back" })
	}

	async function closeMember() {
		if (!(await loreRoute.confirmLeave())) return
		discardLoreDraft()
		void loreRoute.navigate({ type: "openCastMember", castId: null })
	}

	async function startLore() {
		if (!selectedMember) return
		if (!(await loreRoute.confirmLeave())) return
		discardLoreDraft()
		creatingLore = true
		loreDraftKey = "new"
		loreDraft = {
			...CHARACTER_LORE_DOOR.newDraft(lorebookId),
			lorebookBindingId: selectedMember.id
		}
	}

	function saveLore() {
		if (!loreDraft) return
		if (!CHARACTER_LORE_DOOR.validate(loreDraft, loreEntries, true)) return
		const payload = $state.snapshot(loreDraft) as Record<string, any>
		if (creatingLore) {
			awaitingSave = "new"
			channel?.create(payload)
			discardLoreDraft()
		} else {
			awaitingSave = `entry#${payload.id}`
			channel?.update(payload as Record<string, any> & { id: number })
		}
	}

	function saveMember(patch: Record<string, unknown>) {
		if (!selectedMember) return
		socket.emit("lorebooks:updateBinding", {
			lorebookBinding: { id: selectedMember.id, ...patch }
		} as Sockets.Lorebooks.UpdateBinding.Params)
	}

	function confirmDeleteMember() {
		const target = deleteTarget
		deleteTarget = null
		if (!target) return
		// A cast member IS the graph's node for that person, so one delete
		// removes both; there is no second row to clean up.
		socket.emit("narrativeGraph:deleteNode", { id: target.id })
		if (route.castId === target.id)
			void loreRoute.navigate({ type: "openCastMember", castId: null })
	}

	function addBackground() {
		const name = backgroundName.trim()
		if (!name) return
		addingBackground = false
		backgroundName = ""
		socket.emit("lorebooks:createBinding", {
			lorebookBinding: {
				lorebookId,
				characterId: null,
				// The server derives the real tag from the new row's own id;
				// this placeholder is ignored.
				binding: "",
				name
			}
		} satisfies Sockets.Lorebooks.CreateBinding.Params)
	}

	function pickCharacter(character: { id: number }) {
		characterPickerOpen = false
		if (linkTargetId != null) {
			socket.emit("lorebooks:updateBinding", {
				lorebookBinding: {
					id: linkTargetId,
					characterId: character.id
				}
			} as Sockets.Lorebooks.UpdateBinding.Params)
		} else {
			socket.emit("lorebooks:createBinding", {
				lorebookBinding: {
					lorebookId,
					characterId: character.id,
					binding: ""
				}
			} satisfies Sockets.Lorebooks.CreateBinding.Params)
		}
		linkTargetId = null
	}

	function unlink(id: number) {
		socket.emit("lorebooks:updateBinding", {
			lorebookBinding: { id, characterId: null }
		} as Sockets.Lorebooks.UpdateBinding.Params)
	}

	let unlinkedCharacters = $derived(
		characterList.filter(
			(c) => !castRows.some((r) => r.characterId === c.id)
		)
	)
	let channel: ReturnType<typeof entryChannel> | null = null

	// Named so `off` can name them too: a bare off() removes every listener for
	// the event, including any other open lorebooks UI.
	function handleBindingList(msg: Sockets.Lorebooks.BindingList.Response) {
		if (msg.lorebookId !== lorebookId) return
		castRows = msg.lorebookBindingList as CastRow[]
		loading = false
	}

	function handleCharactersList(msg: Sockets.Characters.List.Response) {
		characterList = msg.characterList || []
	}

	/**
	 * The cast pool this workspace picks from — ONE list, because a persona is
	 * a character. BARE: it is the whole of this user's characters, not one
	 * lorebook's rows, so it has no interest scope to narrow to — and
	 * standing, because it is a cascade target: a character created or renamed
	 * anywhere re-sends the list. The request that fills it first is in
	 * `onMount` below; the typed `emit` puts the sync packet naming this key
	 * ahead of it on the same socket.
	 */
	useInterest<"characters:list">("characters:list", handleCharactersList)

	function handleCreateBinding(
		msg: Sockets.Lorebooks.CreateBinding.Response
	) {
		toaster.success({
			title: msg.existing
				? "That cast member is already in this book"
				: "Cast member added"
		})
		socket.emit("lorebooks:bindingList", { lorebookId })
	}

	function handleUpdateBinding() {
		toaster.success({ title: "Cast member updated" })
		socket.emit("lorebooks:bindingList", { lorebookId })
	}

	function handleDeleteNode() {
		toaster.success({ title: "Cast member deleted" })
		socket.emit("lorebooks:bindingList", { lorebookId })
	}

	function handleMergeWrite() {
		socket.emit("lorebooks:bindingList", { lorebookId })
		refreshGraph()
	}

	function handleGraphList(msg: Sockets.NarrativeGraph.List.Response) {
		graphRows = msg.nodes
		relationships = msg.relationships
	}

	function handleRelationshipWrite() {
		refreshGraph()
	}

	function handleEntriesList(msg: Sockets.Entries.List.Response) {
		// One namespace, so the character lore channel's own list arrives here
		// too; the filter is what makes that harmless.
		if (msg.lorebookId !== lorebookId || msg.typeId !== HISTORY_TYPE_ID)
			return
		historyEntries = msg.entryList as unknown as DatedEntryLike[]
	}

	function handleSuggestions(msg: Sockets.BindingSuggestions.List.Response) {
		if (msg.lorebookId !== lorebookId) return
		suggestions = msg.suggestions
	}

	function handleDuplicates(
		msg: Sockets.NarrativeGraph.DuplicateCandidates.Response
	) {
		if (msg.lorebookId !== lorebookId) return
		duplicates = msg.candidates
	}

	function refreshGraph() {
		socket.emit("narrativeGraph:list", { lorebookId })
	}

	/**
	 * The five reads that name this book, SCOPED to it. `lorebooks:bindingList`
	 * is a STANDING key rather than a one-shot: it is a cascade target — every
	 * binding write in this workspace answers with a fresh list — so it is held
	 * for as long as the workspace is open, not just across the first request.
	 *
	 * Effects rather than `useInterest` because a key built from a prop is a
	 * key that can move, and `useInterest` keeps the one it was first given.
	 * Declared above `onMount` so all of them exist before the reads go out
	 * (effects run in creation order, and `onMount` is one of them).
	 */
	$effect(() =>
		declareInterest<"lorebooks:bindingList">(
			interestKey("lorebooks:bindingList", lorebookId),
			handleBindingList
		)
	)
	$effect(() =>
		declareInterest<"entries:list">(
			interestKey("entries:list", lorebookId),
			handleEntriesList
		)
	)
	$effect(() =>
		declareInterest<"bindingSuggestions:list">(
			interestKey("bindingSuggestions:list", lorebookId),
			handleSuggestions
		)
	)
	$effect(() =>
		declareInterest<"narrativeGraph:list">(
			interestKey("narrativeGraph:list", lorebookId),
			handleGraphList
		)
	)
	$effect(() =>
		declareInterest<"narrativeGraph:duplicateCandidates">(
			interestKey("narrativeGraph:duplicateCandidates", lorebookId),
			handleDuplicates
		)
	)

	/**
	 * The writes answer with the binding, node or edge alone and name no book,
	 * so every one of them is BARE — none has an entry in `SCOPED_EVENTS`, and
	 * a scoped key for an unscoped event matches nothing at all. Each answers
	 * by re-reading through one of the scoped keys above.
	 */
	useInterest<"lorebooks:createBinding">(
		"lorebooks:createBinding",
		handleCreateBinding
	)
	useInterest<"lorebooks:updateBinding">(
		"lorebooks:updateBinding",
		handleUpdateBinding
	)
	useInterest<"narrativeGraph:deleteNode">(
		"narrativeGraph:deleteNode",
		handleDeleteNode
	)
	useInterest<"narrativeGraph:mergeNode">(
		"narrativeGraph:mergeNode",
		handleMergeWrite
	)
	useInterest<"narrativeGraph:undoMerge">(
		"narrativeGraph:undoMerge",
		handleMergeWrite
	)
	useInterest<"narrativeGraph:createRelationship">(
		"narrativeGraph:createRelationship",
		handleRelationshipWrite
	)
	useInterest<"narrativeGraph:updateRelationship">(
		"narrativeGraph:updateRelationship",
		handleRelationshipWrite
	)
	useInterest<"narrativeGraph:deleteRelationship">(
		"narrativeGraph:deleteRelationship",
		handleRelationshipWrite
	)

	onMount(() => {
		channel = entryChannel(socket, {
			lorebookId,
			typeId: CHARACTER_LORE_TYPE_ID,
			vectorSource: "characterLore",
			handlers: {
				onList(entries) {
					loreEntries = entries as LoreRow[]
				},
				onVectorized(id, embeddingModel) {
					loreEntries = loreEntries.map((e) =>
						e.id === id ? { ...e, embeddingModel } : e
					)
				},
				onCreated(entry) {
					toaster.success({ title: "Character lore created" })
					if (awaitingSave !== "new") return
					awaitingSave = null
					void loreRoute.navigate({
						type: "openEntry",
						entryId: entry.id
					})
				},
				onUpdated(entry) {
					toaster.success({ title: "Character lore updated" })
					const key = `entry#${entry.id}`
					if (awaitingSave !== key) return
					awaitingSave = null
					// The server re-joins keywords, so the draft and the row
					// are only the same text once the saved row is back.
					if (loreDraftKey === key)
						loreDraft = CHARACTER_LORE_DOOR.toDraft(entry)
				},
				onDeleted: () =>
					toaster.success({ title: "Character lore deleted" })
			}
		})
		channel.open()
		socket.emit("characters:list", {})
		socket.emit("lorebooks:bindingList", { lorebookId })
		socket.emit("entries:list", { lorebookId, typeId: HISTORY_TYPE_ID })
		socket.emit("narrativeGraph:duplicateCandidates", { lorebookId })
		socket.emit("bindingSuggestions:list", { lorebookId })
		refreshGraph()
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		channel?.close()
		// No `off` calls: every listener this workspace had is now an interest
		// key, and the registry releases them as its effects are destroyed.
	})
</script>

{#snippet newMenu()}
	<Popover
		open={newMenuOpen}
		onOpenChange={(e) => (newMenuOpen = e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class="btn btn-sm preset-filled-success-500 shrink-0 gap-1"
			title="Add to the cast"
		>
			<Icons.Plus size={14} aria-hidden="true" />
			<span class="hidden sm:inline">New</span>
			<Icons.ChevronDown size={14} aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-100-900 flex min-w-52 flex-col gap-1 p-2 shadow-xl"
				>
					<button
						class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
						type="button"
						onclick={() => {
							newMenuOpen = false
							linkTargetId = null
							characterPickerOpen = true
						}}
					>
						<Icons.User size={14} aria-hidden="true" /> From a character
					</button>
					<button
						class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
						type="button"
						title="Someone with no card of their own: an innkeeper, a rival nobody has met yet"
						onclick={() => {
							newMenuOpen = false
							backgroundName = ""
							addingBackground = true
						}}
					>
						<Icons.UserRound size={14} aria-hidden="true" /> Background
						character
					</button>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{/snippet}

{#snippet castList()}
	<div class="flex min-h-0 flex-1 flex-col gap-3" data-cast-list>
		<p class="text-surface-700-300 text-sm" data-cast-headline>
			{headerLine}
		</p>
		<div class="flex gap-2">
			<input
				class="input input-sm min-w-0 flex-1"
				type="text"
				placeholder="Search the cast…"
				aria-label="Search the cast"
				bind:value={search}
			/>
			{@render newMenu()}
		</div>

		{#if addingBackground}
			<div
				class="border-border flex flex-col gap-2 rounded-lg border p-3"
			>
				<label class="text-sm font-semibold" for="newBackgroundName">
					Background character name
				</label>
				<input
					id="newBackgroundName"
					class="input text-sm"
					type="text"
					placeholder="e.g. The Innkeeper"
					bind:value={backgroundName}
					onkeydown={(e) => {
						if (e.key === "Enter") addBackground()
						if (e.key === "Escape") addingBackground = false
					}}
				/>
				<div class="flex justify-end gap-2">
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						type="button"
						onclick={() => (addingBackground = false)}
					>
						Cancel
					</button>
					<button
						class="btn btn-sm preset-filled-primary-500"
						type="button"
						disabled={!backgroundName.trim()}
						onclick={addBackground}
					>
						<Icons.Plus size={14} aria-hidden="true" /> Add
					</button>
				</div>
			</div>
		{/if}

		<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<Icons.Loader2
						size={20}
						class="text-surface-400 animate-spin"
					/>
				</div>
			{:else if pool.members.length === 0}
				<EmptyState
					icon={Icons.Users}
					message={search
						? `Nobody in the cast matches "${search}".`
						: "Nobody is in the cast yet. Add a character or a background character, and the lore about them lives on their page."}
				/>
			{:else}
				{#each pool.members as member (member.id)}
					{@const lore = pool.lore.get(member.id) ?? []}
					{@const sentence = castRowSentence({
						aliases: member.aliases,
						kind: member.kind,
						state: member.state,
						loreCount: lore.length,
						relationshipCount: edgeCounts.get(member.id) ?? 0,
						readIn: readInFor(member.id)
					})}
					<button
						type="button"
						data-cast-row
						data-cast-id={member.id}
						aria-current={route.castId === member.id
							? "true"
							: undefined}
						class="preset-filled-surface-100-900 hover:bg-surface-200-800 flex w-full flex-col gap-1 rounded-lg p-3 text-left transition-colors"
						class:preset-tonal-primary={route.castId === member.id}
						onclick={() => selectMember(member.id)}
					>
						<span
							class="flex flex-wrap items-center gap-x-2 gap-y-0.5"
						>
							<span
								class="min-w-[8ch] flex-1 truncate text-sm font-semibold"
							>
								{member.name}
							</span>
							{#if member.state !== "active"}
								<span
									class="badge {stateBadge(member.state)
										.color} shrink-0 text-[10px]"
								>
									{member.state}
								</span>
							{/if}
							{#if member.visibility !== "normal"}
								<span
									class="badge {visibilityBadge(
										member.visibility
									)} shrink-0 text-[10px]"
								>
									{member.visibility}
								</span>
							{/if}
						</span>
						<!-- The macro trails the sentence because it is
						     what an author pastes into content, not what they
						     read the row by. -->
						<span class="flex items-baseline gap-2">
							<span
								class="text-surface-700-300 min-w-0 flex-1 truncate text-[11px]"
								data-cast-sentence
							>
								{sentence}
							</span>
							{#if member.tag}
								<span
									class="text-surface-600-400 shrink-0 font-mono text-[11px]"
									data-cast-tag
								>
									{member.tag}
								</span>
							{/if}
						</span>
					</button>
				{/each}
			{/if}

			{#if pool.unanchored.length > 0 && !search}
				<div
					class="border-warning-500/40 mt-2 rounded-lg border p-3 text-xs"
				>
					<p class="text-warning-600-400 font-semibold">
						{pool.unanchored.length} lore {pool.unanchored
							.length === 1
							? "entry is"
							: "entries are"} anchored to nobody
					</p>
					<p class="text-surface-700-300 mt-1">
						Lore with no member is private to nobody and reaches no
						prompt. Open it from All entries and pick who it belongs
						to.
					</p>
				</div>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet loreEditor()}
	{#if loreDraft}
		{@const Editor = CHARACTER_LORE_DOOR.editor}
		<div class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
					type="button"
					onclick={closeLore}
					title="Back to the cast member"
					aria-label="Back to the cast member"
				>
					<Icons.ChevronLeft size={16} aria-hidden="true" />
				</button>
				<h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
					{creatingLore
						? CHARACTER_LORE_DOOR.newLabel
						: selectedLore
							? CHARACTER_LORE_DOOR.title(selectedLore)
							: ""}
				</h3>
				<button
					class="btn btn-sm preset-filled-success-500 shrink-0"
					type="button"
					onclick={saveLore}
					disabled={!CHARACTER_LORE_DOOR.validate(
						loreDraft,
						loreEntries
					)}
				>
					<Icons.Save size={16} aria-hidden="true" />
					<span>{creatingLore ? "Create" : "Save"}</span>
				</button>
			</div>
			<div class="flex flex-col gap-4">
				<Editor
					bind:draft={loreDraft}
					source={selectedLore}
					isNew={creatingLore}
					bindings={bindingsForEditor}
					vectorizationEnabled={false}
					{lorebookId}
					siblings={loreEntries}
				/>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet memberPage()}
	{#if selectedMember && selectedRow}
		<div class="flex flex-col gap-4">
			<div class="flex items-center gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
					type="button"
					onclick={closeMember}
					title="Close"
					aria-label="Close"
				>
					<Icons.X size={16} aria-hidden="true" />
				</button>
				<h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
					{selectedMember.name}
				</h3>
			</div>

			<CastMemberForm
				member={selectedMember}
				row={selectedRow}
				bind:hasUnsavedChanges={memberDirty}
				onSave={saveMember}
				onDelete={() => (deleteTarget = selectedMember)}
				onUnlink={() => unlink(selectedMember!.id)}
				onLinkCharacter={() => {
					linkTargetId = selectedMember!.id
					characterPickerOpen = true
				}}
			/>

			<CastRelationships
				rows={selectedEdges}
				inStory={selectedInStory}
				laterLabel={laterFor}
				isNew={(edge) => newEdgeIds.has(edge.id)}
				onKeep={(edge) => newEdgeIds.delete(edge.id)}
				onSeeInGraph={() => onViewRelationships?.(selectedMember!.id)}
			/>

			<div class="border-border flex flex-col gap-2 border-t pt-3">
				<div class="flex items-center gap-2">
					<h4 class="flex-1 text-sm font-semibold">
						Lore about {selectedMember.name}
						{anchoredLore.length}
					</h4>
					<button
						class="btn btn-sm preset-filled-success-500 shrink-0"
						type="button"
						onclick={startLore}
					>
						<Icons.Plus size={14} aria-hidden="true" /> Add lore
					</button>
				</div>
				{#if readInFor(selectedMember.id)}
					<p class="text-surface-600-400 text-xs" data-cast-read-in>
						{castReadInLine({ fired: true })}
					</p>
				{/if}
				{#if anchoredLore.length === 0}
					<p class="text-surface-700-300 text-xs italic">
						Nothing private to them yet. Character lore is what only
						this member would know: secrets, backstory, abilities.
					</p>
				{:else}
					<ul class="flex flex-col gap-2">
						{#each anchoredLore as entry (entry.id)}
							<li>
								<button
									type="button"
									data-cast-lore-row
									data-entry-key="entry#{entry.id}"
									class="preset-filled-surface-100-900 hover:bg-surface-200-800 flex w-full flex-col gap-0.5 rounded-lg p-2 text-left transition-colors"
									class:opacity-60={entry.enabled === false}
									onclick={() => selectLore(entry)}
								>
									<span
										class="truncate text-sm font-semibold"
									>
										{entry.name || "Untitled"}
									</span>
									<span
										class="text-surface-600-400 line-clamp-2 text-xs"
									>
										{entry.content?.trim() ||
											"No content yet."}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{:else}
		<div
			class="text-surface-700-300 flex flex-1 items-center justify-center p-6 text-center text-sm italic"
		>
			Pick someone to see their standing in the world and the lore private
			to them.
		</div>
	{/if}
{/snippet}

{#snippet inspector()}
	<div class="border-border border-t pt-3" data-cast-inspector>
		{#if outstanding}
			<p class="text-surface-700-300 mb-2 text-xs" data-cast-review>
				{outstanding}
			</p>
		{/if}
		<div class="flex gap-1" role="group" aria-label="Cast inspector">
			<button
				type="button"
				class="btn btn-sm {inspectorTab === 'suggestions'
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				aria-pressed={inspectorTab === "suggestions"}
				onclick={() => (inspectorTab = "suggestions")}
			>
				Suggestions
			</button>
			<button
				type="button"
				class="btn btn-sm {inspectorTab === 'duplicates'
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				aria-pressed={inspectorTab === "duplicates"}
				onclick={() => (inspectorTab = "duplicates")}
			>
				Duplicates
			</button>
		</div>
		<div class="mt-2">
			{#if inspectorTab === "suggestions"}
				<BindingSuggestionsPanel {lorebookId} />
			{:else}
				<CastDuplicatesPanel {lorebookId} />
			{/if}
		</div>
	</div>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col" data-lore-section="cast">
	{#if mode === "desk"}
		<div class="flex min-h-0 flex-1 gap-4">
			<div class="flex min-h-0 min-w-0 flex-1 flex-col">
				{@render castList()}
			</div>
			<div
				class="border-border flex min-h-0 w-[420px] shrink-0 flex-col gap-4 overflow-y-auto border-l pl-4"
				data-cast-editor
			>
				{#if loreDraft}
					{@render loreEditor()}
				{:else}
					{@render memberPage()}
				{/if}
				{@render inspector()}
			</div>
		</div>
	{:else if editorOpen}
		<div
			class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
			data-cast-editor
		>
			{#if loreDraft}
				{@render loreEditor()}
			{:else}
				{@render memberPage()}
			{/if}
			{@render inspector()}
		</div>
	{:else}
		{@render castList()}
	{/if}
</div>

<DeleteLorebookEntryConfirmModal
	open={deleteTarget !== null}
	onOpenChange={(e) => {
		if (!e.open) deleteTarget = null
	}}
	onConfirm={confirmDeleteMember}
	onCancel={() => (deleteTarget = null)}
	title="Delete cast member?"
	message={deleteTarget?.linked
		? "This detaches the linked card from this lorebook and deletes the member, including the lore private to them and every relationship they are in. This cannot be undone."
		: "This permanently deletes this background character, including the lore private to them and every relationship they are in. This cannot be undone."}
/>

<CharacterSelectModal
	open={characterPickerOpen}
	onSelect={pickCharacter}
	onOpenChange={() => (characterPickerOpen = false)}
	characters={unlinkedCharacters}
/>
