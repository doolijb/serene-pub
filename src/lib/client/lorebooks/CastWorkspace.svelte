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
	import DeleteCastMemberModal from "./cast/DeleteCastMemberModal.svelte"
	import {
		castMaskedWarning,
		deletedMemberToast,
		fileCastAmendment,
		type PrivateLoreChoice
	} from "./cast/castSave"
	import {
		lineName,
		maskedFields,
		maskingAmendment
	} from "./editor/entrySave"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import CastMemberForm from "./cast/CastMemberForm.svelte"
	import PresencesPanel from "./cast/PresencesPanel.svelte"
	import CastRelationships from "./cast/CastRelationships.svelte"
	import {
		castHeaderLine,
		castReadInLine,
		castRowSentence,
		reviewLine
	} from "./cast/castRelationships"
	import { stateBadge, visibilityBadge } from "./cast/castVocabulary"
	import { changedFields } from "$lib/shared/lorebooks/amendments"
	import { formatDate } from "./sections/historyDates"
	import { parseMoment } from "./time/moment"
	import AmendmentList from "./time/AmendmentList.svelte"
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
		/**
		 * The book's cast overlays, as a function over rows.
		 *
		 * This board keeps its own copy of the members (its own socket
		 * conversation), so it is handed the RESOLVER rather than resolved
		 * rows — the same seam `EntryWorkspace` uses, for the same reason.
		 */
		resolveCast?: <T extends { id: number }>(rows: readonly T[]) => T[]
		/** One member's overlays, for their own account of them. */
		castAmendmentsFor?: (castId: number) => Sockets.Amendments.CastRow[]
		/** The moment being read. Absent is now, where a save is just a save. */
		moment?: string
		/**
		 * Every placement in the book, for the member page's own panel.
		 *
		 * ⚠ The whole book's, not this member's: the panel filters, and the
		 * hub already holds one copy that the World bar and the Lives lens
		 * read from. A second, narrower copy is a second source of truth.
		 */
		presences?: readonly Sockets.Amendments.Presence[]
		/** The line being read, for a placement written on it. NULL = main. */
		branchId?: number | null
		/** That line's name, for the sentence that says where it lands. */
		branchName?: string | null
	}

	let {
		lorebookId,
		mode,
		hasUnsavedChanges = $bindable(false),
		decisions = null,
		onViewRelationships,
		resolveCast,
		castAmendmentsFor,
		moment,
		presences = [],
		branchId = null,
		branchName = null
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
	/** The delete pre-check's counts for `deleteTarget`; null while asked. */
	let deleteCheck =
		$state<Sockets.NarrativeGraph.CheckNodeMergeReferences.Response | null>(
			null
		)
	let deleteCheckError = $state<string | null>(null)
	let deleting = $state(false)
	/**
	 * How the picker's card is written to `linkTargetId`: dated from the
	 * moment being read, or to the member outright (#115).
	 */
	let linkHow = $state<"amend" | "base">("base")

	let memberDirty = $state(false)
	let loreDraft = $state<Record<string, any> | null>(null)
	let loreDraftKey = $state<string | null>(null)
	/** The lore draft as it was BUILT — the other half of every diff. */
	let lorePristine = $state<Record<string, any> | null>(null)
	let creatingLore = $state(false)
	let awaitingSave = $state<string | null>(null)

	let inspectorTab = $state<"suggestions" | "duplicates">("suggestions")

	let route = $derived(loreRoute.route)
	/**
	 * The members as they READ at the moment, on the line being read.
	 *
	 * Everything below draws from this rather than from `castRows`: the list,
	 * the editor and the card. A member whose card was swapped at Y20 is a
	 * different person on screen before and after Y20, which is the whole
	 * point of the ruling.
	 */
	let resolvedCast = $derived.by(() => {
		const rows = resolveCast ? resolveCast(castRows) : castRows
		if (rows === castRows) return rows
		// ⚠ **Re-join the card when an overlay moved it.** `characterId` is a
		// column like any other, so the resolver swaps it happily — but the
		// list draws the NAME from the joined `character` object and the kind
		// from the id. Leaving the join behind would show the new card's kind
		// under the old card's name, which is worse than not resolving at all.
		return rows.map((row) => {
			const base = castRows.find((b) => b.id === row.id)
			if (!base || row.characterId === base.characterId) return row
			const card = characterList.find((c) => c.id === row.characterId)
			return { ...row, character: (card ?? null) as any }
		})
	})
	let pool = $derived(castPool(resolvedCast, loreEntries, search))
	let allMembers = $derived(castPool(resolvedCast, loreEntries).members)
	let selectedMember = $derived(
		route.castId != null
			? (allMembers.find((m) => m.id === route.castId) ?? null)
			: null
	)
	let selectedRow = $derived(
		selectedMember
			? (resolvedCast.find((r) => r.id === selectedMember.id) ?? null)
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

	let bindingsForEditor = $derived(resolvedCast as BindingWithRelations[])

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
		if (!lorePristine) return false
		return (
			JSON.stringify(lorePristine) !==
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
		lorePristine = loreDraft ? { ...$state.snapshot(loreDraft) } : null
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
		lorePristine = null
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
		lorePristine = { ...$state.snapshot(loreDraft) }
	}

	/**
	 * A refusal Layout's `:error` catch-all has already toasted is not toasted
	 * again; a reply that never came is said here, because nothing else will.
	 */
	function reportUnanswered(err: unknown, title: string) {
		if (isReplyTimeout(err))
			toaster.error({
				title,
				description:
					"The server did not answer in time. Your changes are still here."
			})
	}

	/** A lore write of ours is on its way; Save stands down meanwhile. */
	let loreSaving = $state(false)
	const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "")

	/**
	 * Character lore, saved the way the entry editor saves an entry.
	 *
	 * ⚠ A create keeps the draft until the row exists: a refusal or a lost
	 * reply must not throw the author's text away. An update writes only what
	 * changed (`changedFields` against the draft as built), and the toast
	 * waits for the server — the channel's own create/update echoes say
	 * nothing, so one save is one toast.
	 */
	async function saveLore() {
		if (!loreDraft || loreSaving) return
		if (!CHARACTER_LORE_DOOR.validate(loreDraft, loreEntries, true)) return
		const payload = $state.snapshot(loreDraft) as Record<string, any>
		if (creatingLore) {
			// ⚠ Lore created while reading a line belongs to that line, as a
			// new entry does in the entry editor.
			if (branchId != null) payload.branchId = branchId
			awaitingSave = "new"
			loreSaving = true
			let created: Sockets.Entries.Create.Response
			try {
				created = await awaitReply({
					socket,
					event: "entries:create",
					params: {
						entry: {
							...payload,
							typeId: CHARACTER_LORE_TYPE_ID,
							lorebookId
						} as any
					},
					replyKey: interestKey("entries:create", lorebookId),
					errorEvent: "entries:create:error",
					fallbackError: "The lore could not be created.",
					match: (data) =>
						data.entry?.lorebookId === lorebookId &&
						data.entry.typeId === CHARACTER_LORE_TYPE_ID &&
						trimmed(data.entry.name) === trimmed(payload.name) &&
						trimmed(data.entry.content) === trimmed(payload.content)
				})
			} catch (err) {
				loreSaving = false
				if (awaitingSave === "new") awaitingSave = null
				reportUnanswered(err, "Character lore was not created")
				return
			}
			loreSaving = false
			toaster.success({ title: "Character lore created" })
			// Still the create the author sent? Then open what it became.
			if (awaitingSave !== "new") return
			awaitingSave = null
			if (!creatingLore || loreDraftKey !== "new") return
			discardLoreDraft()
			void loreRoute.navigate({
				type: "openEntry",
				entryId: created.entry.id
			})
			return
		}
		const id = payload.id as number
		const fields = changedFields(payload, lorePristine ?? {})
		if (!Object.keys(fields).length) {
			toaster.error({ title: "Nothing has changed" })
			return
		}
		const key = `entry#${id}`
		awaitingSave = key
		loreSaving = true
		try {
			await awaitReply({
				socket,
				event: "entries:update",
				params: {
					entry: { ...fields, id, typeId: CHARACTER_LORE_TYPE_ID } as any
				},
				replyKey: interestKey("entries:update", lorebookId),
				errorEvent: "entries:update:error",
				fallbackError: "The lore could not be saved.",
				match: (data) => data.entry?.id === id
			})
		} catch (err) {
			loreSaving = false
			if (awaitingSave === key) awaitingSave = null
			reportUnanswered(err, "Character lore was not saved")
			return
		}
		loreSaving = false
		// The draft itself is settled by the channel's `onUpdated`, which
		// hears the same reply; this only says how it went.
		toaster.success({ title: "Character lore saved" })
	}

	/**
	 * The date being read, when one is. `null` is now.
	 *
	 * At now there is no choice to offer: every dated amendment already
	 * applies, so "from now on" and "change the member" are one sentence.
	 */
	let momentDate = $derived(parseMoment(moment))

	/** Every overlay id this board has seen for a member, for `isOurCastAmendment`. */
	function knownCastAmendmentIds(castId: number): number[] {
		return (castAmendmentsFor?.(castId) ?? []).map((a) => a.id)
	}

	/**
	 * The warning a base write earns when an amendment still overrides part
	 * of it (#113), or null. Asked of the SAME resolver the list reads
	 * through: the base as it will be after this write, resolved at the
	 * moment being read — any field that still comes out different is one
	 * the author will not see change. Warn only (ruled default).
	 */
	function baseSaveWarning(castId: number, fields: Record<string, unknown>) {
		if (!resolveCast) return null
		const base = castRows.find((r) => r.id === castId)
		if (!base) return null
		const [row] = resolveCast([{ ...base, ...fields } as CastRow])
		if (!row) return null
		const resolved = row as unknown as Record<string, unknown>
		const masked = maskedFields(fields, resolved)
		if (!masked.length) return null
		const overlays = castAmendmentsFor?.(castId) ?? []
		return castMaskedWarning(
			masked.map((field) => ({
				field,
				amendment: maskingAmendment(
					field,
					resolved[field],
					overlays,
					branchId,
					momentDate
				)
			}))
		)
	}

	/**
	 * Write to the member outright — on every line, at every date — and wait
	 * for the server before saying so.
	 */
	async function writeBase(
		castId: number,
		fields: Record<string, unknown>,
		title: string,
		failTitle: string
	): Promise<boolean> {
		const warning = baseSaveWarning(castId, fields)
		try {
			await awaitReply({
				socket,
				event: "lorebooks:updateBinding",
				params: {
					lorebookBinding: { id: castId, ...fields }
				} as Sockets.Lorebooks.UpdateBinding.Params,
				errorEvent: "lorebooks:updateBinding:error",
				fallbackError: "The cast member could not be saved.",
				match: (data) => data.lorebookBinding?.id === castId
			})
		} catch (err) {
			reportUnanswered(err, failTitle)
			return false
		}
		if (warning) toaster.warning(warning)
		else toaster.success({ title })
		return true
	}

	/**
	 * File a change to a member dated from the moment being read, ON THE LINE
	 * BEING READ (#105) — a fork's change must not land on main.
	 */
	async function writeAmendment(
		castId: number,
		fields: Record<string, unknown>,
		what: string
	): Promise<boolean> {
		if (!momentDate) return false
		const date = momentDate
		let reply: Sockets.Amendments.List.Response
		try {
			reply = await fileCastAmendment(
				socket,
				{ lorebookId, castId, branchId },
				{ ...date, fields },
				knownCastAmendmentIds(castId)
			)
		} catch (err) {
			reportUnanswered(err, "The amendment was not saved")
			return false
		}
		const line = lineName(reply, branchId)
		toaster.success({
			title: `${what} as of ${formatDate(date)}${line ? ` on ${line}` : ""}`
		})
		return true
	}

	/**
	 * What the author changed: the form's draft against the draft as it was
	 * BUILT (#106), never against the row as it reads now — the row may have
	 * moved with the moment since, and a diff against it would write values
	 * the author never touched.
	 */
	function memberDiff(
		patch: Record<string, unknown>,
		pristine: Record<string, unknown>
	): Record<string, unknown> | null {
		const fields = changedFields(patch, pristine)
		if (!Object.keys(fields).length) {
			toaster.error({ title: "Nothing has changed" })
			return null
		}
		return fields
	}

	async function saveMember(
		patch: Record<string, unknown>,
		pristine: Record<string, unknown>
	): Promise<boolean> {
		if (!selectedMember) return false
		const fields = memberDiff(patch, pristine)
		if (!fields) return false
		return writeBase(
			selectedMember.id,
			fields,
			"Cast member saved",
			"The cast member was not saved"
		)
	}

	async function amendMember(
		patch: Record<string, unknown>,
		pristine: Record<string, unknown>
	): Promise<boolean> {
		if (!selectedMember || !momentDate) return false
		const fields = memberDiff(patch, pristine)
		if (!fields) return false
		return writeAmendment(selectedMember.id, fields, "Amended")
	}

	/**
	 * Open the delete dialog and ask the server how much private lore the
	 * member anchors — the dialog's question depends on it (ruling 4).
	 */
	async function requestDelete(member: CastMember) {
		deleteTarget = member
		deleteCheck = null
		deleteCheckError = null
		try {
			// The reply names the member it counted, so another dialog's
			// question (the graph lens asks it too) cannot answer this one.
			const res = await awaitReply({
				socket,
				event: "narrativeGraph:checkNodeMergeReferences",
				params: { nodeId: member.id },
				errorEvent: "narrativeGraph:checkNodeMergeReferences:error",
				fallbackError: "The server could not count it.",
				match: (data) => data.nodeId === member.id
			})
			if (deleteTarget?.id === member.id) deleteCheck = res
		} catch (err) {
			if (deleteTarget?.id === member.id)
				deleteCheckError =
					err instanceof Error ? err.message : String(err)
		}
	}

	function cancelDelete() {
		if (deleting) return
		deleteTarget = null
		deleteCheck = null
		deleteCheckError = null
	}

	async function confirmDeleteMember(privateLore: PrivateLoreChoice) {
		const target = deleteTarget
		if (!target || deleting) return
		deleting = true
		let res: Sockets.NarrativeGraph.DeleteNode.Response
		try {
			// A cast member IS the graph's node for that person, so one delete
			// removes both; there is no second row to clean up.
			res = await awaitReply({
				socket,
				event: "narrativeGraph:deleteNode",
				params: { id: target.id, privateLore },
				errorEvent: "narrativeGraph:deleteNode:error",
				fallbackError: "The cast member could not be deleted.",
				match: (data) => data.id === target.id
			})
		} catch (err) {
			deleting = false
			reportUnanswered(err, `${target.name} was not deleted`)
			return
		}
		deleting = false
		deleteTarget = null
		deleteCheck = null
		toaster.success({
			title: deletedMemberToast(target.name, res.deletedLoreCount)
		})
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

	/**
	 * The picker's card: a new member, or which card an existing one is
	 * drawn with — dated from the moment being read, or outright (#115).
	 */
	async function pickCharacter(character: { id: number }) {
		characterPickerOpen = false
		const target = linkTargetId
		const how = linkHow
		linkTargetId = null
		linkHow = "base"
		if (target == null) {
			socket.emit("lorebooks:createBinding", {
				lorebookBinding: {
					lorebookId,
					characterId: character.id,
					binding: ""
				}
			} satisfies Sockets.Lorebooks.CreateBinding.Params)
			return
		}
		const fields = { characterId: character.id }
		if (how === "amend" && momentDate)
			await writeAmendment(target, fields, "Card changed")
		else
			await writeBase(
				target,
				fields,
				"Card changed",
				"The card was not changed"
			)
	}

	/** Detach the card — dated from the moment, or outright (#115). */
	async function unlink(id: number, how: "amend" | "base") {
		const fields = { characterId: null }
		if (how === "amend" && momentDate)
			await writeAmendment(id, fields, "Card unlinked")
		else
			await writeBase(
				id,
				fields,
				"Card unlinked",
				"The card was not unlinked"
			)
	}

	/**
	 * Cards the picker offers: none another member is stored with (the base
	 * allows one member per card) and none a member already READS as at this
	 * moment, so the member's own current card is not offered back.
	 */
	let unlinkedCharacters = $derived(
		characterList.filter(
			(c) =>
				!castRows.some((r) => r.characterId === c.id) &&
				!resolvedCast.some((r) => r.characterId === c.id)
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

	/**
	 * No toast: the write that asked says how it went (`writeBase`), and a
	 * write from another tab or lens is not this board's news.
	 */
	function handleUpdateBinding() {
		socket.emit("lorebooks:bindingList", { lorebookId })
	}

	/**
	 * A member went — from here or from the graph lens. Their lore went with
	 * them or is now anchored to nobody, so the lore list is re-read too.
	 */
	function handleDeleteNode(msg: Sockets.NarrativeGraph.DeleteNode.Response) {
		if (msg.lorebookId != null && msg.lorebookId !== lorebookId) return
		socket.emit("lorebooks:bindingList", { lorebookId })
		channel?.list()
	}

	function handleMergeWrite() {
		socket.emit("lorebooks:bindingList", { lorebookId })
		refreshGraph()
	}

	function handleGraphList(msg: Sockets.NarrativeGraph.List.Response) {
		// The scope the gate reads; checked here too, so a stale book's
		// reply arriving after a switch cannot paint this one.
		if (msg.lorebookId !== lorebookId) return
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
				// No create/update toasts here: `saveLore` says how its own
				// write went, and an echo of another tab's is not news.
				onUpdated(entry) {
					const key = `entry#${entry.id}`
					if (awaitingSave !== key) return
					awaitingSave = null
					// The server re-joins keywords, so the draft and the row
					// are only the same text once the saved row is back.
					if (loreDraftKey === key) {
						loreDraft = CHARACTER_LORE_DOOR.toDraft(entry)
						lorePristine = { ...$state.snapshot(loreDraft) }
					}
				},
				onDeleted: (_id, askedHere) => {
					if (askedHere)
						toaster.success({ title: "Character lore deleted" })
				}
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
			class="btn btn-sm preset-filled-primary-500 shrink-0 gap-1"
			title="Add to the cast"
		>
			<Icons.Plus size={14} aria-hidden="true" />
			<span class="hidden @lg/view:inline">New</span>
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
					placeholder="e.g. The innkeeper"
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
						class="text-surface-600-400 animate-spin"
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
										.color} shrink-0 text-[11px]"
								>
									{member.state}
								</span>
							{/if}
							{#if member.visibility !== "normal"}
								<span
									class="badge {visibilityBadge(
										member.visibility
									)} shrink-0 text-[11px]"
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
					class="btn btn-sm preset-filled-primary-500 shrink-0"
					type="button"
					onclick={saveLore}
					disabled={loreSaving || !CHARACTER_LORE_DOOR.validate(
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
				onAmend={momentDate ? amendMember : undefined}
				momentLabel={momentDate ? formatDate(momentDate) : null}
				onDelete={() => void requestDelete(selectedMember!)}
				onUnlink={(how) => void unlink(selectedMember!.id, how)}
				onLinkCharacter={(how) => {
					linkTargetId = selectedMember!.id
					linkHow = how
					characterPickerOpen = true
				}}
			/>

			<PresencesPanel
				{lorebookId}
				castId={selectedMember.id}
				memberName={selectedMember.name}
				{presences}
				{branchId}
				{branchName}
				{moment}
			/>

			{#if castAmendmentsFor}
				<AmendmentList
					{lorebookId}
					amendments={castAmendmentsFor(selectedMember.id)}
					{moment}
					subject="cast"
				/>
			{/if}

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
						class="btn btn-sm preset-filled-primary-500 shrink-0"
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
					? 'preset-tonal-primary'
					: 'preset-tonal-surface'}"
				aria-pressed={inspectorTab === "suggestions"}
				onclick={() => (inspectorTab = "suggestions")}
			>
				Suggestions
			</button>
			<button
				type="button"
				class="btn btn-sm {inspectorTab === 'duplicates'
					? 'preset-tonal-primary'
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
			<!-- No review panel here: it acts on the cast as a whole, not
			     on the member open (#112). It sits under the roster. -->
			{#if loreDraft}
				{@render loreEditor()}
			{:else}
				{@render memberPage()}
			{/if}
		</div>
	{:else}
		<!-- Compact: suggestions and duplicates listed under the roster, so
		     reviewing them never means opening an unrelated member (#112). -->
		<div class="flex min-h-0 flex-1 flex-col gap-3">
			{@render castList()}
			<div class="flex max-h-[45%] shrink-0 flex-col overflow-y-auto">
				{@render inspector()}
			</div>
		</div>
	{/if}
</div>

<DeleteCastMemberModal
	open={deleteTarget !== null}
	name={deleteTarget?.name ?? ""}
	linked={deleteTarget?.linked ?? false}
	relationshipCount={deleteTarget
		? (edgeCounts.get(deleteTarget.id) ?? 0)
		: 0}
	check={deleteCheck}
	checkError={deleteCheckError}
	busy={deleting}
	onConfirm={confirmDeleteMember}
	onCancel={cancelDelete}
/>

<CharacterSelectModal
	open={characterPickerOpen}
	onSelect={pickCharacter}
	onOpenChange={() => {
		characterPickerOpen = false
		linkTargetId = null
		linkHow = "base"
	}}
	characters={unlinkedCharacters}
/>
