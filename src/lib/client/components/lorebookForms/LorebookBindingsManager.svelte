<script lang="ts">
	import PersonaSelectModal from "../modals/PersonaSelectModal.svelte"
	import CharacterSelectModal from "../modals/CharacterSelectModal.svelte"
	import DeleteLorebookEntryConfirmModal from "../modals/DeleteLorebookEntryConfirmModal.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { onMount, onDestroy, tick } from "svelte"

	interface Props {
		lorebookId: number // ID of the lorebook to edit
		// Arriving from the Graph tab's "Edit" button — sorts this binding
		// to the top of the list and opens it in edit mode.
		focusBindingId?: number | null
		onFocusHandled?: () => void
		// "View relationships" in the detail card — switches the parent's
		// tab to Graph and selects this character's node there.
		onNavigateToGraph?: (bindingId: number) => void
	}

	let {
		lorebookId,
		focusBindingId,
		onFocusHandled,
		onNavigateToGraph
	}: Props = $props()

	const NODE_STATES = ["active", "deceased", "missing", "departed"] as const
	const NODE_VISIBILITY = ["normal", "legendary", "hidden"] as const
	const NODE_STATE_COLOR: Record<string, string> = {
		active: "preset-tonal-primary",
		deceased: "preset-tonal-error",
		missing: "preset-tonal-surface",
		departed: "preset-tonal-secondary"
	}
	const NODE_STATE_RING: Record<string, string> = {
		active: "ring-primary-500",
		deceased: "ring-error-500",
		missing: "ring-surface-400",
		departed: "ring-secondary-500"
	}
	const NODE_VISIBILITY_COLOR: Record<string, string> = {
		normal: "",
		legendary: "preset-tonal-warning",
		hidden: "preset-tonal-surface"
	}

	const socket = useTypedSocket()

	let showLinkPersonaBindingModal = $state(false)
	let showLinkCharacterBindingModal = $state(false)
	let showAddPersonaBindingModal = $state(false)
	let showAddCharacterBindingModal = $state(false)
	// Background/NPC character — a binding with no character/persona
	// attached, identified only by a name. Post-merge this row also IS the
	// character's graph presence (see the merge plan) — this is the
	// consolidated create flow that used to live in GraphManager's
	// create-node form.
	let showAddBackgroundModal = $state(false)
	let newBackgroundName = $state("")
	let lorebookBindingId: number | null = $state(null)

	// Inline identity + status edit — name (unbound rows only), summary, and
	// the "status in world" fields (state/visibility) that used to live in
	// the Graph tab's own edit form (now purely informational — see the
	// merge plan's UI consolidation). A bound row's name/aliases are always
	// derived from its character/persona (decision 2) and are never
	// editable here; only summary/state/visibility are editable for a
	// bound row.
	let editingBindingId = $state<number | null>(null)
	let editingName = $state("")
	let editingAliases = $state("")
	let editingSummary = $state("")
	let editingNodeState = $state<(typeof NODE_STATES)[number]>("active")
	let editingNodeVisibility =
		$state<(typeof NODE_VISIBILITY)[number]>("normal")

	// Arriving from the Graph tab — pin the target binding to the top of
	// the list and open it in edit mode. Stays pinned locally even after
	// the parent clears its focus prop (onFocusHandled), so the sort order
	// doesn't jump back the moment the effect below fires.
	let pinnedBindingId = $state<number | null>(null)

	// Delete confirmation
	let showDeleteBindingModal = $state(false)
	let deleteBindingTarget = $state<SelectLorebookBinding | null>(null)
	let characterList: Sockets.Characters.List.Response["characterList"] =
		$state([])
	let lorebookBindingList: SelectLorebookBinding[] = $state([])
	let personaList: Sockets.Personas.List.Response["personaList"] = $state([])

	// Recent absorbs (see narrativeGraph:mergeNode) — a safety net, not a
	// primary workflow, so kept small and out of the way.
	let mergeLogs = $state<
		Sockets.NarrativeGraph.ListMergeLogs.MergeLogEntry[]
	>([])
	let showMergeLogs = $state(false)

	// Proactive duplicate review — refreshed automatically after every
	// graph build/extend, plus fetched on mount.
	let duplicateCandidates = $state<
		Sockets.NarrativeGraph.DuplicateCandidates.Candidate[]
	>([])

	let availableBindingCharacters = $derived.by(() => {
		// Filter out the characters that are already bound to this lorebook
		return characterList.filter(
			(c) =>
				!lorebookBindingList.some(
					(b) => b.characterId === c.id && b.lorebookId === lorebookId
				)
		)
	})

	let availableBindingPersonas = $derived.by(() => {
		// Filter out the personas that are already bound to this lorebook
		return personaList.filter(
			(p) =>
				!lorebookBindingList.some(
					(b) => b.personaId === p.id && b.lorebookId === lorebookId
				)
		)
	})

	let sortedBindingList = $derived.by(() => {
		if (pinnedBindingId == null) return lorebookBindingList
		const idx = lorebookBindingList.findIndex(
			(b) => b.id === pinnedBindingId
		)
		if (idx <= 0) return lorebookBindingList
		const copy = [...lorebookBindingList]
		const [pinned] = copy.splice(idx, 1)
		copy.unshift(pinned)
		return copy
	})

	// Guards the auto-open-edit effect below so it fires exactly once per
	// pin — without it, cancelling out of the auto-opened edit form would
	// immediately reopen it, since editingBindingId going back to null
	// looks identical to "hasn't been opened yet".
	let autoEditOpenedFor = $state<number | null>(null)

	$effect(() => {
		if (focusBindingId == null) return
		pinnedBindingId = focusBindingId
		onFocusHandled?.()
	})

	$effect(() => {
		if (pinnedBindingId == null || autoEditOpenedFor === pinnedBindingId)
			return
		const binding = lorebookBindingList.find(
			(b) => b.id === pinnedBindingId
		)
		if (binding) {
			startEditBinding(binding)
			autoEditOpenedFor = pinnedBindingId
		}
	})

	function unlinkBinding(id: number) {
		const req: Sockets.Lorebooks.UpdateBinding.Params = {
			lorebookBinding: {
				id,
				personaId: null,
				characterId: null
			}
		}
		socket?.emit("lorebooks:updateBinding", req)
	}

	function onClickLinkCharacterBinding(bindingId: number) {
		lorebookBindingId = bindingId
		showLinkCharacterBindingModal = true
	}

	function onClickLinkPersonaBinding(bindingId: number) {
		lorebookBindingId = bindingId
		showLinkPersonaBindingModal = true
	}

	function onClickAddCharacterBinding() {
		showAddCharacterBindingModal = true
	}

	function onClickAddPersonaBinding() {
		showAddPersonaBindingModal = true
	}

	function onClickAddBackgroundCharacter() {
		newBackgroundName = ""
		showAddBackgroundModal = true
	}

	function handleAddBackgroundCharacter() {
		const name = newBackgroundName.trim()
		if (!name) return
		showAddBackgroundModal = false
		const req: Sockets.Lorebooks.CreateBinding.Params = {
			lorebookBinding: {
				lorebookId: lorebookId ?? 0,
				characterId: null,
				personaId: null,
				binding: "",
				name
			}
		}
		socket?.emit("lorebooks:createBinding", req)
		newBackgroundName = ""
	}

	function handleLinkPersonaBindingSelect(
		persona: Partial<SelectPersona> & { id: number }
	) {
		showLinkPersonaBindingModal = false
		const req: Sockets.Lorebooks.UpdateBinding.Params = {
			lorebookBinding: {
				id: lorebookBindingId ?? 0,
				personaId: persona.id,
				characterId: null
			}
		}
		socket?.emit("lorebooks:updateBinding", req)
		lorebookBindingId = null
	}

	function handleLinkCharacterBindingSelect(
		character: Partial<SelectCharacter> & { id: number }
	) {
		showLinkCharacterBindingModal = false
		const req: Sockets.Lorebooks.UpdateBinding.Params = {
			lorebookBinding: {
				id: lorebookBindingId ?? 0,
				characterId: character.id ?? null,
				personaId: null
			}
		}
		socket?.emit("lorebooks:updateBinding", req)
		lorebookBindingId = null
	}

	// `binding` is sent as an empty placeholder and ignored server-side —
	// the server always derives the real token from the new row's own real
	// id (never reused after a delete), see decision 1 in the merge plan.
	// This used to compute a token here via Math.max(existingNumbers)+1,
	// which silently reused a deleted binding's number and collided with
	// that old number still baked into stored lore/history content.
	function handleAddPersonaBindingSelect(
		persona: Partial<SelectPersona> & { id: number }
	) {
		showAddPersonaBindingModal = false
		const req: Sockets.Lorebooks.CreateBinding.Params = {
			lorebookBinding: {
				lorebookId: lorebookId ?? 0,
				personaId: persona.id ?? null,
				characterId: null,
				binding: ""
			}
		}
		socket?.emit("lorebooks:createBinding", req)
		lorebookBindingId = null
	}

	function handleAddCharacterBindingSelect(
		character: Partial<SelectCharacter> & { id: number }
	) {
		showAddCharacterBindingModal = false
		const req: Sockets.Lorebooks.CreateBinding.Params = {
			lorebookBinding: {
				lorebookId: lorebookId ?? 0,
				characterId: character.id ?? null,
				personaId: null,
				binding: ""
			}
		}
		socket?.emit("lorebooks:createBinding", req)
		lorebookBindingId = null
	}

	function startEditBinding(binding: SelectLorebookBinding) {
		editingBindingId = binding.id
		editingName = binding.name ?? ""
		editingAliases = (binding.aliases ?? []).join(", ")
		editingSummary = binding.summary ?? ""
		editingNodeState = binding.nodeState as (typeof NODE_STATES)[number]
		editingNodeVisibility =
			binding.nodeVisibility as (typeof NODE_VISIBILITY)[number]
	}

	function cancelEditBinding() {
		editingBindingId = null
	}

	function saveEditBinding(binding: SelectLorebookBinding) {
		const isBound = !!binding.characterId || !!binding.personaId
		const aliases = editingAliases
			.split(",")
			.map((a) => a.trim())
			.filter(Boolean)
		const req: Sockets.Lorebooks.UpdateBinding.Params = {
			lorebookBinding: {
				id: binding.id,
				summary: editingSummary.trim() || null,
				nodeState: editingNodeState,
				nodeVisibility: editingNodeVisibility,
				...(isBound ? {} : { name: editingName.trim(), aliases })
			}
		}
		socket?.emit("lorebooks:updateBinding", req)
		editingBindingId = null
	}

	function onClickDeleteBinding(binding: SelectLorebookBinding) {
		deleteBindingTarget = binding
		showDeleteBindingModal = true
	}

	function cancelDeleteBinding() {
		showDeleteBindingModal = false
		deleteBindingTarget = null
	}

	function confirmDeleteBinding() {
		if (!deleteBindingTarget) return
		// Reuses narrativeGraph:deleteNode — a binding IS the character's
		// graph presence now, so this is the same delete either way (see
		// the merge plan's UI consolidation). Deleting a bound row detaches
		// its character/persona from this lorebook.
		socket?.emit("narrativeGraph:deleteNode", { id: deleteBindingTarget.id })
		showDeleteBindingModal = false
		deleteBindingTarget = null
	}

	// Aliases + absorbedAliases (identities absorbed via narrativeGraph:mergeNode)
	// are unioned for display — from the user's perspective a binding simply
	// "has aliases"; the split is a storage-layer detail (see schema.ts's
	// comment on absorbedAliases for why they're not the same column).
	function allAliases(binding: SelectLorebookBinding): string[] {
		return [
			...new Set([
				...(binding.aliases ?? []),
				...(binding.absorbedAliases ?? [])
			])
		]
	}

	function getBindingCharacter(binding: SelectLorebookBinding) {
		// First check if the binding already has the character/persona populated from the server
		const bindingWithRelations = binding as SelectLorebookBinding & {
			character?: SelectCharacter | null
			persona?: SelectPersona | null
		}

		if (bindingWithRelations.character) {
			return bindingWithRelations.character
		}
		if (bindingWithRelations.persona) {
			return bindingWithRelations.persona
		}

		// Fallback to looking them up in the lists
		return binding.characterId
			? characterList.find((c) => c.id === binding.characterId)
			: binding.personaId
				? personaList.find((p) => p.id === binding.personaId)
				: null
	}

	async function handleLorebooksBindingList(
		msg: Sockets.Lorebooks.BindingList.Response
	) {
		if (msg.lorebookId === lorebookId) {
			lorebookBindingList = msg.lorebookBindingList || []
		}
		await tick()
	}

	function handleCharactersList(msg: Sockets.Characters.List.Response) {
		characterList = msg.characterList || []
	}

	function handlePersonasList(msg: Sockets.Personas.List.Response) {
		personaList = msg.personaList || []
	}

	function handleLorebooksCreateBinding(
		msg: Sockets.Lorebooks.CreateBinding.Response
	) {
		toaster.success({
			title: "Binding Created",
			description: "Lorebook binding created successfully."
		})
	}

	function handleLorebooksUpdateBinding(
		msg: Sockets.Lorebooks.UpdateBinding.Response
	) {
		toaster.success({
			title: "Binding Updated",
			description: "Lorebook binding updated successfully."
		})
	}

	function handleNarrativeGraphDeleteNode() {
		toaster.success({
			title: "Binding Deleted",
			description: "Lorebook binding deleted successfully."
		})
		const bindingReq: Sockets.Lorebooks.BindingList.Params = {
			lorebookId
		}
		socket.emit("lorebooks:bindingList", bindingReq)
	}

	function handleNarrativeGraphMergeNode(
		msg: Sockets.NarrativeGraph.MergeNode.Response
	) {
		toaster.success({
			title: "Absorbed",
			description: `Merged into "${msg.survivorNode.name}". Undo from Recent Merges below if this was a mistake.`
		})
		fetchMergeLogs()
		socket.emit("lorebooks:bindingList", { lorebookId })
	}

	function handleNarrativeGraphListMergeLogs(
		msg: Sockets.NarrativeGraph.ListMergeLogs.Response
	) {
		if (msg.lorebookId === lorebookId) {
			mergeLogs = msg.mergeLogs
		}
	}

	function handleNarrativeGraphUndoMerge(
		msg: Sockets.NarrativeGraph.UndoMerge.Response
	) {
		toaster.success({
			title: "Merge undone",
			description: `"${msg.restoredNode.name}" restored.`
		})
		fetchMergeLogs()
		socket.emit("lorebooks:bindingList", { lorebookId })
	}

	function handleNarrativeGraphDuplicateCandidates(
		msg: Sockets.NarrativeGraph.DuplicateCandidates.Response
	) {
		if (msg.lorebookId === lorebookId) {
			duplicateCandidates = msg.candidates
		}
	}

	onMount(() => {
		if (!socket) return

		socket.on("characters:list", handleCharactersList)
		socket.on("personas:list", handlePersonasList)
		socket.on("lorebooks:bindingList", handleLorebooksBindingList)
		socket.on("lorebooks:createBinding", handleLorebooksCreateBinding)
		socket.on("lorebooks:updateBinding", handleLorebooksUpdateBinding)
		socket.on("narrativeGraph:deleteNode", handleNarrativeGraphDeleteNode)
		socket.on("narrativeGraph:mergeNode", handleNarrativeGraphMergeNode)
		socket.on(
			"narrativeGraph:listMergeLogs",
			handleNarrativeGraphListMergeLogs
		)
		socket.on("narrativeGraph:undoMerge", handleNarrativeGraphUndoMerge)
		socket.on(
			"narrativeGraph:duplicateCandidates",
			handleNarrativeGraphDuplicateCandidates
		)

		socket.emit("characters:list", {})
		socket.emit("personas:list", {})
		const bindingReq: Sockets.Lorebooks.BindingList.Params = {
			lorebookId
		}
		socket.emit("lorebooks:bindingList", bindingReq)
		fetchMergeLogs()
		socket.emit("narrativeGraph:duplicateCandidates", {
			lorebookId
		} satisfies Sockets.NarrativeGraph.DuplicateCandidates.Params)
	})

	function fetchMergeLogs() {
		socket?.emit("narrativeGraph:listMergeLogs", {
			lorebookId
		} satisfies Sockets.NarrativeGraph.ListMergeLogs.Params)
	}

	function undoMerge(mergeLogId: number) {
		socket?.emit("narrativeGraph:undoMerge", {
			mergeLogId
		} satisfies Sockets.NarrativeGraph.UndoMerge.Params)
	}

	function absorbDuplicate(
		candidate: Sockets.NarrativeGraph.DuplicateCandidates.Candidate
	) {
		socket?.emit("narrativeGraph:mergeNode", {
			nodeId: candidate.bindingIdA,
			parentNodeId: candidate.bindingIdB
		} satisfies Sockets.NarrativeGraph.MergeNode.Params)
		// Optimistic — the server's own duplicateCandidates re-emit after the
		// merge will correct this if anything's off.
		duplicateCandidates = duplicateCandidates.filter((c) => c !== candidate)
	}

	function dismissDuplicate(
		candidate: Sockets.NarrativeGraph.DuplicateCandidates.Candidate
	) {
		socket?.emit("narrativeGraph:dismissDuplicate", {
			lorebookId,
			bindingIdA: candidate.bindingIdA,
			bindingIdB: candidate.bindingIdB
		} satisfies Sockets.NarrativeGraph.DismissDuplicate.Params)
	}

	onDestroy(() => {
		if (!socket) return
		socket.off("characters:list", handleCharactersList)
		socket.off("personas:list", handlePersonasList)
		socket.off("lorebooks:bindingList", handleLorebooksBindingList)
		socket.off("lorebooks:createBinding", handleLorebooksCreateBinding)
		socket.off("lorebooks:updateBinding", handleLorebooksUpdateBinding)
		socket.off(
			"narrativeGraph:deleteNode",
			handleNarrativeGraphDeleteNode
		)
		socket.off("narrativeGraph:mergeNode", handleNarrativeGraphMergeNode)
		socket.off(
			"narrativeGraph:listMergeLogs",
			handleNarrativeGraphListMergeLogs
		)
		socket.off("narrativeGraph:undoMerge", handleNarrativeGraphUndoMerge)
		socket.off(
			"narrativeGraph:duplicateCandidates",
			handleNarrativeGraphDuplicateCandidates
		)
	})
</script>

<div>
	<div class="bindings-tab">
		<div class="mb-4 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500 w-full"
				onclick={() => onClickAddCharacterBinding()}
			>
				<Icons.Plus size={16} /> Add Character
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500 w-full"
				onclick={() => onClickAddPersonaBinding()}
			>
				<Icons.Plus size={16} /> Add Persona
			</button>
			<button
				class="btn btn-sm preset-filled-surface-400-600 w-full"
				onclick={() => onClickAddBackgroundCharacter()}
				title="A named character with no linked character/persona sheet — useful for background or NPC figures the graph should track."
			>
				<Icons.Plus size={16} /> Add Background Character
			</button>
		</div>
		{#if showAddBackgroundModal}
			<div
				class="preset-outlined-surface-300-700 mb-2 flex w-full flex-col gap-2 rounded-lg p-3"
			>
				<label
					class="text-surface-700-300 text-xs font-semibold uppercase"
					for="newBackgroundName"
				>
					Background character name
				</label>
				<input
					id="newBackgroundName"
					class="input text-sm"
					type="text"
					placeholder="e.g. The Innkeeper"
					bind:value={newBackgroundName}
					onkeydown={(e) => {
						if (e.key === "Enter") handleAddBackgroundCharacter()
						if (e.key === "Escape") showAddBackgroundModal = false
					}}
				/>
				<div class="flex justify-end gap-2">
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						onclick={() => (showAddBackgroundModal = false)}
					>
						Cancel
					</button>
					<button
						class="btn btn-sm preset-filled-primary-500"
						disabled={!newBackgroundName.trim()}
						onclick={() => handleAddBackgroundCharacter()}
					>
						<Icons.Plus size={16} /> Add
					</button>
				</div>
			</div>
		{/if}
		<!-- sm:grid-cols-2 was a viewport breakpoint, not a container one — it
			tracked the browser window's width, not this panel's own (often much
			narrower, or — fullscreen — much wider) width, so it was
			effectively stuck at 2 columns forever. auto-fill/minmax scales off
			the grid's own width instead, same fix as Characters/Personas
			sidebars' card grids. -->
		<div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
			{#if sortedBindingList.length === 0}
				<div
					class="text-muted-foreground col-span-full w-full py-8 text-center text-sm"
				>
					No bindings yet. Add a character or persona binding to get
					started.
				</div>
			{:else}
				{#each sortedBindingList as binding (binding.id)}
					{@render bindingCard(binding)}
				{/each}
			{/if}
		</div>

		{#if duplicateCandidates.length > 0}
			<div
				class="border-warning-500/40 bg-warning-500/5 mt-4 space-y-2 rounded-lg border p-3"
			>
				<p
					class="text-warning-600-400 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
				>
					<Icons.Users size={13} />
					Possible duplicates ({duplicateCandidates.length})
				</p>
				<div class="flex flex-col gap-1.5">
					{#each duplicateCandidates as candidate (candidate.bindingIdA + '-' + candidate.bindingIdB)}
						<div
							class="bg-surface-50-950 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs"
						>
							<span>
								"{candidate.nameA}" and "{candidate.nameB}" —
								same person?
							</span>
							<div class="flex shrink-0 gap-2">
								<button
									class="btn btn-sm preset-filled-warning-500"
									onclick={() => absorbDuplicate(candidate)}
								>
									<Icons.GitMerge size={12} /> Yes, absorb
								</button>
								<button
									class="text-surface-500 hover:underline"
									onclick={() => dismissDuplicate(candidate)}
								>
									No, different people
								</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if mergeLogs.length > 0}
			<div class="mt-4">
				<button
					type="button"
					class="text-surface-500 flex items-center gap-1 text-xs hover:underline"
					onclick={() => (showMergeLogs = !showMergeLogs)}
				>
					<Icons.ChevronRight
						size={12}
						class="transition-transform {showMergeLogs
							? 'rotate-90'
							: ''}"
					/>
					Recent merges ({mergeLogs.length})
				</button>
				{#if showMergeLogs}
					<div class="mt-2 flex flex-col gap-1.5">
						{#each mergeLogs as log (log.id)}
							<div
								class="border-surface-300-700 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
							>
								<span class="text-surface-600-400">
									"{log.absorbedName}" absorbed into "{log.survivorName ??
										'(deleted)'}"
								</span>
								<button
									class="text-primary-500 shrink-0 hover:underline disabled:opacity-40"
									disabled={log.survivorId === null}
									title={log.survivorId === null
										? "Can no longer be undone — the surviving character has since been absorbed elsewhere or deleted."
										: "Undo this merge"}
									onclick={() => undoMerge(log.id)}
								>
									Undo
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#snippet bindingCard(binding: SelectLorebookBinding)}
	{@const char = getBindingCharacter(binding)}
	{@const isBound = !!char}
	{@const isEditing = editingBindingId === binding.id}
	{@const fallbackDescription = char
		? "creatorNotes" in char
			? char.creatorNotes
			: char.description
		: null}
	{@const displayName = char
		? "nickname" in char && char.nickname
			? char.nickname
			: char.name
		: binding.name || "Unnamed"}
	{@const kindLabel = binding.characterId
		? "Character"
		: binding.personaId
			? "Persona"
			: "Background"}
	<div
		class="group border-surface-300-700 bg-surface-50-950 hover:border-primary-500/40 hover:shadow-surface-950/5 relative flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition-all hover:shadow-md"
		class:ring-primary-500={binding.id === pinnedBindingId}
		class:ring-2={binding.id === pinnedBindingId}
	>
		<div class="flex items-start gap-3">
			<div class="relative shrink-0">
				{#if char}
					<div
						class="ring-offset-surface-50-950 rounded-full ring-2 ring-offset-2 {NODE_STATE_RING[
							binding.nodeState
						] ?? 'ring-surface-400'}"
					>
						<Avatar {char} />
					</div>
				{:else}
					<div
						class="ring-offset-surface-50-950 bg-surface-200-800 text-surface-500 flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 {NODE_STATE_RING[
							binding.nodeState
						] ?? 'ring-surface-400'}"
					>
						<Icons.UserRound size={18} />
					</div>
				{/if}
			</div>

			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="truncate text-sm font-semibold select-none">
						{displayName}
					</span>
					{#if allAliases(binding).length > 0}
						<span
							class="text-surface-500 truncate text-xs select-none"
						>
							a.k.a. {allAliases(binding).join(", ")}
						</span>
					{/if}
					{#if binding.nodeState !== "active"}
						<span
							class="badge {NODE_STATE_COLOR[
								binding.nodeState
							] ?? 'preset-tonal-surface'} text-[10px]"
						>
							{binding.nodeState}
						</span>
					{/if}
					{#if binding.nodeVisibility !== "normal"}
						<span
							class="badge {NODE_VISIBILITY_COLOR[
								binding.nodeVisibility
							] ?? 'preset-tonal-surface'} text-[10px]"
						>
							{binding.nodeVisibility}
						</span>
					{/if}
				</div>
				{#if !isEditing}
					<p
						class="text-surface-600-400 line-clamp-2 text-left text-xs select-none"
					>
						{binding.summary ||
							fallbackDescription ||
							(isBound
								? ""
								: "Background character — no linked character/persona sheet.")}
					</p>
				{/if}
			</div>

			<div
				class="absolute top-3 right-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 hover:opacity-100"
				class:opacity-100={isEditing}
			>
				{#if !isEditing}
					<button
						onclick={() => startEditBinding(binding)}
						class="btn btn-sm preset-filled-surface-400-600 p-1.5"
						title="Edit {isBound ? 'status' : 'name, summary & status'}"
						aria-label="Edit binding"
					>
						<Icons.Pencil size={14} />
					</button>
					<button
						onclick={() => onClickDeleteBinding(binding)}
						class="btn btn-sm preset-tonal-error p-1.5"
						title="Delete binding"
						aria-label="Delete binding"
					>
						<Icons.Trash2 size={14} />
					</button>
				{/if}
			</div>
		</div>

		{#if isEditing}
			<div class="flex flex-col gap-3 text-sm">
				{#if !isBound}
					<div class="space-y-1">
						<label
							class="text-surface-700-300 text-xs font-semibold uppercase"
							for="editName-{binding.id}"
						>
							Name
						</label>
						<input
							id="editName-{binding.id}"
							class="input text-sm"
							type="text"
							bind:value={editingName}
						/>
					</div>
					<div class="space-y-1">
						<label
							class="text-surface-700-300 text-xs font-semibold uppercase"
							for="editAliases-{binding.id}"
						>
							Aliases <span
								class="text-surface-700-300 text-xs font-normal"
							>
								(comma separated)
							</span>
						</label>
						<input
							id="editAliases-{binding.id}"
							class="input text-sm"
							type="text"
							placeholder="e.g. Bram, the Blacksmith"
							bind:value={editingAliases}
						/>
						<p class="text-surface-500 text-xs">
							Other names this character is known by — helps
							scene summarization recognize them under a
							nickname or title instead of creating a
							duplicate.
						</p>
					</div>
				{:else if allAliases(binding).length > 0}
					<div class="space-y-1">
						<p
							class="text-surface-700-300 text-xs font-semibold uppercase"
						>
							Aliases
						</p>
						<p class="text-surface-600-400 text-sm">
							{allAliases(binding).join(", ")}
						</p>
						<p class="text-surface-500 text-xs">
							{binding.aliases?.length
								? `Synced from ${binding.characterId ? "the character's" : "the persona's"} own nickname/aliases — edit there to change.`
								: ""}
							{binding.absorbedAliases?.length
								? "Includes identities absorbed from a merged duplicate."
								: ""}
						</p>
					</div>
				{/if}
				<div class="space-y-1">
					<label
						class="text-surface-700-300 text-xs font-semibold uppercase"
						for="editSummary-{binding.id}"
					>
						Summary
					</label>
					<textarea
						id="editSummary-{binding.id}"
						class="textarea min-h-16 text-sm"
						maxlength="200"
						placeholder="A short description of who this character is…"
						bind:value={editingSummary}
					></textarea>
					<p class="text-surface-500 text-xs">
						Shown to the AI as this character's current situation
						in the narrative graph context — even in scenes they
						don't appear in directly. Keeping it accurate helps
						the AI stay consistent about who they are right now.
					</p>
					<p class="text-surface-400 text-right text-xs">
						{editingSummary.length} / 200
					</p>
				</div>

				<div class="border-surface-300-700 space-y-3 border-t pt-3">
					<p
						class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
					>
						Status in world
					</p>
					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-1">
							<label
								class="text-surface-700-300 text-xs font-semibold uppercase"
								for="editState-{binding.id}"
							>
								State
							</label>
							<select
								id="editState-{binding.id}"
								class="select text-sm"
								bind:value={editingNodeState}
							>
								{#each NODE_STATES as s}
									<option value={s}>{s}</option>
								{/each}
							</select>
							<p class="text-surface-500 text-xs">
								Whether this character is alive and active in
								the story, or has died, gone missing, or
								departed. For your own tracking.
							</p>
						</div>
						<div class="space-y-1">
							<label
								class="text-surface-700-300 text-xs font-semibold uppercase"
								for="editVisibility-{binding.id}"
							>
								Visibility
							</label>
							<select
								id="editVisibility-{binding.id}"
								class="select text-sm"
								bind:value={editingNodeVisibility}
							>
								{#each NODE_VISIBILITY as v}
									<option value={v}>{v}</option>
								{/each}
							</select>
							<p class="text-surface-500 text-xs">
								Normal surfaces by relevance. Legendary always
								appears as a historical figure. Hidden is
								excluded from other characters' relationship
								context.
							</p>
						</div>
					</div>
				</div>

				<div class="flex items-center justify-between gap-2 pt-1">
					<button
						type="button"
						class="text-primary-500 flex items-center gap-1 text-xs hover:underline"
						onclick={() => onNavigateToGraph?.(binding.id)}
					>
						<Icons.Network size={12} /> View relationships
					</button>
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={cancelEditBinding}
						>
							Cancel
						</button>
						<button
							class="btn btn-sm preset-filled-primary-500"
							disabled={!isBound && !editingName.trim()}
							onclick={() => saveEditBinding(binding)}
						>
							<Icons.Save size={14} /> Save
						</button>
					</div>
				</div>
			</div>
		{:else}
			<div
				class="border-surface-300-700 flex items-center justify-between border-t pt-2 text-[11px]"
			>
				<span class="text-tertiary-600-400 font-mono">
					{binding.binding}
				</span>
				<div class="flex items-center gap-2">
					<span class="text-surface-400">{kindLabel}</span>
					{#if isBound}
						<button
							onclick={() => unlinkBinding(binding.id)}
							class="text-warning-600-400 hover:underline"
							title="Unlink — detaches the character/persona but keeps this row as a background character."
						>
							Unlink
						</button>
					{:else}
						<button
							onclick={() =>
								onClickLinkCharacterBinding(binding.id)}
							class="text-primary-500 hover:underline"
						>
							Link character
						</button>
						<button
							onclick={() =>
								onClickLinkPersonaBinding(binding.id)}
							class="text-primary-500 hover:underline"
						>
							Link persona
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<DeleteLorebookEntryConfirmModal
	open={showDeleteBindingModal}
	onOpenChange={(e) => {
		showDeleteBindingModal = e.open
		if (!e.open) deleteBindingTarget = null
	}}
	onConfirm={confirmDeleteBinding}
	onCancel={cancelDeleteBinding}
	title="Delete binding?"
	message={deleteBindingTarget?.characterId ||
	deleteBindingTarget?.personaId
		? "This will detach the linked character/persona from this lorebook and delete this binding, including any private character lore and graph relationships tied to it. This action cannot be undone."
		: "This will permanently delete this background character binding, including any private character lore and graph relationships tied to it. This action cannot be undone."}
/>

<!-- Link to existing bindings -->

<PersonaSelectModal
	open={showLinkPersonaBindingModal}
	onSelect={handleLinkPersonaBindingSelect}
	onOpenChange={() => (showLinkPersonaBindingModal = false)}
	personas={availableBindingPersonas}
	returnFullPersona={true}
/>
<CharacterSelectModal
	open={showLinkCharacterBindingModal}
	onSelect={handleLinkCharacterBindingSelect}
	onOpenChange={() => (showLinkCharacterBindingModal = false)}
	characters={availableBindingCharacters}
/>

<!-- Modals for adding new bindings -->

<PersonaSelectModal
	open={showAddPersonaBindingModal}
	onSelect={handleAddPersonaBindingSelect}
	onOpenChange={() => (showAddPersonaBindingModal = false)}
	personas={availableBindingPersonas}
	returnFullPersona={true}
/>

<CharacterSelectModal
	open={showAddCharacterBindingModal}
	onSelect={handleAddCharacterBindingSelect}
	onOpenChange={() => (showAddCharacterBindingModal = false)}
	characters={availableBindingCharacters}
/>
