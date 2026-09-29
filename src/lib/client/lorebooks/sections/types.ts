import type { Component } from "svelte"
import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
import type { LoreScope } from "$lib/shared/lorebooks/loreRoute"
import type { PoolItem } from "../poolFilter"

/**
 * What a named front door declares about itself.
 *
 * The workspace has one list, one editor frame, one row frame, one delete flow
 * and one unsaved-changes guard; a section supplies the parts that are
 * genuinely its own — what a row of it reads like, what its editor asks for,
 * what to say when it is empty — and inherits everything else. A section that
 * supplies none of those renders as the generic placeholder, which is a
 * bootstrap for a kind nobody has curated yet and never a destination:
 * `sections.test.ts` is the alarm on one shipping that way by accident.
 */

/** A row as the wire sent it — a lorebook entry, or a scene. */
export type PoolSource = Record<string, any>

/**
 * What a door is called.
 *
 * Usually a scope. `characters` is the exception the Cast ruling makes: a
 * member's page lists the lore anchored to them, so Character Lore curates a
 * kind of the pool without being a door in the navigation. Its rows still show
 * up in All entries and still get its curated row and editor — the descriptor
 * is what the editor inside Cast is, too.
 */
export type DoorId = LoreScope | "characters"

export interface EntryRowProps {
	item: PoolItem
	source: PoolSource
	bindings: BindingWithRelations[]
	vectorizationEnabled: boolean
}

export interface EntryEditorProps {
	lorebookId: number
	/** The draft the frame owns. An editor mutates it in place. */
	draft: Record<string, any>
	/** The saved row behind the draft, or null while creating. */
	source: PoolSource | null
	isNew: boolean
	bindings: BindingWithRelations[]
	vectorizationEnabled: boolean
	/** Every row of this section, for an editor whose rules span the list. */
	siblings: PoolSource[]
	/** Draws this scope through the graph lens. */
	onNavigateToGraph?: () => void
}

/** A tab of the editor's inspector. The tabs themselves arrive with W3. */
export interface InspectorTab {
	id: string
	label: string
}

export interface SectionDescriptor {
	id: DoorId
	label: string
	icon: Component<any>
	/** The declared type this door writes. Absent for scenes and for the pool. */
	typeId?: string
	/**
	 * The pool kind this door presets. A door with none is the whole pool,
	 * which is what makes "All entries" the same list with nothing narrowed.
	 */
	kind?: string
	/** Which table a row of this kind is written back to. */
	store: "entries" | "scenes"
	/**
	 * The band the vectorizer reports this kind's rows under, which is the
	 * ranking vocabulary rather than the type id.
	 */
	vectorSource?: string
	roles: ReadonlySet<"position" | "order" | "anchor" | "parent">
	row: Component<EntryRowProps>
	editor: Component<EntryEditorProps>
	/** Extra items in a row's menu, beside the shared Edit and Delete. */
	rowMenu?: Component<{ source: PoolSource; close: () => void }>
	/** An action over the whole list, in the toolbar beside the sort. */
	listActions?: Component<{ sources: PoolSource[] }>
	inspector: InspectorTab[]
	emptyCopy: { title: string; body: string; action: string }
	/** A door whose rows are made elsewhere offers no New. */
	creatable: boolean
	/** What the New button offers for this door. */
	newLabel: string
	/** A blank row, as this door states it. */
	newDraft: (lorebookId: number) => Record<string, any>
	/** One wire row, as the pool reads it. */
	toPoolItem: (source: PoolSource) => PoolItem
	/** One wire row, as its editor edits it. */
	toDraft: (source: PoolSource) => Record<string, any>
	/** What a heading calls one row. */
	title: (source: PoolSource) => string
	/**
	 * Whether a draft can be saved. `warn` toasts the reason, so the same rule
	 * disables the Save button and explains a rejected press.
	 */
	validate: (
		draft: Record<string, any>,
		siblings: PoolSource[],
		warn?: boolean
	) => boolean
}
