/**
 * Move every pre-28 media reference into the `media` table.
 *
 * Runs inside migration 0166's transaction, so the schema here is exactly
 * 0166's: `media` exists, the role-pointer columns exist, and every legacy
 * column and table is still present (0167 drops them, anchored after this).
 *
 * Written against raw SQL through `tx` on purpose — an upgrade must not import
 * app modules whose queries drift with the schema, and this one has to keep
 * reading `characters.avatar` long after that column stops existing in
 * `schema.ts`.
 *
 * **Copies, never moves.** A rolled-back transaction has to leave the source
 * tree intact, and 0167's drops are a separate migration for the same reason.
 * The old directories stay on disk for the cleanup tool to reclaim.
 */
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { sql } from "drizzle-orm"
import { getAppDataDir } from "$lib/server/db/drizzle.config"

const IMAGE_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif"
}

interface Copied {
	id: number
	hash: string
}

/** Resolve a stored legacy reference to an absolute file, or null.
 *
 * Three shapes ever reached disk: a `/images/...` URL (the only one the server
 * constructed), a data-dir-relative path (`session_assets/...`), and a bare
 * filename on some very old persona rows. The bare filenames are already broken
 * in the running app — nothing serves them — so they resolve to null and get
 * dropped with a log line, which is the honest outcome. */
function resolveLegacy(ref: string, appData: string): string | null {
	if (!ref) return null
	if (/^https?:\/\//i.test(ref)) return null // remote URL: no bytes of ours
	let rel = ref
	if (rel.startsWith("/images/")) rel = rel.slice("/images/".length)
	else if (rel.startsWith("images/")) rel = rel.slice("images/".length)
	else if (rel.startsWith("/")) rel = rel.slice(1)
	if (!rel || rel.includes("..")) return null
	const abs = path.resolve(appData, rel)
	if (abs !== appData && !abs.startsWith(appData + path.sep)) return null
	return abs
}

export async function run(tx: any): Promise<void> {
	const appData = path.resolve(getAppDataDir())
	let migrated = 0
	const dropped: string[] = []

	/** Hash the file, copy it into the 28 §8 layout, insert the row. Returns
	 *  null when the reference does not resolve. */
	async function adopt(
		ref: string,
		provenance: {
			userId: number
			characterId?: number | null
			personaId?: number | null
			sessionId?: number | null
		},
		opts: { position?: number; bucket?: string; label: string }
	): Promise<Copied | null> {
		const abs = resolveLegacy(ref, appData)
		if (!abs) {
			dropped.push(`${opts.label}: unresolvable reference "${ref}"`)
			return null
		}
		let buf: Buffer
		try {
			buf = await fs.readFile(abs)
		} catch {
			dropped.push(`${opts.label}: missing file "${ref}"`)
			return null
		}

		const hash = crypto.createHash("sha256").update(buf).digest("hex")
		const ext = (path.extname(abs).slice(1) || "png").toLowerCase()
		const mime = IMAGE_MIME[ext] ?? "application/octet-stream"

		// Per-user dedupe: the same bytes uploaded twice become one row.
		const existing = await tx.execute(sql`
			SELECT id, hash FROM media
			WHERE user_id = ${provenance.userId} AND hash = ${hash} AND variant IS NULL
			LIMIT 1`)
		if (existing.rows?.length) {
			return existing.rows[0] as Copied
		}

		// The §8 layout, inlined rather than imported: this must stay frozen
		// against 0.5's shape even if mediaRelPath's rules change later.
		const userDir = path.join("data", "users", String(provenance.userId))
		const relDir = provenance.sessionId
			? path.join(userDir, "sessions", String(provenance.sessionId))
			: provenance.characterId
				? path.join(userDir, "characters", String(provenance.characterId))
				: provenance.personaId
					? path.join(userDir, "personas", String(provenance.personaId))
					: path.join(userDir, opts.bucket ?? "uploads")
		const relPath = path.join(relDir, `${hash}.${ext}`)
		const dest = path.resolve(appData, relPath)
		await fs.mkdir(path.dirname(dest), { recursive: true })
		await fs.copyFile(abs, dest)

		const inserted = await tx.execute(sql`
			INSERT INTO media
				(user_id, character_id, persona_id, session_id, visibility,
				 hash, mime, bytes, kind, path, filename, position)
			VALUES
				(${provenance.userId}, ${provenance.characterId ?? null},
				 ${provenance.personaId ?? null}, ${provenance.sessionId ?? null},
				 'scoped', ${hash}, ${mime}, ${buf.byteLength}, 'image',
				 ${relPath}, ${path.basename(abs)}, ${opts.position ?? 0})
			RETURNING id, hash`)
		migrated++
		return inserted.rows[0] as Copied
	}

	// ---- 1. Character avatars -------------------------------------------
	const characters = await tx.execute(sql`
		SELECT id, user_id, name, avatar FROM characters
		WHERE avatar IS NOT NULL AND avatar <> ''`)
	for (const c of characters.rows ?? []) {
		const row = await adopt(
			String(c.avatar),
			{ userId: Number(c.user_id), characterId: Number(c.id) },
			{ label: `character ${c.id} (${c.name}) avatar` }
		)
		if (row) {
			await tx.execute(
				sql`UPDATE characters SET avatar_media_id = ${row.id} WHERE id = ${c.id}`
			)
		}
	}

	// ---- 2. Character galleries ------------------------------------------
	const charGallery = await tx.execute(sql`
		SELECT g.id, g.character_id, g.path, g.position, c.user_id, c.name
		FROM character_gallery_images g
		JOIN characters c ON c.id = g.character_id
		ORDER BY g.character_id, g.position, g.id`)
	for (const g of charGallery.rows ?? []) {
		await adopt(
			String(g.path),
			{ userId: Number(g.user_id), characterId: Number(g.character_id) },
			{
				position: Number(g.position ?? 0),
				label: `character ${g.character_id} (${g.name}) gallery`
			}
		)
	}

	// ---- 3. Persona avatars ----------------------------------------------
	const personas = await tx.execute(sql`
		SELECT id, user_id, name, avatar FROM personas
		WHERE avatar IS NOT NULL AND avatar <> ''`)
	for (const p of personas.rows ?? []) {
		const row = await adopt(
			String(p.avatar),
			{ userId: Number(p.user_id), personaId: Number(p.id) },
			{ label: `persona ${p.id} (${p.name}) avatar` }
		)
		if (row) {
			await tx.execute(
				sql`UPDATE personas SET avatar_media_id = ${row.id} WHERE id = ${p.id}`
			)
		}
	}

	// ---- 4. Persona galleries --------------------------------------------
	const personaGallery = await tx.execute(sql`
		SELECT g.id, g.persona_id, g.path, g.position, p.user_id, p.name
		FROM persona_gallery_images g
		JOIN personas p ON p.id = g.persona_id
		ORDER BY g.persona_id, g.position, g.id`)
	for (const g of personaGallery.rows ?? []) {
		await adopt(
			String(g.path),
			{ userId: Number(g.user_id), personaId: Number(g.persona_id) },
			{
				position: Number(g.position ?? 0),
				label: `persona ${g.persona_id} (${g.name}) gallery`
			}
		)
	}

	// ---- 5. Uploaded backgrounds -----------------------------------------
	// Shipped defaults (`/backgrounds/defaults/*`) are static assets owned by
	// no user — they stay in background_image_path and are skipped here.
	const settings = await tx.execute(sql`
		SELECT id, user_id, background_image_path FROM user_settings
		WHERE background_image_path IS NOT NULL AND background_image_path <> ''`)
	for (const s of settings.rows ?? []) {
		const ref = String(s.background_image_path)
		if (ref.startsWith("/backgrounds/")) continue
		const row = await adopt(
			ref,
			{ userId: Number(s.user_id) },
			{ bucket: "backgrounds", label: `user ${s.user_id} background` }
		)
		if (row) {
			await tx.execute(sql`
				UPDATE user_settings
				SET background_media_id = ${row.id}, background_image_path = NULL
				WHERE id = ${s.id}`)
		}
	}

	// ---- 6. Session assets ------------------------------------------------
	// Already hash-addressed, already carrying mime and bytes — a row rewrite
	// plus a copy into the new layout.
	const assets = await tx.execute(sql`
		SELECT a.id, a.session_id, a.hash, a.mime, a.bytes, a.path, a.created_by,
		       s.user_id
		FROM session_assets a
		JOIN sessions s ON s.id = a.session_id`)
	for (const a of assets.rows ?? []) {
		const userId = Number(a.created_by ?? a.user_id)
		const abs = resolveLegacy(String(a.path), appData)
		if (!abs) {
			dropped.push(`session asset ${a.id}: unresolvable path`)
			continue
		}
		let buf: Buffer
		try {
			buf = await fs.readFile(abs)
		} catch {
			dropped.push(`session asset ${a.id}: missing file`)
			continue
		}
		const ext = (String(a.mime).split("/")[1] ?? "bin").replace(
			/[^a-z0-9]/gi,
			""
		)
		const relPath = path.join(
			"data",
			"users",
			String(userId),
			"sessions",
			String(a.session_id),
			`${a.hash}.${ext}`
		)
		const dest = path.resolve(appData, relPath)
		await fs.mkdir(path.dirname(dest), { recursive: true })
		await fs.copyFile(abs, dest)
		const kind = String(a.mime).startsWith("image/") ? "image" : "document"
		await tx.execute(sql`
			INSERT INTO media
				(user_id, session_id, visibility, hash, mime, bytes, kind, path)
			VALUES
				(${userId}, ${a.session_id}, 'scoped', ${a.hash}, ${a.mime},
				 ${a.bytes}, ${kind}, ${relPath})
			ON CONFLICT DO NOTHING`)
		migrated++
	}

	// No thumbnails are generated here. Encoding thousands of images inside a
	// migration transaction is how an upgrade appears to hang; a background
	// pass backfills them after boot, and originals serve until it does.
	console.log(`[0166_media] migrated ${migrated} media rows.`)
	if (dropped.length) {
		console.warn(
			`[0166_media] ${dropped.length} reference(s) did not resolve and were dropped:\n  ` +
				dropped.join("\n  ")
		)
	}
}
