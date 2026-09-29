/**
 * The session data panel's read (owner-approved 2026-09-26): a session's
 * annex, laid out against its owners' **annex declarations** — for each
 * owner (core, then each plugin) each declared key with its shape, its
 * audience, its setters and the value stored now; then every stored key no
 * declaration covers, as **legacy** (pipelines only, R59).
 *
 * Unlike a person's view (`annexViews.ts`), this shows values whatever their
 * audience, so it is for the session's owner and administrators alone
 * (`sessions:annexInspect`). Even for them a value whose declared shape
 * holds a `secret` is withheld — R61 says such a field cannot be declared,
 * and this checks again rather than trusting that.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { declaredAnnexFields, type DeclaredAnnexField } from "$lib/server/sessions/annexFields"
import { annexShapeHoldsSecret } from "$lib/shared/sessions/annexInspect"
import type { FieldDecl } from "@serene-pub/sdk"

type Inspected = Sockets.Sessions.AnnexInspect.Response

/** The one refusal sentence — the same whether the session is someone else's or absent. */
export const ANNEX_INSPECT_REFUSAL =
	"Only the session's owner or an administrator can see its stored data."

/**
 * Lay the stored annex out against the declarations in force. Pure.
 * Owners: core first, then the rest by name; an owner that declares nothing
 * is listed only through its legacy keys.
 */
export function groupAnnex(
	annex: Record<string, unknown> | null | undefined,
	declared: readonly DeclaredAnnexField[],
	/**
	 * Keys an owner's stored manifest marks secret although the declaration
	 * was refused (so they read as legacy): their values are withheld too.
	 */
	secretKeys: ReadonlyMap<string, ReadonlySet<string>> = new Map()
): Pick<Inspected, "groups" | "legacy"> {
	const stored = annex && typeof annex === "object" ? annex : {}
	const docOf = (owner: string): Record<string, unknown> | null => {
		const doc = stored[owner]
		return doc && typeof doc === "object" && !Array.isArray(doc)
			? (doc as Record<string, unknown>)
			: null
	}

	const byOwner = new Map<string, DeclaredAnnexField[]>()
	for (const f of declared) {
		const list = byOwner.get(f.owner) ?? []
		list.push(f)
		byOwner.set(f.owner, list)
	}
	const owners = [...byOwner.keys()].sort((a, b) =>
		a === "core" ? -1 : b === "core" ? 1 : a.localeCompare(b)
	)

	const groups: Inspected["groups"] = owners.map((owner) => {
		const doc = docOf(owner)
		return {
			owner,
			fields: byOwner.get(owner)!.map(({ decl }) => {
				const hasValue = !!doc && Object.hasOwn(doc, decl.key)
				const secret = annexShapeHoldsSecret(decl.shape)
				return {
					key: decl.key,
					...(decl.label !== undefined ? { label: decl.label } : {}),
					...(decl.description !== undefined ? { description: decl.description } : {}),
					shape: decl.shape,
					see: [...decl.see],
					act: decl.act?.length ? [...decl.act] : null,
					...(decl.genre !== undefined ? { genre: decl.genre } : {}),
					hasValue,
					...(hasValue && !secret ? { value: doc![decl.key] } : {}),
					...(hasValue && secret ? { withheld: true } : {})
				}
			})
		}
	})

	const legacy: Inspected["legacy"] = []
	for (const owner of Object.keys(stored).sort()) {
		const declaredKeys = new Set((byOwner.get(owner) ?? []).map((f) => f.decl.key))
		const doc = docOf(owner)
		if (!doc) {
			// Not an owner document at all: shown whole, so nothing stored is hidden.
			legacy.push({ owner, key: null, value: stored[owner] })
			continue
		}
		for (const key of Object.keys(doc).sort()) {
			if (declaredKeys.has(key)) continue
			legacy.push(
				secretKeys.get(owner)?.has(key)
					? { owner, key, withheld: true }
					: { owner, key, value: doc[key] }
			)
		}
	}
	return { groups, legacy }
}

/**
 * The panel's read for `viewer`: refused (by sentence) unless they own the
 * session or are an administrator.
 */
export async function inspectAnnex(
	db: Db,
	sessionId: number,
	viewer: { id: number; isAdmin?: boolean | null }
): Promise<{ ok: true; result: Inspected } | { ok: false; error: string }> {
	const [row] = await db
		.select({
			ownerId: schema.sessions.userId,
			annex: schema.sessions.annex,
			genreId: schema.sessions.genreId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!viewer.isAdmin && (!row || row.ownerId !== viewer.id))
		return { ok: false, error: ANNEX_INSPECT_REFUSAL }
	if (!row) return { ok: false, error: "No such session." }
	const declared = await declaredAnnexFields(db, row.genreId ?? "core:genre/chat")
	return {
		ok: true,
		result: {
			sessionId,
			...groupAnnex(
				row.annex as Record<string, unknown> | null,
				declared,
				await refusedSecretKeys(db)
			)
		}
	}
}

/**
 * Keys a plugin's stored manifest declares with a secret shape. Such an
 * entry is refused as a declaration (R61), so its stored value would read as
 * legacy; this finds it so the value is withheld all the same.
 */
async function refusedSecretKeys(db: Db): Promise<Map<string, Set<string>>> {
	const out = new Map<string, Set<string>>()
	const rows = await db
		.select({ pluginId: schema.plugins.pluginId, manifest: schema.plugins.manifest })
		.from(schema.plugins)
	for (const p of rows) {
		const raw = (p.manifest as { annexFields?: unknown } | null)?.annexFields
		if (!Array.isArray(raw)) continue
		for (const f of raw) {
			const { key, shape } = (f ?? {}) as { key?: unknown; shape?: FieldDecl }
			if (typeof key === "string" && annexShapeHoldsSecret(shape)) {
				const keys = out.get(p.pluginId) ?? new Set<string>()
				keys.add(key)
				out.set(p.pluginId, keys)
			}
		}
	}
	return out
}
