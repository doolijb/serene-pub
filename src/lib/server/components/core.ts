/**
 * Core's components as an admin reads and clones them (C6, P4).
 *
 * Core declares its components through the public API (`CORE_COMPONENTS`,
 * `@serene-pub/core-catalog`), and its build writes each one's source beside
 * the module: `dist/components/<slug>.source.json` (`CoreComponentSource`).
 * Those files are inlined here with `?raw` — as `/core-ui` inlines the
 * modules — so production reads exactly what development does, and nothing
 * is read from disk at run time. Loaded on first ask, not at boot.
 *
 * `messages` is view-only (`CORE_VIEW_ONLY_COMPONENTS`, owner ruling Q3): its
 * source is readable, but a clone could never have the core trust it runs
 * on, so it is never cloned.
 */
import {
	CORE_COMPONENTS,
	CORE_VIEW_ONLY_COMPONENTS,
	CORE_WIDGETS,
	type CoreComponentSource
} from "@serene-pub/core-catalog"
import type { AuthoredWidgetShape } from "$lib/server/db/schema"

/**
 * One loader per core component. A test pins these keys to
 * `CORE_COMPONENTS`, so a component core adds cannot go unlisted here.
 */
const SOURCES: Readonly<Record<string, () => Promise<{ default: string }>>> = {
	messages: () => import("@serene-pub/core-catalog/components/messages.source.json?raw"),
	"world-state": () => import("@serene-pub/core-catalog/components/world-state.source.json?raw"),
	stats: () => import("@serene-pub/core-catalog/components/stats.source.json?raw"),
	"lore-entries": () => import("@serene-pub/core-catalog/components/lore-entries.source.json?raw"),
	"scene-portraits": () => import("@serene-pub/core-catalog/components/scene-portraits.source.json?raw")
}

/** The slugs this module can load a source for — for the test that pins it to `CORE_COMPONENTS`. */
export const CORE_SOURCE_SLUGS: readonly string[] = Object.keys(SOURCES)

const loaded = new Map<string, Promise<CoreComponentSource>>()

/** A core component's source, or `undefined` when core has no component by that slug. */
export async function coreComponentSource(slug: string): Promise<CoreComponentSource | undefined> {
	if (!CORE_COMPONENTS.some((c) => c.slug === slug) || !Object.hasOwn(SOURCES, slug)) return undefined
	let p = loaded.get(slug)
	if (!p) {
		p = SOURCES[slug]!().then((m) => JSON.parse(m.default) as CoreComponentSource)
		loaded.set(slug, p)
		p.catch(() => loaded.delete(slug))
	}
	return p
}

/** Whether an admin may clone this core component (it exists and is not view-only). */
export const isCloneableCoreComponent = (slug: string): boolean =>
	CORE_COMPONENTS.some((c) => c.slug === slug) && !CORE_VIEW_ONLY_COMPONENTS.includes(slug)

export interface CoreComponentSummary {
	slug: string
	title: string
	framework: string
	cloneable: boolean
	sourceHash: string
}

/** Every core component, as the admin's list shows it. */
export async function coreComponentList(): Promise<CoreComponentSummary[]> {
	return Promise.all(
		CORE_COMPONENTS.map(async (c) => ({
			slug: c.slug,
			title: typeof c.label === "string" ? c.label : (c.label?.en ?? c.slug),
			framework: c.framework ?? "svelte",
			cloneable: isCloneableCoreComponent(c.slug),
			sourceHash: (await coreComponentSource(c.slug))?.sourceHash ?? ""
		}))
	)
}

/**
 * The declaration a clone starts from: the core widget that renders this
 * component, reduced to what an authored widget may declare — never its id,
 * role, placement or presets (a clone is a NEW widget, owner ruling Q2).
 */
export function coreWidgetShape(slug: string): AuthoredWidgetShape | undefined {
	const w = CORE_WIDGETS.find((x) => x.component === slug)
	if (!w) return undefined
	const out: AuthoredWidgetShape = { title: w.title }
	if (w.icon !== undefined) out.icon = w.icon
	if (w.scopes?.length) out.scopes = [...w.scopes]
	if (w.reads?.length) out.reads = [...w.reads]
	if (w.channels?.length) out.channels = [...w.channels]
	if (w.cells) out.cells = { ...w.cells }
	if (w.settings) out.settings = structuredClone(w.settings) as Record<string, unknown>
	if (w.defaultActive !== undefined) out.defaultActive = w.defaultActive
	return out
}
