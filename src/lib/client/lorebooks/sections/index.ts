import * as Icons from "@lucide/svelte"
import { toaster } from "$lib/client/utils/toaster"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import { LORE_SCOPES, type LoreScope } from "../loreRoute"
import { SCENE_KIND, type PoolItem } from "../poolFilter"
import CharacterLoreEditor from "./CharacterLoreEditor.svelte"
import CharacterLoreRow from "./CharacterLoreRow.svelte"
import GenericEntryEditor from "./GenericEntryEditor.svelte"
import HistoryEditor from "./HistoryEditor.svelte"
import HistoryRow from "./HistoryRow.svelte"
import HistoryListActions from "./HistoryListActions.svelte"
import HistoryRowMenu from "./HistoryRowMenu.svelte"
import PoolRow from "./PoolRow.svelte"
import SceneEditor from "./SceneEditor.svelte"
import SceneRow from "./SceneRow.svelte"
import WorldLoreEditor from "./WorldLoreEditor.svelte"
import WorldLoreRow from "./WorldLoreRow.svelte"
import { dateValue, editBounds, formatDate } from "./historyDates"
import type {
	DoorId,
	InspectorTab,
	PoolSource,
	SectionDescriptor
} from "./types"

export type { DoorId, PoolSource, SectionDescriptor } from "./types"

/**
 * The named front doors, declared once.
 *
 * The workspace draws one pool; a door is a preset over it — which kind it
 * narrows to, what a row of that kind reads like, what its editor asks for,
 * and what to say when there is nothing there. Adding a shape means adding a
 * descriptor, not a manager.
 */

/**
 * The inspector's three tabs, declared once and offered by the doors they
 * mean something for.
 *
 * Read in? reports on a **saved entry** — the pipeline gathers lore out of the
 * database — so a door whose rows are not entries does not offer it. Scenes
 * belongs to the one door whose rows are compiled out of them.
 *
 * The labels are declared here and the figures are added where the strip is
 * drawn (`inspectorTabsFor`), so a count never becomes a second place the
 * words live.
 */
const FIRES_TAB: InspectorTab = { id: "fires", label: "Read in?" }
const REFERENCES_TAB: InspectorTab = { id: "references", label: "References" }
const SCENES_TAB: InspectorTab = { id: "scenes", label: "Scenes" }

const timeOf = (value: unknown): number => {
	if (!value) return 0
	const ms = new Date(value as string).getTime()
	return Number.isFinite(ms) ? ms : 0
}

/** The half of a pool row that is the same whatever kind declared it. */
function entryPoolItem(source: PoolSource, kind: string): PoolItem {
	return {
		key: `entry#${source.id}`,
		id: source.id,
		kind,
		name: source.name ?? "",
		content: source.content ?? "",
		keys: source.keys ?? "",
		pinned: !!source.constant,
		off: source.enabled === false,
		archived: source.archived === true,
		machineWritten: !!source.provenance && source.provenance !== "human",
		parentKey:
			source.anchorEntryId != null
				? `entry#${source.anchorEntryId}`
				: null,
		order: source.position ?? 0,
		position: source.position ?? 0,
		priority: source.priority ?? 0,
		createdAt: timeOf(source.createdAt),
		updatedAt: timeOf(source.updatedAt)
	}
}

/** An entry's draft is the wire row itself; every column on it is editable. */
const entryDraft = (source: PoolSource) => ({ ...source })

/** A named entry is nothing without its name — the list is a list of names. */
function requireName(draft: Record<string, any>, warn?: boolean): boolean {
	if (draft.name?.trim()) return true
	if (warn) toaster.error({ title: "Name is required" })
	return false
}

const namedEntryDraft = (lorebookId: number, typeId: string) => ({
	typeId,
	lorebookId,
	name: "",
	content: "",
	keys: "",
	// The absence of a condition, spelled the way the column stores it: no
	// keys and no mode. Either one alone is a rule about nothing.
	secondaryKeys: "",
	selectiveLogic: null,
	useRegex: false,
	caseSensitive: false,
	constant: false,
	enabled: true,
	priority: 1
})

const world: SectionDescriptor = {
	id: "world",
	label: "World lore",
	icon: Icons.Globe,
	typeId: WORLD_LORE_TYPE_ID,
	kind: WORLD_LORE_TYPE_ID,
	store: "entries",
	vectorSource: "worldLore",
	roles: new Set(["position"]),
	row: WorldLoreRow,
	editor: WorldLoreEditor,
	inspector: [FIRES_TAB, REFERENCES_TAB],
	emptyCopy: {
		title: "No world lore yet",
		body: "World lore holds what is true of the setting whoever is in the scene: cities, factions, history, house rules.",
		action: "New world lore"
	},
	creatable: true,
	newLabel: "New world lore",
	newDraft: (lorebookId) => namedEntryDraft(lorebookId, WORLD_LORE_TYPE_ID),
	toPoolItem: (source) => entryPoolItem(source, WORLD_LORE_TYPE_ID),
	toDraft: entryDraft,
	title: (source) => source.name ?? "",
	validate: (draft, _siblings, warn) => requireName(draft, warn)
}

/**
 * Character Lore curates a kind without being a section: a cast member's page
 * lists the lore anchored to them, and Cast mounts this editor for it.
 */
const characters: SectionDescriptor = {
	id: "characters",
	label: "Character lore",
	icon: Icons.User,
	typeId: CHARACTER_LORE_TYPE_ID,
	kind: CHARACTER_LORE_TYPE_ID,
	store: "entries",
	vectorSource: "characterLore",
	roles: new Set(["position", "anchor"]),
	row: CharacterLoreRow,
	editor: CharacterLoreEditor,
	inspector: [FIRES_TAB, REFERENCES_TAB],
	emptyCopy: {
		title: "No character lore yet",
		body: "Character lore is private to one cast member: their secrets, backstory, abilities, what only they would know.",
		action: "New character lore"
	},
	creatable: true,
	newLabel: "New character lore",
	newDraft: (lorebookId) => ({
		...namedEntryDraft(lorebookId, CHARACTER_LORE_TYPE_ID),
		lorebookBindingId: null
	}),
	toPoolItem: (source) => entryPoolItem(source, CHARACTER_LORE_TYPE_ID),
	toDraft: entryDraft,
	title: (source) => source.name ?? "",
	validate: (draft, _siblings, warn) => requireName(draft, warn)
}

const history: SectionDescriptor = {
	id: "history",
	label: "History",
	icon: Icons.Calendar,
	typeId: HISTORY_TYPE_ID,
	kind: HISTORY_TYPE_ID,
	store: "entries",
	// ⚠ `historyEntry`, not `history`: the index vocabulary and the
	// budget-band vocabulary are separate and reconciled at boundaries.
	vectorSource: "historyEntry",
	roles: new Set(["order"]),
	row: HistoryRow,
	editor: HistoryEditor,
	rowMenu: HistoryRowMenu,
	listActions: HistoryListActions,
	inspector: [FIRES_TAB, REFERENCES_TAB, SCENES_TAB],
	emptyCopy: {
		title: "No history yet",
		body: "History is the story's own timeline: what happened, dated, in the order it happened.",
		action: "New history entry"
	},
	creatable: true,
	newLabel: "New history entry",
	newDraft: (lorebookId) => ({
		typeId: HISTORY_TYPE_ID,
		lorebookId,
		year: 1,
		month: null,
		day: null,
		content: "",
		keys: "",
		secondaryKeys: "",
		selectiveLogic: null,
		useRegex: false,
		caseSensitive: false,
		constant: false,
		enabled: true,
		isCompleted: false
	}),
	toPoolItem: (source) => ({
		...entryPoolItem(source, HISTORY_TYPE_ID),
		name: formatDate(source as any),
		order: dateValue(source as any),
		// History declares no priority role, and absent means no bonus.
		priority: 0
	}),
	toDraft: entryDraft,
	title: (source) => formatDate(source as any),
	validate: (draft, siblings, warn) => {
		if (!draft.year) {
			if (warn) toaster.error({ title: "Year is required" })
			return false
		}
		if (!!draft.day && !draft.month) {
			if (warn)
				toaster.error({ title: "Month is required if day is set" })
			return false
		}
		if (draft.id == null) return true
		const bounds = editBounds(siblings as any, draft.id)
		const value = dateValue(draft as any)
		if (bounds.min !== -Infinity && value <= bounds.min) {
			if (warn)
				toaster.error({
					title: "Date would be out of order",
					description: `Must be after ${formatDate({ year: Math.floor(bounds.min / 10000), month: Math.floor((bounds.min % 10000) / 100), day: bounds.min % 100 })}`
				})
			return false
		}
		if (bounds.max !== Infinity && value >= bounds.max) {
			if (warn)
				toaster.error({
					title: "Date would be out of order",
					description: `Must be before ${formatDate({ year: Math.floor(bounds.max / 10000), month: Math.floor((bounds.max % 10000) / 100), day: bounds.max % 100 })}`
				})
			return false
		}
		return true
	}
}

const scenes: SectionDescriptor = {
	id: "scenes",
	label: "Scenes",
	icon: Icons.Film,
	kind: SCENE_KIND,
	store: "scenes",
	roles: new Set(["parent"]),
	row: SceneRow,
	editor: SceneEditor,
	inspector: [REFERENCES_TAB],
	emptyCopy: {
		title: "No scenes captured yet",
		body: "A scene is a run of messages saved out of a session. Capture one with Summarize to Lorebook on the session page.",
		action: "Open a session"
	},
	// A scene is captured from a session, never typed from nothing.
	creatable: false,
	newLabel: "New scene",
	newDraft: () => ({}),
	toPoolItem: (source) => ({
		key: `scene#${source.id}`,
		id: source.id,
		kind: SCENE_KIND,
		name: source.name ?? "Unnamed Scene",
		content: source.summary ?? "",
		keys: "",
		pinned: false,
		off: false,
		archived: false,
		// A scene is compiled out of a session by the summarizer; nobody types
		// one from nothing.
		machineWritten: true,
		parentKey: `entry#${source.historyEntryId}`,
		order: source.id,
		position: source.id,
		priority: 0,
		createdAt: timeOf(source.createdAt),
		updatedAt: timeOf(source.updatedAt)
	}),
	toDraft: (source) => ({
		id: source.id,
		name: source.name ?? "",
		summary: source.summary ?? "",
		participantCharacters: [...(source.participantCharacters ?? [])],
		mentionedCharacters: [...(source.mentionedCharacters ?? [])]
	}),
	title: (source) => source.name ?? "Unnamed Scene",
	validate: () => true
}

const all: SectionDescriptor = {
	id: "all",
	label: "All entries",
	icon: Icons.LayoutList,
	store: "entries",
	roles: new Set(),
	row: PoolRow,
	editor: GenericEntryEditor,
	inspector: [FIRES_TAB, REFERENCES_TAB],
	emptyCopy: {
		title: "This lorebook is empty",
		body: "Everything the book knows shows up here. Start anywhere and the other doors are filters over the same list.",
		action: "New world lore"
	},
	creatable: true,
	newLabel: "New entry",
	newDraft: (lorebookId) => namedEntryDraft(lorebookId, WORLD_LORE_TYPE_ID),
	toPoolItem: (source) => entryPoolItem(source, source.typeId ?? ""),
	toDraft: entryDraft,
	title: (source) => source.name ?? "Entry",
	validate: (draft, _siblings, warn) => requireName(draft, warn)
}

export const SECTION_DESCRIPTORS: SectionDescriptor[] = [
	all,
	world,
	characters,
	history,
	scenes
]

/**
 * Every row the BOOK holds, as the pool reads them.
 *
 * ⚠ **The whole book, never one scope's share of it.** A parent, a reference
 * and a delete's cascade are facts about the book: a world entry filed under a
 * history entry is inside it whichever scope the reader happens to be in, and
 * a pool narrowed to one kind answers "nothing is filed under this" about a
 * row that has children. So the editor is handed this rather than the list it
 * is standing next to.
 *
 * Doors without a kind of their own draw no rows here — "All entries" is every
 * other door's rows, and counting it would put each row in twice.
 */
export function bookPoolItems(
	rowsByKind: Record<string, PoolSource[]>,
	scenes: readonly PoolSource[]
): PoolItem[] {
	const out: PoolItem[] = []
	for (const descriptor of SECTION_DESCRIPTORS) {
		if (!descriptor.kind) continue
		const rows =
			descriptor.store === "scenes"
				? scenes
				: (rowsByKind[descriptor.kind] ?? [])
		for (const row of rows) out.push(descriptor.toPoolItem(row))
	}
	return out
}

/** The door a scope opens, or undefined for a scope that draws no pool. */
export function descriptorFor(scope: LoreScope): SectionDescriptor | undefined {
	return SECTION_DESCRIPTORS.find((d) => d.id === scope)
}

/** Whether this door is a scope of its own, or lives inside another one. */
export function isScopeDoor(descriptor: SectionDescriptor): boolean {
	return (LORE_SCOPES as readonly string[]).includes(descriptor.id)
}

/** The editor Cast mounts for a member's anchored lore. */
export const CHARACTER_LORE_DOOR = characters

/** The door that curates one kind of row, wherever that row is listed. */
export function descriptorForKind(kind: string): SectionDescriptor | undefined {
	return SECTION_DESCRIPTORS.find((d) => d.kind === kind)
}

/**
 * The door that owns the row an address names.
 *
 * A narrowed section answers with itself; "All entries" holds several kinds at
 * once, so the row that is open is what says which editor, inspector and title
 * are drawn. A key the pool does not hold keeps the section's own door, which
 * is where a selection that has not arrived yet belongs.
 */
export function doorForKey(
	key: string | null,
	pool: readonly PoolItem[],
	fallback: SectionDescriptor
): SectionDescriptor {
	if (!key) return fallback
	const kind = pool.find((item) => item.key === key)?.kind
	return (kind ? descriptorForKind(kind) : undefined) ?? fallback
}

/**
 * Whether the editor's draft is to be built from the row the address names.
 *
 * The draft follows the address and not the list, so a write from elsewhere
 * never discards what is being typed. The one arrival it does follow is the
 * addressed row's own: an address can name a row before the list holding it
 * has landed, and a draft that is not built when it does leaves the editor
 * empty for as long as the address stands.
 */
export function draftStale(input: {
	/** The address's key, or "new" while a row is being written. */
	key: string | null
	/** The key the draft on screen belongs to. */
	draftKey: string | null
	hasDraft: boolean
	/** Whether the pool holds the row `key` names. */
	hasSource: boolean
}): boolean {
	if (input.key !== input.draftKey) return true
	return !input.hasDraft && input.hasSource
}

/**
 * What the editor column says when nothing is open.
 *
 * Empty copy is about an empty book. A pool with rows in it is a different
 * fact, and answering it with the book's empty copy tells the reader their
 * entries are gone.
 */
export function editorPlaceholder(input: {
	descriptor: SectionDescriptor
	poolEmpty: boolean
	canCreate: boolean
}): string {
	if (input.poolEmpty) return input.descriptor.emptyCopy.title
	return input.canCreate
		? "Pick an entry to edit it, or press New."
		: "Pick an entry to edit it."
}

/**
 * The kinds a door presets. Empty is every kind in the book, which is what
 * makes "All entries" the same list with nothing narrowed.
 */
export function poolKindsOf(descriptor: SectionDescriptor): string[] {
	return descriptor.kind ? [descriptor.kind] : []
}
