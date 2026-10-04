<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext, onDestroy, onMount, untrack } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import PanelToolbar from "$lib/client/components/panels/PanelToolbar.svelte"
	import PipelineConfigOptions from "$lib/client/components/pipelines/PipelineConfigOptions.svelte"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import GraphBuildModal from "$lib/client/components/modals/GraphBuildModal.svelte"
	import AbsorbBindingModal from "$lib/client/components/modals/AbsorbBindingModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import DeleteCastMemberModal from "./cast/DeleteCastMemberModal.svelte"
	import { deletedMemberToast, type PrivateLoreChoice } from "./cast/castSave"
	import {
		ENTRY_TYPE_IDS,
		HISTORY_TYPE_ID,
		LOCATION_TYPE_ID
	} from "$lib/shared/entries/types"
	import { extendCountsOf } from "$lib/shared/lorebooks/graphBuildScope"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { formatDate } from "./sections/historyDates"
	import { openBookTime } from "./time/bookTime.svelte"
	import LinkForm from "./graphs/LinkForm.svelte"
	import NodePanel from "./graphs/NodePanel.svelte"
	import RelationshipFields from "./graphs/RelationshipFields.svelte"
	import { getBookRelationships } from "./relationships.svelte"
	import { getBookData } from "./bookData.svelte"
	import RelationshipsCanvas from "./graphs/RelationshipsCanvas.svelte"
	import NewPlaceField from "./places/NewPlaceField.svelte"
	import { linkFieldsDiffer, placeLinkFields } from "./places/placeLinks"
	import {
		buildPlaceGraph,
		linkCandidates as linkCandidatesOf,
		newPlaceEntry,
		placeGraphHeadline,
		relationshipsOfPlaces,
		placeNode,
		type LoreRowLike,
		type PlaceRowLike
	} from "./places/placeGraph"
	import {
		edgesAtMoment,
		edgesOnLine,
		type DatedEntryLike
	} from "./graphs/asOf"
	import {
		castKey,
		ceilingFactsFrom,
		ceilingLine,
		entriesWithLinks,
		entryKey,
		graphEdges,
		graphHeaderLine,
		graphNodes,
		nodeNames,
		panelEdges,
		sideColumnView,
		type CeilingFacts,
		type GraphEdge,
		type GraphNode
	} from "./graphs/graphModel"
	import {
		createLinkParams,
		linkDraftChanged,
		newLinkDraft,
		relationshipFieldsProblem,
		updateLinkParams,
		whenAtMoment,
		whenOptions,
		type LinkDraft
	} from "./graphs/linkDraft"
	import {
		linkPairingOf,
		relationshipEndRef,
		relationshipSentence,
		type RelationshipEndRef
	} from "$lib/shared/lorebooks/linkVocabulary"
	import {
		edgedCastPairs,
		notDrawnSentence,
		scenesNamingNone,
		unnamedPairsFor
	} from "./graphs/sceneGaps"
	import { loreRoute } from "./loreRoute.svelte"
	import { graphBuildReason, type LoreDrawing } from "./graphs"
	import { lensEmptyMessage } from "./lenses/registry"
	import {
		SCOPE_KIND,
		SCOPE_LABELS,
		reduce,
		type LoreScope
	} from "$lib/shared/lorebooks/loreRoute"
	import { stateBadge, visibilityBadge } from "./cast/castVocabulary"
	import { momentDate, momentLabel } from "./time/moment"

	/**
	 * The drawings the lorebook can make, over the scope being read.
	 *
	 * Which drawing is on screen is the lens, so the rail's lens row is this
	 * place's navigation: the canvas takes the width the list and editor
	 * columns would have had, and the column beside it is whatever is selected
	 * on the canvas.
	 */
	type NarrativeNode = Sockets.NarrativeGraph.NarrativeNode
	type NarrativeRelationship = Sockets.NarrativeGraph.NarrativeRelationship
	type SceneRow = Sockets.Scenes.SceneWithMeta

	interface Props {
		lorebookId: number
		mode: "desk" | "compact"
		/** Which canvas the lens asks for. */
		drawing: LoreDrawing
		/**
		 * What the attached session's newest run did with the graph, or null
		 * when no run reported on it. The ceiling line's only source.
		 */
		relationships?:
			| Sockets.Entries.RecentDecisions.Response["relationships"]
			| null
		hasUnsavedChanges: boolean
		/** Opens Cast on a member. */
		onEditMember: (castId: number) => void
	}

	let {
		lorebookId,
		mode,
		drawing,
		relationships: runRelationships = null,
		hasUnsavedChanges = $bindable(false),
		onEditMember
	}: Props = $props()

	const socket = useTypedSocket()
	const graphBuildsCtx: GraphBuildsCtx = getContext("graphBuildsCtx")
	const userCtx: { user?: SelectUser } = getContext("userCtx")
	/**
	 * The session open beside the workspace, when there is one. "Extend from
	 * this session" reads that session's scenes alone (#51), so it is only
	 * offered when the open session is the one reading this book.
	 */
	const openSessionCtx: OpenSessionCtx | undefined =
		getContext("openSessionCtx")

	/** The build runs on this pipeline's per-step config. */
	const GRAPH_PIPELINE_SLUG = "core:spec/graph-build"

	/**
	 * The kinds that can be a node or a date on an edge: every declared entry
	 * type, so the Items scope has its items (#117).
	 */
	const ENTRY_KINDS = ENTRY_TYPE_IDS

	/**
	 * The book, as the workspace holds it (plan B4): this lens asks for
	 * nothing on mount and keeps no copy. Its rows are the workspace's
	 * RESOLVED ones — every drawing, not only Places, names an entry as it
	 * reads at the moment (the graph lens drew stored names beside Places'
	 * amended ones).
	 */
	const book = getBookData()

	const REL_STATUS_BADGE: Record<string, string> = {
		active: "preset-tonal-success",
		resolved: "preset-tonal-surface",
		broken: "preset-tonal-error",
		evolved: "preset-tonal-warning"
	}

	/**
	 * The book's relationships and the cast rows they name — the workspace's
	 * one store (plan places-graph B3), which the References panel reads too.
	 * It owns the read, the three relationship pushes, and what a failed or
	 * silent read says; this lens reads it and writes through it.
	 */
	const rels = getBookRelationships()
	let nodes = $derived(rels.nodes)
	let relationships = $derived(rels.all)
	/** Every scene of the book on every line (a session's Extend count). */
	let scenes = $derived(book.allScenes as unknown as SceneRow[])
	/** The resolved rows the Places lens draws from. */
	let resolvedEntries = $derived(book.rows as Record<string, readonly unknown[]>)
	/**
	 * Why the graph is not on screen, when it is not: a refused read or a
	 * silent one (the store's clock), never a spinner left turning.
	 */
	let loadError = $derived(rels.error)
	let isLoading = $derived(!rels.loaded)

	// Main's build counts: what Rebuild, and Extend graph on main, read.
	let ungraphedSceneCount = $state(0)
	let ungraphedUnsummarizedCount = $state(0)
	let totalSummarizedCount = $state(0)
	let ungraphedHistoryEntryCount = $state(0)
	let unresolvedCastSceneCount = $state(0)
	let namelessBindingCount = $state(0)
	let totalDirectHistoryEntryCount = $state(0)
	/** Each branch's own build counts: what Extend graph on it reads. */
	let branchCounts = $state<
		Sockets.NarrativeGraph.List.Response["branchCounts"]
	>([])
	/** What a Rebuild would delete — the confirmation warns with it. */
	let relationshipCounts = $derived(rels.counts)

	/**
	 * Nothing shuts the build: summarizing is a capability every instance has.
	 * The seam stays on these two buttons, where a future gate would sit.
	 */
	let buildReason = $derived(graphBuildReason())

	let showBuildModal = $state(false)
	let buildMode = $state<"replace" | "extend">("replace")
	let showPipelinePanel = $state(false)
	let pipelineOverview = $state<Sockets.Pipelines.NamespaceDetail | null>(
		null
	)

	/**
	 * The relationship open beside the canvas, by id: read through the store,
	 * so an edit from anywhere shows here and a delete closes it.
	 */
	let selectedRelId = $state<number | null>(null)
	let selectedRel = $derived<NarrativeRelationship | null>(
		selectedRelId === null ? null : (rels.get(selectedRelId) ?? null)
	)
	let editingRel = $state<NarrativeRelationship | null>(null)
	/**
	 * The stored fields the open edit started from (PlaceLinks' rule, plan
	 * B7). An edit made elsewhere — another tab, a place's Links row — moves
	 * the store's row away from them: with nothing typed here the form
	 * follows it; with something typed it says so, rather than a Save
	 * quietly putting the old values back.
	 */
	let editingFrom = $state<ReturnType<typeof placeLinkFields> | null>(null)
	let relStaleNote = $state(false)
	/**
	 * The open relationship's delete is waiting on a second press. A delete
	 * is permanent, so the first press only asks.
	 */
	let confirmingRelDelete = $state<number | null>(null)
	/** A relationship edit is on its way; only the edit form reads it. */
	let isSaving = $state(false)
	/** Why the last relationship edit failed, said in the form. */
	let relError = $state<string | null>(null)

	/**
	 * Edges this session made, by id.
	 *
	 * ⚠ `SvelteSet`, not `$state(new Set())` — a plain Set in `$state` does not
	 * make `.add()`/`.delete()` reactive, so a Keep would never clear the mark.
	 */
	const newEdgeIds = new SvelteSet<number>()
	/** The ids standing before an apply, so the reload can name what arrived. */
	let appliedBaseline: Set<number> | null = null

	let linkDraft = $state<LinkDraft | null>(null)
	/**
	 * The new link's form as it opened: touched, it is an unsaved change and
	 * leaving it asks first (plan B7 — it never counted before).
	 */
	let linkDraftFrom = $state<LinkDraft | null>(null)
	/**
	 * Each draft is its own form: a new drag or pick remounts it, so what the
	 * last one was doing (making a place) does not carry over.
	 */
	let linkFormKey = $state(0)
	/** The draft was opened for New place…, holding what had been typed. */
	let linkNewPlace = $state<{ name: string } | null>(null)
	/** The Places lens's toolbar is making a place. */
	let newPlaceOpen = $state(false)
	let isConnecting = $state(false)
	/** Why the last Name it failed, said in the link form. */
	let linkError = $state<string | null>(null)
	/**
	 * Which create/edit is the live one. A reply to an attempt the form has
	 * since been cancelled or restarted past must not close the new one.
	 */
	let linkAttempt = 0
	let relAttempt = 0

	/**
	 * The member whose delete is being asked about. The same dialog and flow
	 * Cast uses, so the graph lens asks about their private lore too (owner
	 * ruling 4) rather than deleting past the question.
	 */
	let deleteTarget = $state<NarrativeNode | null>(null)
	let deleteCheck =
		$state<Sockets.NarrativeGraph.CheckNodeMergeReferences.Response | null>(
			null
		)
	let deleteCheckError = $state<string | null>(null)
	let deleting = $state(false)

	let mergeTarget = $state<NarrativeNode | null>(null)
	let showMergeModal = $state(false)

	/** Compact has no room for both, so the canvas is a screen of its own. */
	let canvasOpen = $state(false)

	let route = $derived(loreRoute.route)

	/**
	 * The line being read, with its ancestor chain (owner ruling 5) — the
	 * one rule the pool, the counts and the server read by.
	 */
	let line = $derived(openBookTime.lineOf(route.branch ?? null))

	/**
	 * The entries this line reads, archived ones left out (the pool's and the
	 * rail's rule) — the workspace's resolved rows, already cut to the line
	 * (a shared row dated after a fork is not a branch's) and read as of the
	 * moment, so an amended name or a dated archive draws here too.
	 */
	let lineEntriesByKind = $derived.by(() => {
		const out: Record<string, any[]> = {}
		for (const [kind, rows] of Object.entries(book.rows))
			out[kind] = (rows as any[]).filter((r) => !r.archived)
		return out
	})

	/** Every history entry the book holds, as stored — what dates any link. */
	let allHistoryEntries = $derived(
		(book.rawRows[HISTORY_TYPE_ID] ?? []) as unknown as DatedEntryLike[]
	)
	/** The history entries on this line — what a link here can be dated by. */
	let historyEntries = $derived(
		(lineEntriesByKind[HISTORY_TYPE_ID] ?? []) as (DatedEntryLike & {
			name?: string | null
		})[]
	)

	/** The When picker's options, spelled through the book's calendar. */
	let linkWhenOptions = $derived(
		whenOptions(historyEntries, (d) => formatDate(d))
	)

	/**
	 * The links this line reads (#124): its own, its ancestors' up to each
	 * fork, never a sibling's.
	 */
	let lineRelationships = $derived(
		edgesOnLine(relationships, line, allHistoryEntries)
	)
	let lineScenes = $derived(book.scenes as unknown as SceneRow[])

	/**
	 * The entries the scope holds.
	 *
	 * A scope that narrows to one entry kind narrows the graph's denominator
	 * with it; a scope that is the whole pool, or that narrows to rows which are
	 * not entries at all, leaves every kind in.
	 */
	let scopeKinds = $derived.by(() => {
		const kind = SCOPE_KIND[route.scope]
		return kind && (ENTRY_KINDS as readonly string[]).includes(kind)
			? [kind]
			: [...ENTRY_KINDS]
	})

	let scopeEntries = $derived.by(() => {
		const out: { id: number; name: string }[] = []
		for (const kind of scopeKinds)
			for (const row of lineEntriesByKind[kind] ?? [])
				out.push({ id: row.id, name: (row.name ?? "").trim() })
		return out
	})

	/**
	 * Alias rows fold into the parent they were absorbed into. Each member
	 * as they read at the moment, on the line — the workspace's cast
	 * resolver, so a dated rename draws on the canvas as it does on Cast.
	 */
	let parentNodes = $derived(
		book.resolveCast(nodes.filter((n) => !n.parentNodeId))
	)

	let visibleRelationships = $derived(
		edgesAtMoment(lineRelationships, route.moment, allHistoryEntries)
	)

	let selectedKey = $derived<string | null>(
		route.castId != null
			? castKey(route.castId)
			: route.entryId != null
				? entryKey(route.entryId)
				: null
	)

	/**
	 * The Places lens: the book's places, resolved, and the category chip
	 * narrowing them (plan places-graph B4). A chip whose category has gone
	 * reads as none.
	 */
	let placeRows = $derived(
		(resolvedEntries[LOCATION_TYPE_ID] ?? []) as PlaceRowLike[]
	)
	let otherEntryRows = $derived(
		Object.entries(resolvedEntries)
			.filter(([typeId]) => typeId !== LOCATION_TYPE_ID)
			.flatMap(([, rows]) => rows) as LoreRowLike[]
	)
	let placeCategoryChip = $state<string | null>(null)
	let places = $derived(
		buildPlaceGraph({
			places: placeRows,
			otherEntries: otherEntryRows,
			cast: parentNodes,
			relationships: visibleRelationships,
			category: placeCategoryChip,
			newIds: newEdgeIds
		})
	)
	let placeCategory = $derived(places.category)

	/** Links the moment holds back — on the Places lens, a place's only. */
	let heldBack = $derived(
		drawing === "places"
			? relationshipsOfPlaces(lineRelationships, places.placeIds).length -
					relationshipsOfPlaces(visibleRelationships, places.placeIds).length
			: lineRelationships.length - visibleRelationships.length
	)

	/** The nodes on the canvas: the whole web, or the places. */
	let graph = $derived(
		drawing === "places"
			? places.nodes
			: graphNodes({
					cast: parentNodes,
					relationships: visibleRelationships,
					scopeEntries,
					selectedKey
				})
	)
	let nodeKeys = $derived(new Set(graph.map((n) => n.key)))
	let edges = $derived(
		drawing === "places"
			? places.edges
			: graphEdges(visibleRelationships, nodeKeys, newEdgeIds)
	)
	/**
	 * What a new link's far end may be: the canvas, and every place on the
	 * line — one the category chip hides included. The Places map draws only
	 * the members already joined to a place, so it offers the whole cast too:
	 * a place's first keeper is picked here, not drawn elsewhere first.
	 */
	let castCandidates = $derived(
		drawing === "places"
			? graphNodes({ cast: parentNodes, relationships: [], scopeEntries: [] })
			: []
	)
	let linkCandidates = $derived(
		linkCandidatesOf(graph, placeRows, castCandidates)
	)
	let names = $derived(nodeNames(graph))
	let selectedNode = $derived(
		selectedKey ? (graph.find((n) => n.key === selectedKey) ?? null) : null
	)
	let panelRows = $derived(panelEdges(selectedKey, edges, names))

	/**
	 * The open relationship said from each of its ends, through the one
	 * sentence builder — "The rusted iron door leads north to the Drowned
	 * Hall." from one side, "…leads south to the Guardroom." from the other.
	 * Only with an entry at an end: a cast tie's other side is its own
	 * perspective row, not a way back.
	 */
	let selectedSentences = $derived.by(() => {
		const rel = selectedRel
		if (!rel || (rel.from.kind === "cast" && rel.to.kind === "cast"))
			return []
		const nameOf = (end: RelationshipEndRef) =>
			names.get(end.kind === "cast" ? castKey(end.id) : entryKey(end.id)) ??
			`#${end.id}`
		return [rel.from, rel.to].map((end) => {
			const subject = relationshipEndRef(end)
			return {
				key: `${subject.kind}#${subject.id}`,
				subject: nameOf(subject),
				sentence: relationshipSentence(rel, subject, nameOf)
			}
		})
	})

	/**
	 * What the column beside the canvas shows (`sideColumnView`). The graph
	 * lists its nodes there; beside the Places lens the column appears only
	 * for something picked — a place, a link, a link being named (#122) — so
	 * the map keeps the width. A link picked from a selected place's panel,
	 * or on the canvas while a place is selected, shows over the place.
	 */
	let sideView = $derived(
		sideColumnView({
			drawing,
			linking: linkDraft !== null,
			relationshipOpen: selectedRel !== null,
			nodeOpen: selectedNode !== null
		})
	)
	let hasSideColumn = $derived(sideView !== null)

	/**
	 * Another node picked by anything but a click here — the address, Back,
	 * a member deleted — lets go of the link open beside the last one, which
	 * would otherwise stand over the new node's panel. A click goes through
	 * `selectNode`, which lets go itself.
	 */
	let heldKey: string | null = null
	$effect(() => {
		const key = selectedKey
		untrack(() => {
			if (key === heldKey) return
			heldKey = key
			if (selectedRelId === null) return
			selectedRelId = null
			confirmingRelDelete = null
			resetRelForm()
		})
	})

	let edgedPairs = $derived(edgedCastPairs(lineRelationships))
	let scenesWithNothingNamed = $derived(
		scenesNamingNone(lineScenes, edgedPairs)
	)

	/** Scenes the open member was in that the graph names nothing about. */
	let notDrawn = $derived.by(() => {
		if (selectedNode?.kind !== "cast") return []
		return unnamedPairsFor(selectedNode.id, lineScenes, edgedPairs).map(
			(pair) => ({
				otherId: pair.otherId,
				sceneIds: pair.sceneIds,
				sentence: notDrawnSentence(
					selectedNode!.name,
					names.get(castKey(pair.otherId)) ?? `#${pair.otherId}`,
					pair.sceneIds.length
				)
			})
		)
	})

	let headline = $derived(
		drawing === "places"
			? placeGraphHeadline(places, placeCategory)
			: graphHeaderLine({
			scopeLabel: SCOPE_LABELS[route.scope],
			entriesWithLinks: entriesWithLinks(
				scopeEntries,
				visibleRelationships
			),
			entriesTotal: scopeEntries.length,
			linkCount: edges.length,
			scenesNamingNone: scenesWithNothingNamed
		})
	)


	/**
	 * What the last turn sent of the graph it walked.
	 *
	 * ⚠ The RUN's figures, not this member's: the mechanism walks the whole
	 * graph under one ceiling, so the line says what the turn sent rather than
	 * what the selected node holds. A run that reported nothing gets no line.
	 */
	let ceilingFacts = $derived<CeilingFacts>(
		ceilingFactsFrom(runRelationships)
	)
	let ceiling = $derived(ceilingLine(ceilingFacts))

	/** This book's build — never another book's newer one (plan B8). */
	let activeBuild = $derived(graphBuildsCtx?.buildFor(lorebookId) ?? null)
	/**
	 * The session an Extend reads, or null for the whole line: the open
	 * session, when it reads this book on the line being read (#51). Reading
	 * another line, Extend graph builds that line (plan A3 review).
	 */
	let extendSessionId = $derived(
		openSessionCtx?.sessionId != null &&
			openSessionCtx.lorebookId === lorebookId &&
			(openSessionCtx.lorebookBranchId ?? null) === line.branchId
			? openSessionCtx.sessionId
			: null
	)
	/**
	 * That session's scenes on its line the graph has not read, by the
	 * build's own rule (`extendCountsOf`).
	 */
	let sessionUngraphed = $derived(
		extendSessionId === null
			? { ready: 0, unsummarized: 0, unresolvedCast: 0 }
			: extendCountsOf(scenes, {
					branchId: line.branchId,
					sessionId: extendSessionId
				})
	)
	/** What Extend graph on the line being read reads: its own, counted by the server. */
	let lineCounts = $derived.by(() => {
		if (line.branchId === null)
			return {
				ungraphedSceneCount,
				ungraphedUnsummarizedCount,
				ungraphedHistoryEntryCount,
				unresolvedCastSceneCount
			}
		const own = branchCounts.find((c) => c.branchId === line.branchId)
		return {
			ungraphedSceneCount: own?.ungraphedSceneCount ?? 0,
			ungraphedUnsummarizedCount: own?.ungraphedUnsummarizedCount ?? 0,
			ungraphedHistoryEntryCount: own?.ungraphedHistoryEntryCount ?? 0,
			unresolvedCastSceneCount: own?.unresolvedCastSceneCount ?? 0
		}
	})
	let extendReadyCount = $derived(
		extendSessionId !== null
			? sessionUngraphed.ready
			: lineCounts.ungraphedSceneCount + lineCounts.ungraphedHistoryEntryCount
	)
	let extendUnsummarizedCount = $derived(
		extendSessionId !== null
			? sessionUngraphed.unsummarized
			: lineCounts.ungraphedUnsummarizedCount
	)
	let buildProgressPercent = $derived.by(() => {
		if (!activeBuild || activeBuild.status !== "building") return 0
		if (activeBuild.phase === "loading" || activeBuild.totalScenes === 0)
			return 5
		if (activeBuild.phase === "parsing") return 90
		return (
			Math.max(
				10,
				Math.round(
					(activeBuild.sceneIndex / activeBuild.totalScenes) * 80
				)
			) + 5
		)
	})

	/** The stored row of the link being edited; gone when a push deleted it. */
	let relStored = $derived(
		editingRel
			? (relationships.find((r) => r.id === editingRel!.id) ?? null)
			: null
	)
	/** Something typed in the edit since it opened (or last followed). */
	let relTypedHere = $derived(
		!!editingRel && !!editingFrom && linkFieldsDiffer(editingFrom, editingRel)
	)
	/** The stored row moved since the edit opened. */
	let relChangedElsewhere = $derived(
		!!relStored &&
			!!editingFrom &&
			linkFieldsDiffer(placeLinkFields(relStored), editingFrom)
	)
	$effect(() => {
		if (!relChangedElsewhere || !relStored) return
		const stored = relStored
		untrack(() => {
			if (relTypedHere) {
				relStaleNote = true
				return
			}
			editingRel = $state.snapshot(stored) as NarrativeRelationship
			editingFrom = placeLinkFields(stored)
			relStaleNote = false
		})
	})

	/**
	 * What leaving would throw away: the link edit's typing (compared field
	 * by field, never the whole object — `embedding` moves whenever the app
	 * re-vectorizes), and a new link's form once touched. A link deleted out
	 * from under its edit leaves nothing to discard back to.
	 */
	let formsDirty = $derived(
		(relTypedHere && relStored !== null) ||
			(linkDraft !== null &&
				(linkNewPlace !== null ||
					(linkDraftFrom !== null &&
						linkDraftChanged(linkDraftFrom, linkDraft))))
	)
	$effect(() => {
		hasUnsavedChanges = formsDirty
	})

	/**
	 * The one way off an open form (plan B7): ask first, then close both
	 * forms and drop the guard — written here, not left to the effect above,
	 * because the very next line is usually a transition, and a transition
	 * must not ask about a form already thrown away. Every selection change
	 * on the canvas goes through this; Cancel on a form is the author's own
	 * discard, and does not ask.
	 */
	async function leaveForms(): Promise<boolean> {
		if (formsDirty && !(await loreRoute.confirmLeave())) return false
		resetRelForm()
		resetLinkForm()
		hasUnsavedChanges = false
		return true
	}

	function openRelEdit(rel: NarrativeRelationship) {
		editingRel = $state.snapshot(rel) as NarrativeRelationship
		editingFrom = placeLinkFields(rel)
		relStaleNote = false
	}

	// The activity sidebar asks for the build modal by naming the book.
	$effect(() => {
		if (graphBuildsCtx?.reopenLorebookId !== lorebookId) return
		if (activeBuild) buildMode = activeBuild.mode
		showBuildModal = true
		graphBuildsCtx.reopenLorebookId = null
	})

	function displayName(node?: { name?: string; binding?: string }) {
		return node?.name?.trim() || node?.binding || ""
	}

	/**
	 * Why a link cannot be changed from the line being read, or null.
	 *
	 * A link belongs to one line. Editing or deleting one another line owns
	 * while reading a branch would rewrite that line — main included — so
	 * from here it is read, not written (#124).
	 */
	function relLockedReason(
		rel: Pick<NarrativeRelationship, "branchId"> | null | undefined
	): string | null {
		if (!rel) return null
		const here = route.branch ?? null
		const owner = rel.branchId ?? null
		if (owner === here) return null
		return `This link belongs to ${openBookTime.lineName(owner)}. Open that line to change it.`
	}

	/** A new link starts dated by the entry dated the moment being read. */
	function draftBetween(from: GraphNode, to: GraphNode): LinkDraft {
		return newLinkDraft(
			from,
			to,
			whenAtMoment(historyEntries, momentDate(route.moment))
		)
	}

	/**
	 * Opening a node is opening the thing it stands for: a member in Cast, an
	 * entry in its editor. A drawing lens has no editor, so an entry opens in
	 * the List lens — in the scope being read when that scope holds its kind,
	 * else in All (plan places-graph §10.2: a place opens its place editor).
	 * One transition, so the unsaved-changes guard asks once.
	 */
	function openNode(node: GraphNode) {
		if (node.kind === "cast") {
			onEditMember(node.id)
			return
		}
		const kind =
			node.typeId ??
			Object.entries(book.rawRows).find(([, rows]) =>
				rows.some((row) => row.id === node.id)
			)?.[0]
		const narrowsTo = SCOPE_KIND[route.scope]
		const scope: LoreScope =
			route.scope !== "cast" && (!narrowsTo || narrowsTo === kind)
				? route.scope
				: "all"
		void loreRoute.navigateTo(
			reduce(reduce(route, { type: "setLens", lens: "list" }), {
				type: "openEntry",
				entryId: node.id,
				scope,
				castId: null
			})
		)
	}

	async function selectNode(node: GraphNode | null) {
		if (!(await leaveForms())) return
		selectedRelId = null
		if (!node) {
			void loreRoute.navigate({ type: "openCastMember", castId: null })
			return
		}
		void loreRoute.navigate(
			node.kind === "cast"
				? { type: "openCastMember", castId: node.id }
				: // An entry node is not the selected member's lore: let go
					// of the member, or it stays selected over the entry (#118).
					{ type: "openEntry", entryId: node.id, castId: null }
		)
		if (mode === "compact") canvasOpen = false
	}

	async function selectEdge(edge: GraphEdge) {
		if (!rels.get(edge.id)) return
		if (!(await leaveForms())) return
		const rel = rels.get(edge.id)
		if (!rel) return
		selectedRelId = edge.id
		confirmingRelDelete = null
		// The Places lens is a designer: a link clicked is a link to edit,
		// unless another line owns it (then it is read, with the note). The
		// place it was picked from stays selected; the column shows the link
		// over it (`sideColumnView`), and closing the link goes back to it.
		if (drawing === "places" && !relLockedReason(rel)) openRelEdit(rel)
		// Compact shows one screen at a time: the edge panel is the other
		// one, so leave the canvas for it (#119).
		if (mode === "compact") canvasOpen = false
	}

	/** Close the link form and forget any create still in flight. */
	function resetLinkForm() {
		linkDraft = null
		linkDraftFrom = null
		linkNewPlace = null
		isConnecting = false
		linkError = null
		linkAttempt++
	}

	/** Open the link form on a fresh draft. */
	async function openLinkForm(
		from: GraphNode,
		to: GraphNode,
		newPlace: { name: string } | null = null
	) {
		if (!(await leaveForms())) return
		selectedRelId = null
		linkDraft = draftBetween(from, to)
		linkDraftFrom = $state.snapshot(linkDraft) as LinkDraft
		linkNewPlace = newPlace
		linkFormKey++
		if (mode === "compact") canvasOpen = false
	}

	/**
	 * Make a place on the line being read and hand back its node (plan
	 * places-graph B4). The workspace's rows hear the create and put it on
	 * the canvas; the caller points at it straight away. A refusal or silence
	 * rejects, and the field that asked says why.
	 */
	async function createPlace(name: string): Promise<GraphNode> {
		const params = newPlaceEntry(lorebookId, name, route.branch ?? null)
		const wanted = name.trim()
		const res = await awaitReply({
			socket,
			event: "entries:create",
			params,
			replyKey: interestKey("entries:create", lorebookId),
			errorEvent: "entries:create:error",
			fallbackError: "The place could not be made.",
			match: (data) =>
				data.entry?.lorebookId === lorebookId &&
				data.entry.typeId === LOCATION_TYPE_ID &&
				(data.entry.name ?? "").trim() === wanted
		})
		return placeNode(res.entry as PlaceRowLike)
	}

	/** Close the relationship edit and forget any save still in flight. */
	function resetRelForm() {
		editingRel = null
		editingFrom = null
		relStaleNote = false
		isSaving = false
		relError = null
		relAttempt++
	}

	function openScene(sceneId: number) {
		const scene = scenes.find((s) => s.id === sceneId)
		if (!scene) return
		void loreRoute.navigate({
			type: "openEntry",
			scope: "history",
			entryId: scene.historyEntryId,
			sceneId: scene.id
		})
	}

	/** Read the graph again, through the store. */
	function load() {
		rels.load()
	}

	function startLink(from: GraphNode, to: GraphNode) {
		openLinkForm(from, to)
	}

	/**
	 * Name it. The form stays open, saying why, until the server answers —
	 * a refusal or silence clears "saving" rather than leaving it stuck
	 * (#53). The link is drawn on the line being read (#124).
	 */
	async function submitLink() {
		if (!linkDraft || isConnecting) return
		const params = createLinkParams(
			lorebookId,
			linkDraft,
			route.branch ?? null
		)
		const attempt = ++linkAttempt
		isConnecting = true
		linkError = null
		try {
			await rels.create(params)
			if (attempt !== linkAttempt) return
			linkDraft = null
			linkDraftFrom = null
			linkNewPlace = null
		} catch (err) {
			if (attempt !== linkAttempt) return
			linkError = isReplyTimeout(err)
				? "The server did not answer. Nothing was saved; try again."
				: err instanceof Error
					? err.message
					: "The link could not be saved."
		} finally {
			if (attempt === linkAttempt) isConnecting = false
		}
	}

	async function saveRel() {
		if (!editingRel || isSaving) return
		const attempt = ++relAttempt
		isSaving = true
		relError = null
		try {
			// The line being read: the server refuses another line's row,
			// exactly as `relLockedReason` does here.
			const { relationship, branchId } = updateLinkParams(
				$state.snapshot(editingRel),
				route.branch ?? null
			)
			await rels.update(relationship, branchId)
			if (attempt !== relAttempt) return
			editingRel = null
			editingFrom = null
			relStaleNote = false
		} catch (err) {
			if (attempt !== relAttempt) return
			relError = isReplyTimeout(err)
				? "The server did not answer. Nothing was saved; try again."
				: err instanceof Error
					? err.message
					: "The relationship could not be saved."
		} finally {
			if (attempt === relAttempt) isSaving = false
		}
	}

	function deleteRel(id: number) {
		// The push drops the edge and closes the panel on it. A refusal (the
		// link is another line's) or silence is said here, in the tab that
		// deleted: Layout leaves this event's refusals to the surface that
		// asked, because the place page says them in its row.
		void rels.remove(id, route.branch ?? null).catch((err) => {
			toaster.error({
				title: "The link was not deleted",
				description: isReplyTimeout(err)
					? "The server did not answer in time."
					: err instanceof Error
						? err.message
						: "The link could not be deleted."
			})
		})
	}

	/** How many links a member is an end of, on every line. */
	function linkCountOf(nodeId: number): number {
		return relationships.filter(
			(r) =>
				(r.from.kind === "cast" && r.from.bindingId === nodeId) ||
				(r.to.kind === "cast" && r.to.bindingId === nodeId)
		).length
	}

	/**
	 * Open the delete dialog and ask how much private lore the member
	 * anchors — the dialog's question depends on it (ruling 4).
	 */
	async function requestDeleteNode(node: NarrativeNode) {
		deleteTarget = node
		deleteCheck = null
		deleteCheckError = null
		try {
			const res = await awaitReply({
				socket,
				event: "narrativeGraph:checkNodeMergeReferences",
				params: { nodeId: node.id },
				errorEvent: "narrativeGraph:checkNodeMergeReferences:error",
				fallbackError: "The server could not count it.",
				match: (data) => data.nodeId === node.id
			})
			if (deleteTarget?.id === node.id) deleteCheck = res
		} catch (err) {
			if (deleteTarget?.id === node.id)
				deleteCheckError = err instanceof Error ? err.message : String(err)
		}
	}

	function cancelDeleteNode() {
		if (deleting) return
		deleteTarget = null
		deleteCheck = null
		deleteCheckError = null
	}

	async function confirmDeleteNode(privateLore: PrivateLoreChoice) {
		const target = deleteTarget
		if (!target || deleting) return
		const name = displayName(target)
		deleting = true
		let res: Sockets.NarrativeGraph.DeleteNode.Response
		try {
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
			// A refusal Layout's `:error` catch-all has already toasted is
			// not toasted again; silence is said here, since nothing else will.
			if (isReplyTimeout(err))
				toaster.error({
					title: `${name} was not deleted`,
					description: "The server did not answer in time."
				})
			return
		}
		deleting = false
		deleteTarget = null
		deleteCheck = null
		toaster.success({ title: deletedMemberToast(name, res.deletedLoreCount) })
	}

	/**
	 * The list's figures for the Build and Extend buttons, and the links an
	 * apply brought. The rows themselves are the store's.
	 */
	function handleList(msg: Sockets.NarrativeGraph.List.Response) {
		if (appliedBaseline) {
			for (const rel of msg.relationships)
				if (!appliedBaseline.has(rel.id)) newEdgeIds.add(rel.id)
			appliedBaseline = null
		}
		ungraphedSceneCount = msg.ungraphedSceneCount ?? 0
		ungraphedUnsummarizedCount = msg.ungraphedUnsummarizedCount ?? 0
		totalSummarizedCount = msg.totalSummarizedCount ?? 0
		ungraphedHistoryEntryCount = msg.ungraphedHistoryEntryCount ?? 0
		totalDirectHistoryEntryCount = msg.totalDirectHistoryEntryCount ?? 0
		unresolvedCastSceneCount = msg.unresolvedCastSceneCount ?? 0
		branchCounts = msg.branchCounts ?? []
		namelessBindingCount = msg.namelessBindingCount ?? 0
	}

	// ⚠ The write replies below are BARE (not in SCOPED_EVENTS), so every
	// tab hears every book's writes. Each one checks the book it names before
	// it touches this canvas (#55, #158).

	/**
	 * Only the deleted member's selection goes; anyone else stays open. The
	 * cast and the graph are read again by the workspace, for every lens.
	 */
	function handleDeleteNode(msg: Sockets.NarrativeGraph.DeleteNode.Response) {
		if (msg.lorebookId !== lorebookId) return
		if (route.castId === msg.id)
			void loreRoute.navigate({ type: "openCastMember", castId: null })
	}

	/**
	 * The store has already dropped the one edge in place (a reload threw the
	 * canvas away with its layout for the sake of one line, #123); this lens
	 * lets go of what it had open on it.
	 */
	function handleDeletedRelationship(rel: NarrativeRelationship) {
		newEdgeIds.delete(rel.id)
		if (selectedRelId === rel.id) selectedRelId = null
		if (editingRel?.id === rel.id) resetRelForm()
	}

	function handleCreatedRelationship(rel: NarrativeRelationship) {
		newEdgeIds.add(rel.id)
	}

	/** A merge here closes the absorb and the selection; the workspace re-reads. */
	function handleMergeWrite(bookId: number) {
		if (bookId !== lorebookId) return
		showMergeModal = false
		mergeTarget = null
		void loreRoute.navigate({ type: "openCastMember", castId: null })
	}

	/**
	 * The graph itself — its list, its failure and the three relationship
	 * writes — is the store's read (`relationships.svelte.ts`); this lens hears
	 * what moved through its hooks, after the store's rows have.
	 */
	$effect(() =>
		rels.listen({
			listed: handleList,
			created: handleCreatedRelationship,
			deleted: handleDeletedRelationship
		})
	)

	/**
	 * The writes are BARE — none has an entry in `SCOPED_EVENTS`, and a scoped
	 * key for an unscoped event matches nothing at all — so each handler
	 * filters on the book its reply names (the store's methods do).
	 */
	useInterest<"narrativeGraph:deleteNode">(
		"narrativeGraph:deleteNode",
		handleDeleteNode
	)
	useInterest<"narrativeGraph:mergeNode">("narrativeGraph:mergeNode", (msg) =>
		handleMergeWrite(msg.survivorNode.lorebookId)
	)
	useInterest<"narrativeGraph:undoMerge">("narrativeGraph:undoMerge", (msg) =>
		handleMergeWrite(msg.restoredNode.lorebookId)
	)

	// The rows, the scenes, the cast and the embedding badges are the
	// workspace's (plan B4); the graph is the relationship store's, which the
	// workspace opens on the book. A mount reads what is already held.
	onMount(() => {
		if (!rels.loaded) load()
	})

	onDestroy(() => {
		hasUnsavedChanges = false
	})
</script>

{#snippet buildActions()}
	{#if activeBuild}
		{#if activeBuild.status === "building"}
			<div class="flex items-center gap-2">
				<div
					class="bg-primary-500 h-2 w-2 shrink-0 animate-pulse rounded-full"
				></div>
				<span class="text-surface-700-300 text-sm">Building…</span>
			</div>
		{:else if activeBuild.status === "error"}
			<div class="flex items-center gap-2">
				<Icons.AlertCircle size={14} class="text-error-500 shrink-0" />
				<span class="text-error-500 text-sm">Failed</span>
			</div>
		{/if}
	{:else}
		<button
			class="btn btn-sm preset-filled-primary-500"
			type="button"
			disabled={!!buildReason}
			data-graph-build
			onclick={() => {
				buildMode = "replace"
				showBuildModal = true
			}}
			title={buildReason ??
				(nodes.length > 0
					? "Rebuild the links between cast members from scenes"
					: "Build the graph from scenes")}
		>
			<Icons.Cpu size={14} aria-hidden="true" />
			{nodes.length > 0 ? "Rebuild" : "Build"}
		</button>
		<button
			class="btn btn-sm preset-filled-surface-400-600"
			type="button"
			disabled={!!buildReason ||
				nodes.length === 0 ||
				extendReadyCount === 0}
			data-graph-extend
			title={buildReason ??
				(extendReadyCount === 0
					? extendUnsummarizedCount > 0
						? `${extendUnsummarizedCount} scene${extendUnsummarizedCount === 1 ? "" : "s"} need summaries before they can be graphed`
						: extendSessionId !== null
							? "Every summarized scene in this session is already graphed"
							: "The graph is up to date"
					: extendSessionId !== null
						? `Read the ${extendReadyCount} scene${extendReadyCount === 1 ? "" : "s"} from the open session that the graph has not read yet, and propose what they add`
						: `Read the ${extendReadyCount} scene${extendReadyCount === 1 ? "" : "s"} and history entries on this line that the graph has not read yet, and propose what they add`)}
			onclick={() => {
				buildMode = "extend"
				showBuildModal = true
			}}
		>
			<Icons.Layers size={14} aria-hidden="true" />
			{extendSessionId !== null ? "Extend from this session" : "Extend graph"}
			{#if extendReadyCount > 0}
				<span class="badge-icon preset-tonal-primary text-[11px]">
					{extendReadyCount}
				</span>
			{/if}
		</button>
	{/if}
	<button
		class="btn btn-sm preset-filled-surface-400-600"
		type="button"
		onclick={load}
		title="Refresh"
		aria-label="Refresh the graph"
	>
		<Icons.RefreshCw size={14} aria-hidden="true" />
	</button>
	<button
		class="btn btn-sm {showPipelinePanel
			? 'preset-filled-surface-500'
			: 'preset-filled-surface-400-600'}"
		type="button"
		title="The pipeline behind the build: which model, sampling profile and prompt each step runs on"
		aria-label="Graph build pipeline settings"
		aria-pressed={showPipelinePanel}
		onclick={() => (showPipelinePanel = !showPipelinePanel)}
	>
		<Icons.Workflow size={14} aria-hidden="true" />
	</button>
{/snippet}

{#snippet relationshipForm(rel: NarrativeRelationship)}
	{@const problem = relationshipFieldsProblem(rel)}
	<div class="flex flex-col gap-2">
		<RelationshipFields
			value={rel}
			pairing={linkPairingOf(rel.from.kind, rel.to.kind)}
			whenOptions={linkWhenOptions}
			withReason
			onChange={(next) => (editingRel = next)}
		/>
		{#if relStaleNote}
			<p
				class="text-warning-600-400 text-xs"
				role="status"
				data-graph-link-stale
			>
				This link was changed elsewhere while you were editing it. Update
				puts yours in its place; Cancel keeps the other.
			</p>
		{/if}
		{#if relError}
			<p class="text-error-500 text-xs" role="alert">{relError}</p>
		{/if}
		<div class="flex justify-end gap-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600"
				type="button"
				onclick={resetRelForm}
			>
				Cancel
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				type="button"
				disabled={isSaving || problem !== null}
				title={problem ?? undefined}
				onclick={saveRel}
			>
				<Icons.Save size={13} aria-hidden="true" /> Update
			</button>
		</div>
	</div>
{/snippet}

{#snippet castActions(node: NarrativeNode)}
	<div class="flex flex-wrap items-center gap-1">
		<span class="badge {stateBadge(node.nodeState).color} text-xs">
			{node.nodeState}
		</span>
		{#if node.nodeVisibility !== "normal"}
			<span class="badge {visibilityBadge(node.nodeVisibility)} text-xs">
				{node.nodeVisibility}
			</span>
		{/if}
		<div class="ml-auto flex gap-1">
			<button
				class="btn btn-sm preset-tonal-warning p-1.5"
				type="button"
				onclick={() => {
					mergeTarget = node
					showMergeModal = true
				}}
				title="Absorb into another member, because they are the same person"
				aria-label="Absorb into another member"
			>
				<Icons.GitMerge size={13} aria-hidden="true" />
			</button>
			<button
				class="btn btn-sm preset-tonal-error p-1.5"
				type="button"
				onclick={() => void requestDeleteNode(node)}
				title="Delete"
				aria-label="Delete"
			>
				<Icons.Trash2 size={13} aria-hidden="true" />
			</button>
		</div>
	</div>
	{#if node.summary}
		<p class="text-surface-700-300 text-xs">{node.summary}</p>
	{/if}
{/snippet}

{#snippet nodeList()}
	<div
		class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
		data-graph-nodes
	>
		{#if graph.length === 0}
			<EmptyState
				icon={drawing === "places" ? Icons.Map : Icons.Network}
				message={drawing === "places"
					? "Pick a place on the map to see what joins it."
					: lensEmptyMessage("graph")}
			/>
		{:else}
			{#each graph as node (node.key)}
				<button
					type="button"
					data-graph-node
					data-node-key={node.key}
					aria-current={selectedKey === node.key ? "true" : undefined}
					class="preset-filled-surface-100-900 hover:bg-surface-200-800 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
					class:preset-tonal-primary={selectedKey === node.key}
					onclick={() => selectNode(node)}
				>
					<span class="min-w-0 flex-1 truncate text-sm font-medium">
						{node.name}
					</span>
					{#if node.kind === "cast"}
						{@const row = nodes.find((n) => n.id === node.id)}
						{#if row}
							<EmbeddingStatusIcon
								embeddingModel={row.embeddingModel}
							/>
						{/if}
						<span
							class="badge {stateBadge(node.state)
								.color} shrink-0 text-xs"
						>
							{node.state}
						</span>
					{:else}
						<span
							class="badge preset-tonal-surface shrink-0 text-[11px]"
						>
							Entry
						</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
{/snippet}

{#snippet placesToolbar()}
	{#if places.categories.length > 0}
		<div
			class="flex flex-wrap gap-1"
			role="group"
			aria-label="Category"
			data-place-categories
		>
			<button
				type="button"
				class="chip text-xs {placeCategory === null
					? 'preset-tonal-primary'
					: 'preset-tonal-surface'}"
				aria-pressed={placeCategory === null}
				onclick={() => (placeCategoryChip = null)}
			>
				All
			</button>
			{#each places.categories as category (category)}
				{@const active =
					placeCategory?.toLowerCase() === category.toLowerCase()}
				<button
					type="button"
					class="chip text-xs {active
						? 'preset-tonal-primary'
						: 'preset-tonal-surface'}"
					aria-pressed={active}
					onclick={() => (placeCategoryChip = active ? null : category)}
				>
					{category}
				</button>
			{/each}
		</div>
	{/if}
	{#if newPlaceOpen}
		<NewPlaceField
			onCreate={async (name) => {
				const node = await createPlace(name)
				newPlaceOpen = false
				// A new place has no category yet: a chip would hide it.
				placeCategoryChip = null
				selectNode(node)
			}}
			onCancel={() => (newPlaceOpen = false)}
		/>
	{:else if places.placeTotal > 0}
		<!-- Tonal: beside a picked place or link the column's own action
		     (Update, Name it) is the one filled primary (STYLE-GUIDE §6.1). -->
		<button
			type="button"
			class="btn btn-sm preset-tonal-primary"
			data-new-place-open
			onclick={() => (newPlaceOpen = true)}
		>
			<Icons.MapPinPlus size={14} aria-hidden="true" /> New place
		</button>
	{/if}
{/snippet}

{#snippet placesEmpty()}
	<EmptyState
		icon={Icons.Map}
		message={lensEmptyMessage("places")}
		ctaLabel={newPlaceOpen ? undefined : "New place"}
		onCta={() => (newPlaceOpen = true)}
	/>
{/snippet}

{#snippet canvas()}
	<RelationshipsCanvas
		{drawing}
		nodes={graph}
		{edges}
		{headline}
		{heldBack}
		momentLabel={route.moment ? momentLabel(route.moment) : null}
		{selectedKey}
		onNodeClick={selectNode}
		onEdgeClick={selectEdge}
		onLinkDraw={startLink}
		toolbar={drawing === "places" ? placesToolbar : undefined}
		empty={drawing === "places" ? placesEmpty : undefined}
		categoryOrder={drawing === "places" ? places.categories : undefined}
	/>
{/snippet}

{#snippet relationshipPanel()}
	{#if selectedRel}
		<div class="flex flex-col gap-2 text-sm">
			<div class="flex items-center gap-1">
				<span class="min-w-0 flex-1 truncate font-semibold">
					{names.get(
						selectedRel.from.kind === "cast"
							? castKey(selectedRel.from.bindingId)
							: entryKey(selectedRel.from.entryId)
					) ?? "?"}
					{selectedRel.reverseRelationshipType ? "↔" : "→"}
					{names.get(
						selectedRel.to.kind === "cast"
							? castKey(selectedRel.to.bindingId)
							: entryKey(selectedRel.to.entryId)
					) ?? "?"}
				</span>
				<button
					class="btn btn-sm preset-filled-surface-400-600 p-1.5"
					type="button"
					title={relLockedReason(selectedRel) ?? "Edit relationship"}
					aria-label="Edit relationship"
					disabled={!!relLockedReason(selectedRel)}
					onclick={async () => {
						const rel = selectedRel
						if (!rel || !(await leaveForms())) return
						openRelEdit(rel)
					}}
				>
					<Icons.Pencil size={13} aria-hidden="true" />
				</button>
				<button
					class="btn btn-sm preset-tonal-error p-1.5"
					type="button"
					title={relLockedReason(selectedRel) ?? "Delete relationship"}
					aria-label="Delete relationship"
					disabled={!!relLockedReason(selectedRel)}
					onclick={() => (confirmingRelDelete = selectedRel!.id)}
				>
					<Icons.Trash2 size={13} aria-hidden="true" />
				</button>
				<button
					class="btn btn-sm preset-filled-surface-400-600 p-1.5"
					type="button"
					title="Close"
					aria-label="Close"
					onclick={async () => {
						if (!(await leaveForms())) return
						selectedRelId = null
						confirmingRelDelete = null
					}}
				>
					<Icons.X size={13} aria-hidden="true" />
				</button>
			</div>
			{#if confirmingRelDelete === selectedRel.id}
				<div class="flex items-center gap-1" data-confirm-delete-rel>
					<span class="text-error-500 flex-1 text-xs">
						Delete for good?
					</span>
					<button
						class="btn btn-sm preset-filled-error-500 text-xs"
						type="button"
						onclick={() => {
							confirmingRelDelete = null
							deleteRel(selectedRel!.id)
						}}
					>
						Delete
					</button>
					<button
						class="btn btn-sm preset-tonal-surface text-xs"
						type="button"
						onclick={() => (confirmingRelDelete = null)}
					>
						Cancel
					</button>
				</div>
			{/if}
			{#if relLockedReason(selectedRel)}
				<p class="text-surface-600-400 text-xs" data-link-locked>
					{relLockedReason(selectedRel)}
				</p>
			{/if}
			{#if editingRel}
				{@render relationshipForm(editingRel)}
			{:else}
				{#if selectedSentences.length}
					<ul class="flex flex-col gap-1 text-xs" data-link-sentences>
						{#each selectedSentences as said (said.key)}
							<li>
								<span class="font-semibold">{said.subject}</span>
								<span class="text-surface-600-400">·</span>
								{said.sentence}
							</li>
						{/each}
					</ul>
				{/if}
				<span
					class="badge {REL_STATUS_BADGE[selectedRel.status] ??
						'preset-tonal-surface'} self-start text-xs"
				>
					{selectedRel.status}
				</span>
				{#if selectedRel.description}
					<p class="text-xs">{selectedRel.description}</p>
				{/if}
				{#if selectedRel.reason}
					<p class="text-surface-700-300 text-xs italic">
						Reason: {selectedRel.reason}
					</p>
				{/if}
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet sideColumn()}
	<div class="flex min-h-0 flex-1 flex-col gap-2">
		{#if sideView === "link" && linkDraft}
			{#key linkFormKey}
				<LinkForm
					draft={linkDraft}
					candidates={linkCandidates}
					saving={isConnecting}
					whenOptions={linkWhenOptions}
					error={linkError}
					onNewPlace={createPlace}
					startWithNewPlace={linkNewPlace !== null}
					newPlaceName={linkNewPlace?.name ?? ""}
					onChange={(next) => (linkDraft = next)}
					onSubmit={submitLink}
					onCancel={resetLinkForm}
				/>
			{/key}
		{:else if sideView === "relationship" && selectedRel}
			{@render relationshipPanel()}
		{:else if sideView === "node" && selectedNode}
			<NodePanel
				node={selectedNode}
				edges={panelRows}
				{notDrawn}
				{ceiling}
				isNew={(edge) => newEdgeIds.has(edge.id)}
				candidates={linkCandidates}
				canCreatePlace
				onOpen={() => openNode(selectedNode!)}
				onLinkTo={(other) => openLinkForm(selectedNode!, other)}
				onNewPlace={(typed) =>
					openLinkForm(selectedNode!, selectedNode!, { name: typed })}
				onKeep={(edge) => newEdgeIds.delete(edge.id)}
				onEdgeClick={selectEdge}
				onDeleteEdge={(edge) => deleteRel(edge.id)}
				lockedReason={(edge) =>
					relLockedReason(relationships.find((r) => r.id === edge.id))}
				onOpenScene={openScene}
				onRaiseCeiling={() => (showPipelinePanel = true)}
				onClose={() => selectNode(null)}
			/>
			{#if selectedNode.kind === "cast"}
				{@const row = nodes.find((n) => n.id === selectedNode!.id)}
				{#if row}
					<div
						class="panel-inset flex flex-col gap-2"
					>
						{@render castActions(row)}
					</div>
				{/if}
			{/if}
		{:else}
			{@render nodeList()}
		{/if}
	</div>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-3" data-lore-drawing={drawing}>
	{#if drawing === "relationships"}
		<PanelToolbar label="Graph actions">
			{@render buildActions()}
		</PanelToolbar>
	{/if}

	{#if showPipelinePanel}
		<div
			class="bg-surface-200-800 panel-edge space-y-2 rounded-lg border p-3 text-sm"
		>
			<div class="flex items-center justify-between gap-2">
				<p class="font-medium">
					<Icons.Workflow size={14} class="mr-1 inline" />
					{pipelineOverview
						? `${pipelineOverview.name} · v${pipelineOverview.version}`
						: "Graph build pipeline"}
				</p>
				{#if userCtx?.user?.isAdmin}
					<a
						class="btn btn-sm preset-tonal-surface shrink-0 text-xs"
						href="/admin/pipelines/{encodeURIComponent(
							GRAPH_PIPELINE_SLUG
						)}"
						title="Versions, publish state and run history"
					>
						<Icons.Settings2 size={12} /> Manage
					</a>
				{/if}
			</div>
			<PipelineConfigOptions
				slug={GRAPH_PIPELINE_SLUG}
				onLoaded={(d) => (pipelineOverview = d)}
			/>
		</div>
	{/if}

	{#if activeBuild && drawing === "relationships"}
		<div
			class="bg-surface-200-800 panel-edge flex flex-col gap-2 rounded-lg border p-3 text-sm"
		>
			{#if activeBuild.status === "building"}
				<p class="text-surface-700-300 text-xs capitalize">
					{activeBuild.phase.replace(/_/g, " ")}
					{#if activeBuild.totalScenes > 0}
						· scene {activeBuild.sceneIndex +
							1}/{activeBuild.totalScenes}
					{/if}
				</p>
				<div
					class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full"
				>
					<div
						class="bg-primary-500 h-full rounded-full transition-all duration-500"
						style="width: {buildProgressPercent}%"
					></div>
				</div>
				<div class="flex items-center gap-2">
					{#if activeBuild.activityId}
						<button
							class="btn btn-sm preset-tonal-error"
							type="button"
							onclick={() =>
								socket.emit("activity:cancel", {
									id: activeBuild!.activityId!
								})}
						>
							<Icons.Square size={14} aria-hidden="true" /> Stop
						</button>
					{/if}
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						type="button"
						onclick={() => {
							buildMode = activeBuild!.mode
							showBuildModal = true
						}}
					>
						<Icons.Eye size={14} aria-hidden="true" /> View progress
					</button>
				</div>
			{:else if activeBuild.status === "review"}
				<div class="flex flex-wrap items-center gap-2">
					<Icons.CheckCircle
						size={14}
						class="text-success-500 shrink-0"
					/>
					<span class="text-success-500 font-medium">
						100% complete
					</span>
					<button
						class="btn btn-sm preset-filled-primary-500 ml-auto"
						type="button"
						onclick={() => {
							buildMode = activeBuild!.mode
							showBuildModal = true
						}}
					>
						<Icons.Check size={14} aria-hidden="true" /> Review & apply
					</button>
				</div>
			{:else if activeBuild.status === "error"}
				<div class="flex flex-wrap items-center gap-2">
					<Icons.AlertCircle
						size={14}
						class="text-error-500 shrink-0"
					/>
					<span class="text-error-500">Build failed</span>
					{#if activeBuild.errorMessage}
						<span class="text-surface-700-300 truncate text-xs">
							{activeBuild.errorMessage}
						</span>
					{/if}
					<button
						class="btn btn-sm preset-tonal-error ml-auto"
						type="button"
						onclick={() => {
							buildMode = activeBuild!.mode
							showBuildModal = true
						}}
					>
						<Icons.AlertCircle size={14} aria-hidden="true" /> View error
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if namelessBindingCount > 0 && drawing === "relationships"}
		<!-- A row with an empty name matches no extracted name, so a build
		     proposes a fresh one beside it every time. Surfaced so it can be
		     named or removed by hand. -->
		<div
			class="bg-surface-200-800 panel-edge flex items-center gap-2 rounded-lg border p-3 text-sm"
		>
			<Icons.HelpCircle size={14} class="text-surface-600-400 shrink-0" />
			<span class="text-surface-700-300">
				{namelessBindingCount} cast {namelessBindingCount === 1
					? "member has"
					: "members have"} no name, so a build cannot match them to anyone
				it finds. Name or delete them in Cast.
			</span>
		</div>
	{/if}

	{#if loadError}
		<!-- Say what happened and offer the one thing that can help. A spinner
		     that never stops says neither. -->
		<div
			class="flex flex-col items-center justify-center gap-3 py-10 text-center"
			data-lore-graph-error
		>
			<Icons.Unplug
				size={24}
				class="text-surface-500"
				aria-hidden="true"
			/>
			<p class="text-surface-700-300 max-w-sm text-sm leading-relaxed">
				{loadError} Nothing has been changed — the graph is still there,
				this view could not read it.
			</p>
			<button
				class="btn btn-sm preset-filled-primary-500"
				type="button"
				onclick={load}
			>
				<Icons.RefreshCw size={14} aria-hidden="true" />
				Try again
			</button>
		</div>
	{:else if isLoading}
		<div class="flex items-center justify-center py-10">
			<Icons.Loader2 size={20} class="text-surface-600-400 animate-spin" />
		</div>
	{:else if mode === "desk"}
		<div class="flex min-h-0 flex-1 gap-4">
			<div class="flex min-h-0 min-w-0 flex-1 flex-col">
				{@render canvas()}
			</div>
			{#if hasSideColumn}
				<div
					class="panel-card flex min-h-0 w-[360px] shrink-0 flex-col p-3"
					data-graph-side
				>
					{@render sideColumn()}
				</div>
			{/if}
		</div>
	{:else if canvasOpen || !hasSideColumn}
		{#if hasSideColumn}
			<div class="flex min-h-0 flex-1 flex-col gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 self-start"
					type="button"
					onclick={() => (canvasOpen = false)}
				>
					<Icons.ChevronLeft size={16} aria-hidden="true" /> Back to the
					list
				</button>
				{@render canvas()}
			</div>
		{:else}
			<!-- The map is the Places lens: with nothing picked there is no
			     list to go back to, so it is the whole screen (#122). -->
			<div class="flex min-h-0 flex-1 flex-col gap-2">
				{@render canvas()}
			</div>
		{/if}
	{:else}
		<button
			class="btn btn-sm preset-tonal-surface self-start"
			type="button"
			onclick={() => (canvasOpen = true)}
		>
			<Icons.Maximize2 size={14} aria-hidden="true" />
			{drawing === "relationships" ? "Show the graph" : "Show the map"}
		</button>
		{@render sideColumn()}
	{/if}
</div>

<GraphBuildModal
	open={showBuildModal}
	onOpenChange={(e) => (showBuildModal = e.open)}
	{lorebookId}
	mode={buildMode}
	sessionId={buildMode === "extend" ? extendSessionId : null}
	branchId={buildMode === "extend" && extendSessionId === null
		? line.branchId
		: null}
	readySceneCount={buildMode === "extend"
		? extendSessionId !== null
			? sessionUngraphed.ready
			: lineCounts.ungraphedSceneCount
		: totalSummarizedCount}
	skippedSceneCount={buildMode === "extend" ? extendUnsummarizedCount : 0}
	ungraphedHistoryEntryCount={buildMode === "extend"
		? extendSessionId !== null
			? 0
			: lineCounts.ungraphedHistoryEntryCount
		: totalDirectHistoryEntryCount}
	existingUnboundNodeCount={nodes.filter(
		(n) => n.characterId == null && !n.parentNodeId
	).length}
	existingCastToCastCount={relationshipCounts.castToCast}
	unresolvedCastSceneCount={buildMode === "extend"
		? extendSessionId !== null
			? sessionUngraphed.unresolvedCast
			: lineCounts.unresolvedCastSceneCount
		: unresolvedCastSceneCount}
	onApplied={() => {
		appliedBaseline = new Set(relationships.map((r) => r.id))
		load()
		// The scenes it read are graphed now; the session's Extend count is
		// read off them.
		book.refreshScenes()
	}}
/>

<DeleteCastMemberModal
	open={deleteTarget !== null}
	name={deleteTarget ? displayName(deleteTarget) : ""}
	linked={deleteTarget?.characterId != null}
	relationshipCount={deleteTarget ? linkCountOf(deleteTarget.id) : 0}
	check={deleteCheck}
	checkError={deleteCheckError}
	busy={deleting}
	onConfirm={confirmDeleteNode}
	onCancel={cancelDeleteNode}
/>

{#if mergeTarget}
	<AbsorbBindingModal
		open={showMergeModal}
		onOpenChange={(e) => {
			showMergeModal = e.open
			if (!e.open) mergeTarget = null
		}}
		node={mergeTarget}
		{nodes}
		{lorebookId}
	/>
{/if}
