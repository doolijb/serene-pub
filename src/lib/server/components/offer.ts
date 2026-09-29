/**
 * The OFFER path of authored components (C6, P2): what `sessions:view` seats
 * and the layout editor lists, beside core's widgets and every enabled
 * plugin's. Read-only and light — no compiler import — because every session
 * view reads it.
 *
 * An authored component is offered as a widget only when ALL of:
 * - the extension subsystem is on (`SP_PLUGINS_ENABLED`, `pluginsEnabled()`);
 * - its enable switch is on;
 * - it has an artifact (`artifact_hash`) — its compiled module, served at
 *   `authoredArtifactSrc` — and its last compile left no error;
 * - that artifact was built for a host contract this host speaks (F1,
 *   `authoredComponentRefusal` over its stored fingerprint).
 * Otherwise it is not offered, rather than offered broken: a layout naming
 * its widget draws it as missing, as a disabled plugin's are, and a re-enable
 * brings the arrangement back.
 *
 * Its shape is a plugin component widget's, under its own owner:
 * `{ id: 'authored.<id>:<slug>', surface: { kind: 'remote', owner:
 * 'authored.<id>', component: <slug> }, src, grants }` — `role` always
 * `secondary` (an authored component never takes the session's anchor), and
 * `grants` only the scopes an admin reviewed and did not deny.
 */
import { and, eq, isNotNull, isNull, asc } from "drizzle-orm"
import { i18nText, pluginWidgetId, type WidgetSectionScope } from "@serene-pub/sdk"
import { authoredComponents, type AuthoredWidgetShape } from "$lib/server/db/schema"
import { pluginsEnabled } from "$lib/server/plugins/flag"
import { authoredComponentRefusal } from "./compat"
import { effectivePermissions, widgetScopePermissions } from "$lib/server/plugins/permissions"
import { authoredArtifactSrc, authoredOwnerId } from "$lib/shared/widgets/authoredOwner"
import { declaredWidgetReads } from "$lib/shared/widgets/reads"

type ModePanel = Sockets.Sessions.View.ModePanel

/**
 * The scopes an authored component's widget may read: those it asks for that
 * an admin reviewed and did not deny — the plugin model's `declared − denied −
 * unreviewed`, over the one spelling of a widget-scope permission.
 */
export function authoredGrants(
	widget: Pick<AuthoredWidgetShape, "scopes">,
	adminDenied: string[] | null | undefined
): WidgetSectionScope[] {
	return effectivePermissions(widgetScopePermissions(widget.scopes), adminDenied).map(
		(p) => p.key.slice("widget:".length) as WidgetSectionScope
	)
}

/** The widget id an authored component is seated under: `authored.<id>:<slug>`. */
export const authoredWidgetId = (id: string, slug: string): string => pluginWidgetId(authoredOwnerId(id), slug)

/**
 * The rows that may be offered right now, by slug — empty with the subsystem
 * off, and without any whose artifact was built for a host contract this host
 * does not speak (F1, `authoredComponentRefusal`).
 */
async function offerableRows(db: Db) {
	if (!pluginsEnabled()) return []
	const rows = await db
		.select()
		.from(authoredComponents)
		.where(
			and(
				eq(authoredComponents.enabled, true),
				isNotNull(authoredComponents.artifactHash),
				isNull(authoredComponents.lastError)
			)
		)
		.orderBy(asc(authoredComponents.slug))
	return rows.filter((r) => !authoredComponentRefusal(r.fingerprint))
}

/** Every authored component offered as a widget, in `sessions:view.modePanels`' shape. */
export async function offeredAuthoredWidgets(db: Db, language = "en"): Promise<ModePanel[]> {
	const out: ModePanel[] = []
	for (const r of await offerableRows(db)) {
		const w = r.widget
		const id = authoredWidgetId(r.id, r.slug)
		const grants = authoredGrants(w, r.adminDenied)
		out.push({
			id,
			title: i18nText(w.title, language) ?? r.slug,
			...(typeof w.icon === "string" ? { icon: w.icon } : {}),
			role: "secondary",
			surface: { kind: "remote", owner: authoredOwnerId(r.id), component: r.slug },
			src: authoredArtifactSrc(r.id, r.artifactHash!),
			...(Array.isArray(w.channels) ? { channels: w.channels } : {}),
			...(w.settings ? { settings: w.settings } : {}),
			...(Array.isArray(w.reads) ? { reads: declaredWidgetReads(w.reads) } : {}),
			...(grants.length ? { grants } : {}),
			defaultActive: !!w.defaultActive
		})
	}
	return out
}

/**
 * The widget ids of every OFFERED authored component — for the writes keyed
 * on a widget id (`seatableWidgetIds`, a widget style) that must refuse an id
 * no session would seat. The same filter as {@link offeredAuthoredWidgets}.
 */
export async function offeredAuthoredWidgetIds(db: Db): Promise<Set<string>> {
	return new Set((await offerableRows(db)).map((r) => authoredWidgetId(r.id, r.slug)))
}

/**
 * The artifact URL an authored component is offered under right now, or
 * `null` when it is not offered (subsystem off, switched off, uncompiled, its
 * last compile failed, or its artifact was built for a host contract this
 * host does not speak — F1) — the `src` a `components:changed` carries.
 */
export function offeredAuthoredSrc(
	row: Pick<typeof authoredComponents.$inferSelect, "id" | "enabled" | "artifactHash" | "lastError" | "fingerprint">
): string | null {
	if (!pluginsEnabled() || !row.enabled || !row.artifactHash || row.lastError) return null
	if (authoredComponentRefusal(row.fingerprint)) return null
	return authoredArtifactSrc(row.id, row.artifactHash)
}
