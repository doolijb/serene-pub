/**
 * Who may do what to a **session layout preset** (session layout v2 §4.5) —
 * four pure predicates, and the whole matrix in one place.
 *
 * | action | core / plugin row | shared user row | private user row |
 * |---|---|---|---|
 * | see, apply, clone, set as my default | everyone | everyone | the author |
 * | edit, rename, share | nobody | author, admin | the author |
 * | delete | nobody | author, admin | the author |
 *
 * ## The two questions, kept apart
 *
 * **Visibility** answers who may SEE and USE a row; **management** answers who
 * may change it. They are not the same question, and an admin is a superset of
 * the second one ONLY — a private layout is a person's own business, and an
 * admin who could list everybody's would be reading over their shoulder. This
 * is `sockets/widgetStyles.ts`'s ruled matrix, reused verbatim.
 *
 * ## Why core and plugin rows are managed by nobody
 *
 * A reconciler owns them. An edit an administrator made here would be silently
 * undone by the next boot (core) or the next enable (plugin), leaving them sure
 * they had changed something. Clone instead — seeing a row is the whole
 * permission cloning needs, because a clone snapshots and keeps no reference
 * back.
 *
 * ## Withdrawn rows answer nothing
 *
 * A plugin that is disabled or uninstalled marks its rows `withdrawn_at` rather
 * than deleting them (a session names its preset). A withdrawn row is not seen,
 * not applied, not cloned and not resolved — it is simply not there until the
 * plugin comes back, and then it is exactly where it was.
 *
 * Pure and synchronous on purpose: every refusal sentence, and the ORDER the
 * refusals are made in (privacy first — see `layoutPresets.ts`), belongs to the
 * caller. These only answer yes or no.
 */

/** The origin triple, as the column spells it. */
export type LayoutPresetOrigin = "core" | "plugin" | "user"

/**
 * The columns a permission question needs — a structural subset of the row, so
 * a caller with a projection (and a test with a literal) can ask without
 * carrying a whole row's worth of json.
 */
export interface LayoutPresetOwnership {
	origin: string
	authorUserId: number | null
	visibility: string
	withdrawnAt: Date | null
}

/**
 * Who is asking.
 *
 * `isGuest` is the ONE session-scoped fact in an otherwise account-scoped
 * model: a layout preset belongs to a genre, not to a session, but a person
 * reaches the save and share verbs THROUGH a session, and the ruled matrix
 * says a guest may apply anything they can see and create private rows of
 * their own while never publishing one to the instance. The caller that has a
 * session in hand sets it (`checkSessionAccess(...).isGuest`); one that does
 * not leaves it absent, which reads as "not acting as a guest".
 */
export interface LayoutActor {
	id: number
	isAdmin?: boolean
	isGuest?: boolean
}

/** A shipped row — core's or a plugin's. Nobody manages one here. */
export function isShippedLayoutPreset(row: LayoutPresetOwnership): boolean {
	return row.origin === "core" || row.origin === "plugin"
}

/**
 * May this person see, apply, clone or default to this row?
 *
 * Note what is NOT here: `isAdmin`. Management is a superset of authorship;
 * visibility is not.
 */
export function canSee(row: LayoutPresetOwnership, actor: LayoutActor): boolean {
	if (row.withdrawnAt) return false
	if (isShippedLayoutPreset(row)) return true
	// A user row: shared is instance-wide, private is the author's alone.
	if (row.authorUserId === actor.id) return true
	return row.visibility === "shared"
}

/** May this person rename, re-capture or delete this row? */
export function canManage(
	row: LayoutPresetOwnership,
	actor: LayoutActor
): boolean {
	if (row.withdrawnAt) return false
	// Reconciler-owned. Not even an admin — a reseed would undo it.
	if (isShippedLayoutPreset(row)) return false
	if (row.authorUserId === actor.id) return true
	// Somebody else's: an admin manages what the instance can already see.
	return row.visibility === "shared" && !!actor.isAdmin
}

/**
 * May this person change this row's visibility?
 *
 * Management plus the one thing a guest may not do. Publishing a layout to the
 * whole instance is the act a guest is refused; keeping and editing their own
 * is not.
 */
export function canShare(
	row: LayoutPresetOwnership,
	actor: LayoutActor
): boolean {
	if (actor.isGuest) return false
	return canManage(row, actor)
}

/**
 * May this person clone this row?
 *
 * Seeing it is the whole permission: a clone is a new private row of the
 * caller's that SNAPSHOTS the document and keeps no reference back, so the
 * original moving does not move the copy and nothing is taken from its owner.
 * This is how a built-in becomes editable.
 */
export function canClone(
	row: LayoutPresetOwnership,
	actor: LayoutActor
): boolean {
	return canSee(row, actor)
}
