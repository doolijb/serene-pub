/**
 * Admin records facing their rail door (2026-10-11 Models/Admin bridge,
 * lane C; split into two views by plan 2026-10-11 Models / Connections):
 * **Open in Models**, **Open in Connections** and **Open in Sampling**.
 * Admin is purely a view (STYLE-GUIDE §6.11), so a link out opens the
 * person's view through `panelsCtx` — it never navigates the page. The
 * reverse door, `openInPipelines`, opens Admin › Pipelines itself.
 *
 * The digest doors are the views' own: `connectionsJob` opens one job's
 * sheet in the Models view (a transform id, `text->text` for chat);
 * `connectionId` lands the Connections view on one connection.
 */

import { adminRouter } from "$lib/client/admin/adminRouter.svelte"

type DoorCtx = Pick<PanelsCtx, "digest" | "openPanel">

/** Where the Models view should land. Nothing given → its list. */
export interface ModelsDoor {
	connectionsJob?: string
}

/**
 * Open the Models view (rail key `models`) at `door`.
 *
 * Since I12 a job's sheet is a LOADOUT sheet and lives in the Loadouts view,
 * so a door naming a job opens Loadouts on that transform's default loadout
 * (`openInLoadouts`); the Models view is inventory.
 */
export function openInModels(ctx: DoorCtx | undefined, door: ModelsDoor = {}) {
	if (!ctx) return
	if (door.connectionsJob) return openInLoadouts(ctx, { job: door.connectionsJob })
	ctx.openPanel({ key: "models", toggle: false })
}

/** Where the Loadouts view should land (I12). Nothing given → its grid. */
export interface LoadoutsDoor {
	/** A transform id: open its default loadout's sheet. */
	job?: string
	/** A loadout row id: open its sheet. */
	loadoutId?: number
}

/** Open the Loadouts view (rail key `loadouts`) at `door`. Admin-only view. */
export function openInLoadouts(ctx: DoorCtx | undefined, door: LoadoutsDoor = {}) {
	if (!ctx) return
	if (door.job) ctx.digest.connectionsJob = door.job
	if (door.loadoutId != null) ctx.digest.loadoutId = door.loadoutId
	ctx.openPanel({ key: "loadouts", toggle: false })
}

/** Where the Connections view should land. Nothing given → its list. */
export interface ConnectionsDoor {
	connectionId?: number
}

/** Open the Connections view (rail key `connections`) at `door`. */
export function openInConnections(
	ctx: DoorCtx | undefined,
	door: ConnectionsDoor = {}
) {
	if (!ctx) return
	if (door.connectionId != null) ctx.digest.connectionId = door.connectionId
	ctx.openPanel({ key: "connections", toggle: false })
}

/** The slice of the Sampling view's memory the door drives. */
export interface SamplingMemoryDoor {
	selectedId: number | null
}

/**
 * Open the Sampling view on one config (owner 2026-10-11: the Sampling view
 * stays; it is where a config is edited). The view reads its module-scoped
 * memory on mount, so the pick is written there first.
 */
export function openInSampling(
	ctx: DoorCtx | undefined,
	memory: SamplingMemoryDoor,
	configId: number | null
) {
	if (!ctx) return
	memory.selectedId = configId
	ctx.openPanel({ key: "sampling", toggle: false })
}

/** Where Admin › Pipelines should land. Nothing given → its list. */
export interface PipelinesDoor {
	slug?: string | null
}

/**
 * Open **Admin › Pipelines** — the one home of pipelines since the Pipelines
 * rail view was retired (2026-10-12, plan image-generation §15: prompts stay
 * behind Admin). A slug lands on that pipeline's page; nothing, the list.
 * Address first, then open (`openJumpHit`'s rule).
 */
export function openInPipelines(
	ctx: DoorCtx | undefined,
	door: PipelinesDoor = {}
) {
	if (!ctx) return
	void adminRouter.go(pipelinesAdminHref(door))
	ctx.openPanel({ key: "admin", toggle: false })
}

/** The Admin › Pipelines address a door lands on. */
export function pipelinesAdminHref(door: PipelinesDoor = {}): string {
	return door.slug
		? `/admin/pipelines/${encodeURIComponent(door.slug)}`
		: "/admin/pipelines"
}
