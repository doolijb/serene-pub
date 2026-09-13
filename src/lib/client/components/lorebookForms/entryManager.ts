/**
 * The shared 80% of the three lore managers.
 *
 * World Lore, Character Lore and History stay **distinct named tabs with
 * curated editors** — that is the presentation ruling and it is not negotiable:
 * generic-entity *data models* succeed routinely and generic-entity
 * *presentation* fails with near-perfect consistency, so the rule is **named
 * front doors, always**, and the words "entry type" never appear in the UI.
 * What the three managers were duplicating was never the view. It was the
 * plumbing: the same eight sort keys, the same three-field search, the same
 * `{{char:N}}` substitution for the preview, the same six socket listeners
 * registered on mount and torn down on destroy, and the same five emits.
 *
 * So this module is **logic, not a component**. Each manager keeps its own
 * reactive state (which is what makes its markup readable), its own editor, and
 * its own idea of what a row looks like; it borrows the parts that were
 * identical three times over. A fourth tab reuses this and writes its own view,
 * which is exactly the trade the presentation ruling asks for.
 */

import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { EntryTypeId, LorebookEntry } from "$lib/shared/entries/types"

/** A binding with the character/persona it names, as the lists send it. */
export type BindingWithRelations = SelectLorebookBinding & {
	character?: { nickname?: string | null; name: string } | null
	persona?: { name: string } | null
}

type SortableEntry = {
	constant?: boolean | null
	priority?: number | null
	createdAt?: string | Date | null
	updatedAt?: string | Date | null
	position?: number | null
}

/**
 * The lore toolbar's comparator.
 *
 * ⚠ **Pinned wins over priority, and only over priority.** Both priority
 * orderings put constant entries at their end first, because a pinned entry is
 * in the prompt whatever it scored and a list sorted by importance that buries
 * it is lying. The date and position orderings say nothing about importance, so
 * they do not.
 *
 * History does not use this — it orders by its own date, which is what its
 * `order` role declares — and that is why the comparator is a parameter of the
 * list rather than a property of it.
 */
export function compareEntriesBy(
	orderBy: string
): (a: SortableEntry, b: SortableEntry) => number {
	const pinned = (e: SortableEntry) => (e.constant ? 1 : 0)
	const priority = (e: SortableEntry) => e.priority || 1
	const created = (e: SortableEntry) => new Date(e.createdAt || 0).getTime()
	const updated = (e: SortableEntry) => new Date(e.updatedAt || 0).getTime()
	const position = (e: SortableEntry) =>
		typeof e.position === "number" ? e.position : 0

	return (a, b) => {
		switch (orderBy) {
			case "position-asc":
				return position(a) - position(b)
			case "position-desc":
				return position(b) - position(a)
			case "priority-desc":
				if (pinned(a) !== pinned(b)) return pinned(b) - pinned(a)
				return priority(b) - priority(a)
			case "priority-asc":
				if (pinned(a) !== pinned(b)) return pinned(a) - pinned(b)
				return priority(a) - priority(b)
			case "created-desc":
				return created(b) - created(a)
			case "created-asc":
				return created(a) - created(b)
			case "updated-desc":
				return updated(b) - updated(a)
			case "updated-asc":
				return updated(a) - updated(b)
			default:
				return 0
		}
	}
}

/**
 * The toolbar search: name, content, keys, case-insensitively.
 *
 * An empty query returns the list unfiltered rather than an empty one, which is
 * the difference between a search box and a wall.
 */
export function filterEntriesBySearch<
	T extends { name?: string | null; content?: string | null; keys?: string }
>(entries: readonly T[], search: string): T[] {
	const needle = search.trim().toLowerCase()
	if (!needle) return [...entries]
	return entries.filter(
		(e) =>
			(e.name || "").toLowerCase().includes(needle) ||
			(e.content || "").toLowerCase().includes(needle) ||
			(e.keys || "").toLowerCase().includes(needle)
	)
}

/**
 * `{{char:N}}` → the bound character's name, for the preview only.
 *
 * The stored content keeps the token — this is what the *reader* sees, and the
 * server does the same substitution again on its own way to the model
 * (`populateLorebookEntryBindings`). A binding that names nobody renders as
 * itself, which is the honest answer for a slot nobody has filled.
 */
export function substituteBindings(
	content: string | null | undefined,
	bindings: readonly BindingWithRelations[]
): string {
	let out = content || ""
	for (const binding of bindings) {
		if (binding.characterId)
			out = out.replaceAll(
				binding.binding,
				binding.character?.nickname ||
					binding.character?.name ||
					binding.binding
			)
		else if (binding.personaId)
			out = out.replaceAll(
				binding.binding,
				binding.persona?.name || binding.binding
			)
	}
	return out
}

/** What a manager wants told to it, and when. */
export interface EntrySocketHandlers<T extends EntryTypeId> {
	/** The full list for this tab's type arrived. */
	onList: (entries: LorebookEntry<T>[]) => void | Promise<void>
	/** The lorebook's bindings arrived — the preview and the pickers need them. */
	onBindings?: (bindings: BindingWithRelations[]) => void | Promise<void>
	/** One row's vector state changed underneath us. */
	onVectorized?: (id: number, embeddingModel: string | null) => void
	/** A create/update/delete acknowledgement, for the toast. */
	onCreated?: (entry: LorebookEntry<T>) => void
	onUpdated?: (entry: LorebookEntry<T>) => void
	onDeleted?: () => void
	onReordered?: () => void
}

/**
 * One tab's whole conversation with the server.
 *
 * ⚠ **Every listener is filtered to this tab's `lorebookId` and `typeId`.**
 * There is one namespace now, so a History tab and a World Lore tab open in the
 * same session receive each other's `entries:list` — which is precisely the
 * thing the three separate namespaces used to prevent by accident, and the
 * thing this has to prevent on purpose.
 *
 * `vectorization:itemUpdated` keys on the ranking band rather than the type id,
 * because that is the vocabulary the vectorizer reports in; `sourceKind` is the
 * translation and the caller supplies it.
 */
export function entryChannel<T extends EntryTypeId>(
	socket: TypedSocket,
	opts: {
		lorebookId: number
		typeId: T
		/** The `sourceKind` the vectorizer reports this type's rows under. */
		vectorSource: string
		handlers: EntrySocketHandlers<T>
	}
) {
	const { lorebookId, typeId, vectorSource, handlers } = opts

	const onList = async (msg: Sockets.Entries.List.Response) => {
		if (msg.lorebookId !== lorebookId || msg.typeId !== typeId) return
		await handlers.onList(msg.entryList as LorebookEntry<T>[])
	}
	const onCreated = (msg: Sockets.Entries.Create.Response) => {
		if (
			msg.entry?.lorebookId !== lorebookId ||
			msg.entry?.typeId !== typeId
		)
			return
		handlers.onCreated?.(msg.entry as LorebookEntry<T>)
	}
	const onUpdated = (msg: Sockets.Entries.Update.Response) => {
		if (
			msg.entry?.lorebookId !== lorebookId ||
			msg.entry?.typeId !== typeId
		)
			return
		handlers.onUpdated?.(msg.entry as LorebookEntry<T>)
	}
	const onDeleted = (msg: Sockets.Entries.Delete.Response) => {
		if (msg.success) handlers.onDeleted?.()
	}
	const onReordered = (msg: Sockets.Entries.UpdatePositions.Response) => {
		if (msg.success) handlers.onReordered?.()
	}
	const onBindings = async (msg: Sockets.Lorebooks.BindingList.Response) => {
		if (msg.lorebookId !== lorebookId) return
		await handlers.onBindings?.(
			msg.lorebookBindingList as BindingWithRelations[]
		)
	}
	const onVectorized = (msg: Sockets.Vectorization.ItemUpdated.Response) => {
		if (msg.type !== vectorSource || msg.lorebookId !== lorebookId) return
		handlers.onVectorized?.(msg.id, msg.embeddingModel)
	}

	const list = () => socket.emit("entries:list", { lorebookId, typeId })

	return {
		/** Subscribe, then ask for both lists. Call from `onMount`. */
		open() {
			socket.on("entries:list", onList)
			socket.on("entries:create", onCreated)
			socket.on("entries:update", onUpdated)
			socket.on("entries:delete", onDeleted)
			socket.on("entries:updatePositions", onReordered)
			socket.on("lorebooks:bindingList", onBindings)
			socket.on("vectorization:itemUpdated", onVectorized)
			list()
			socket.emit("lorebooks:bindingList", { lorebookId })
		},
		/** Call from `onDestroy`. Every `on` above has its `off` here. */
		close() {
			socket.off("entries:list", onList)
			socket.off("entries:create", onCreated)
			socket.off("entries:update", onUpdated)
			socket.off("entries:delete", onDeleted)
			socket.off("entries:updatePositions", onReordered)
			socket.off("lorebooks:bindingList", onBindings)
			socket.off("vectorization:itemUpdated", onVectorized)
		},
		list,
		create(entry: Record<string, unknown>) {
			socket.emit("entries:create", {
				entry: { ...entry, typeId, lorebookId } as any
			})
		},
		update(entry: Record<string, unknown> & { id: number }) {
			socket.emit("entries:update", {
				entry: { ...entry, typeId } as any
			})
		},
		remove(id: number) {
			socket.emit("entries:delete", { id, typeId })
		},
		/** A whole permutation, renumbered 1..n by the caller. */
		reorder(positions: Array<{ id: number; position: number }>) {
			socket.emit("entries:updatePositions", {
				lorebookId,
				typeId,
				positions
			})
		}
	}
}
