/**
 * THE lens registry — every lens the lorebook workspace offers, declared once.
 *
 * The lens row draws it, the workspace mounts from it (`mounts.ts`), day one
 * steps aside by it, a scope or saved scope or the Loose ends queue picks its
 * lens by it, and the graph workspace asks it which canvas a lens is. Adding
 * a lens is: its id in `LORE_LENSES` (the route's vocabulary, shared with the
 * server), a descriptor here, and — only when it draws a screen no lens draws
 * yet — a mount in `mounts.ts`.
 *
 * Every lens stands in every book and for every scope: a lens with nothing to
 * draw shows its own empty state rather than being taken away, because a
 * control that vanishes teaches the reader the capability does not exist.
 *
 * ⚠ Pure data — no lens screen is imported here (see `types.ts`), so a lens
 * screen may read its own descriptor (its empty copy) without a cycle.
 */

import * as Icons from "@lucide/svelte"
import {
	LORE_LENSES,
	type LoreLens,
	type LoreScope
} from "$lib/shared/lorebooks/loreRoute"
import type { LoreDrawing } from "../graphs"
import type { LensDescriptor } from "./types"

const draws = (): "draws" => "draws"
const ignores = (): "ignores" => "ignores"

/**
 * Keyed by id so the compiler refuses a lens the route knows and the registry
 * does not (`satisfies Record<LoreLens, …>`); ordered by `LORE_LENSES` below,
 * which is the lens row's order.
 */
const BY_ID = {
	list: {
		id: "list",
		label: "List",
		icon: Icons.List,
		mount: "pool",
		drawsScope: draws,
		listsPool: true,
		holdsQueue: true,
		bypassesDayOne: false,
		reads: ["rawRows", "allScenes", "cast", "suggestions", "duplicates"],
		shortcut: "Alt+Shift+1"
	},
	cards: {
		id: "cards",
		label: "Cards",
		icon: Icons.LayoutGrid,
		mount: "pool",
		drawsScope: draws,
		listsPool: true,
		bypassesDayOne: false,
		reads: ["rawRows", "allScenes", "cast", "suggestions", "duplicates"],
		shortcut: "Alt+Shift+2"
	},
	tree: {
		id: "tree",
		label: "Tree",
		icon: Icons.ListTree,
		mount: "pool",
		drawsScope: draws,
		listsPool: true,
		bypassesDayOne: false,
		reads: ["rawRows", "allScenes", "cast", "suggestions", "duplicates"],
		shortcut: "Alt+Shift+3"
	},
	graph: {
		id: "graph",
		label: "Graph",
		icon: Icons.Network,
		mount: "drawing",
		// The scope narrows the graph's denominator (`scopeEntries`).
		drawsScope: draws,
		listsPool: false,
		bypassesDayOne: true,
		drawing: "relationships",
		reads: ["rows", "rawRows", "scenes", "allScenes"],
		empty: {
			message:
				"No graph yet. Build one from your scenes and history to pull out who is connected to whom."
		},
		shortcut: "Alt+Shift+4"
	},
	time: {
		id: "time",
		label: "Time",
		icon: Icons.History,
		mount: "time",
		// The line is the scope's (#88): `timeLensEntries`.
		drawsScope: draws,
		listsPool: false,
		bypassesDayOne: true,
		reads: ["rows", "scenes", "cast"],
		empty: {
			message:
				"Nothing is dated yet. Add a dated entry and it becomes a point on this line."
		},
		shortcut: "Alt+Shift+5"
	},
	lives: {
		id: "lives",
		label: "Lives",
		icon: Icons.Footprints,
		mount: "lives",
		// Every member who has been placed, whatever the scope.
		drawsScope: ignores,
		listsPool: false,
		bypassesDayOne: true,
		reads: ["rows"],
		empty: {
			message:
				"Nobody has been placed on the line yet. Say when a cast member is in the world — and at what point of their own life — and their run appears here."
		},
		shortcut: "Alt+Shift+6"
	},
	places: {
		id: "places",
		label: "Places",
		icon: Icons.Map,
		mount: "drawing",
		// Every place on the line, whatever the scope (places plan B4).
		drawsScope: ignores,
		listsPool: false,
		bypassesDayOne: true,
		drawing: "places",
		reads: ["rows", "rawRows", "scenes", "allScenes"],
		empty: {
			message:
				"No places yet. A place is somewhere the story can be: a room, a town, a road you could stand in."
		},
		shortcut: "Alt+Shift+7"
	}
} as const satisfies Record<LoreLens, LensDescriptor>

/** Every lens, in the lens row's order. */
export const LORE_LENS_REGISTRY: readonly LensDescriptor[] = LORE_LENSES.map(
	(id) => BY_ID[id]
)

/** One lens's descriptor. */
export function lensDescriptor(id: LoreLens): LensDescriptor {
	return BY_ID[id]
}

/**
 * What a lens says when it has nothing to draw — its descriptor's `empty`.
 * The pool lenses declare none (an empty pool says its scope's copy), so
 * they answer "" — the registry test pins every lens that draws its own
 * empty state to a sentence.
 */
export function lensEmptyMessage(id: LoreLens): string {
	return lensDescriptor(id).empty?.message ?? ""
}

/** The lens the Loose ends queue is drawn on. */
export const QUEUE_LENS: LoreLens = LORE_LENS_REGISTRY.find(
	(d) => d.holdsQueue
)!.id

/** What a lens does with a scope (see `LensScopeRule`). */
export function lensDrawsScope(lens: LoreLens, scope: LoreScope) {
	return lensDescriptor(lens).drawsScope(scope)
}

/** Whether a saved scope can narrow what this lens draws. */
export function lensListsPool(lens: LoreLens): boolean {
	return lensDescriptor(lens).listsPool
}

/**
 * The canvas a lens draws, or null for the lenses that draw the pool, the
 * Time lens's lanes and Lives' runs.
 *
 * ⚠ `places` draws the book's places on the lore graph canvas (plan
 * places-graph B4, `places/placeGraph.ts`): every `core:entry/location` entry
 * on the line being read, resolved as of the moment (archived ones left out,
 * the one definition the rail's Places count uses too), each a node whether
 * or not anything joins it; every relationship with a place at an end is an
 * edge, and the cast members and other lore it joins come with it.
 */
export function drawingForLens(lens: LoreLens): LoreDrawing | null {
	return lensDescriptor(lens).drawing ?? null
}

/** Why a lens cannot be drawn yet, or null while it can. */
export function lensReason(lens: LoreLens): string | null {
	return lensDescriptor(lens).reason?.() ?? null
}

const MODIFIERS = ["Alt", "Shift", "Control", "Meta"] as const

/** A shortcut's parts: its modifiers and its one key. */
function parseShortcut(shortcut: string) {
	const parts = shortcut.split("+")
	const key = parts.pop() ?? ""
	return { mods: new Set(parts), key }
}

/**
 * Whether a key press is this shortcut. The key is matched by its physical
 * code (`Digit4`, `KeyG`), because Option on a Mac rewrites `event.key` into
 * another character (⌥⇧4 types `›`).
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
	const { mods, key } = parseShortcut(shortcut)
	const held = {
		Alt: event.altKey,
		Shift: event.shiftKey,
		Control: event.ctrlKey,
		Meta: event.metaKey
	}
	for (const mod of MODIFIERS) if (held[mod] !== mods.has(mod)) return false
	const code = /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`
	return event.code === code
}

/** Whether a key press landed where typing goes, which a shortcut leaves alone. */
function typingTarget(target: EventTarget | null): boolean {
	if (!target || typeof (target as HTMLElement).closest !== "function")
		return false
	const el = target as HTMLElement
	return (
		el.isContentEditable ||
		!!el.closest("input, textarea, select, [contenteditable='true']")
	)
}

/**
 * The lens a key press asks for, or null. Not while typing in a field, and
 * not a key somebody closer to the action already claimed.
 */
export function lensForKey(event: KeyboardEvent): LoreLens | null {
	if (event.defaultPrevented || event.repeat) return null
	if (typingTarget(event.target)) return null
	return (
		LORE_LENS_REGISTRY.find((d) => matchesShortcut(event, d.shortcut))?.id ??
		null
	)
}

const MAC_GLYPHS: Record<string, string> = {
	Alt: "⌥",
	Shift: "⇧",
	Control: "⌃",
	Meta: "⌘"
}

/** A shortcut as a person reads it: `Alt+Shift+4`, or `⌥⇧4` on a Mac. */
export function shortcutLabel(shortcut: string, mac: boolean): string {
	if (!mac) return shortcut
	const { mods, key } = parseShortcut(shortcut)
	return `${MODIFIERS.filter((m) => mods.has(m))
		.map((m) => MAC_GLYPHS[m])
		.join("")}${key}`
}

