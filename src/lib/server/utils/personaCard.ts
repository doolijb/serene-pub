import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import { isValidUuid } from "$lib/server/utils/uuid"
import { handleCharacterAvatarUpload } from "$lib/server/utils"
import type { ImportWarning } from "$lib/server/sockets/characters"

/**
 * The PERSONA CARD — a wire format, not a table.
 *
 * There is no `personas` table and no `personas:*` socket family; a persona is
 * a character. This shape is neither: a Serene Pub lorebook export embeds bound
 * persona cards under `extensions.serenepub.personas`, SillyTavern exports a
 * persona as its own file, and both are formats other programs hold. So the
 * card stays, built from a character row with `isPersona` set.
 *
 * ⚠ The card is deliberately SMALLER than a character card, and must stay so. A
 * persona card was always name/description/creator plus the serenepub extension
 * block; widening it would change what an export of an unchanged lorebook
 * produces, and the importer hashes exactly that to tell "unchanged" from
 * "conflict" — so every existing book would come back conflicted.
 */
export function buildPersonaExportCard(persona: {
	name: string
	description: string
	creator: string | null
	category: string | null
	aliases: string[] | null
	summary: string | null
	uuid: string
}) {
	return {
		name: persona.name,
		description: persona.description,
		creator: persona.creator || "",
		extensions: {
			serenepub: {
				uuid: persona.uuid,
				...(persona.category ? { category: persona.category } : {}),
				...(persona.aliases && persona.aliases.length > 0
					? { aliases: persona.aliases }
					: {}),
				...(persona.summary ? { summary: persona.summary } : {})
			}
		}
	}
}

/**
 * Extracts a stable per-row uuid from a parsed persona card, if present. A
 * malformed value (wrong shape/type — untrusted import data) is treated as
 * absent rather than passed through to a `uuid`-typed DB column, where it
 * would otherwise surface as a raw driver error.
 */
export function extractPersonaUuid(data: any): string | undefined {
	const uuid = data?.extensions?.serenepub?.uuid
	return isValidUuid(uuid) ? uuid : undefined
}

/**
 * A small flat comparison shape used purely for import-dedup hashing, not a
 * portable file format. Deliberately the card's own four fields — see the
 * warning on `buildPersonaExportCard`.
 */
export function canonicalPersonaContent(persona: {
	name: string
	description: string
	creator: string | null
	category: string | null
}) {
	return {
		name: persona.name,
		description: persona.description,
		creator: persona.creator,
		category: persona.category
	}
}

/**
 * The persona card's fields, as a `characters` insert.
 *
 * ONLY the fields a persona card carries, plus `isPersona: true`. The
 * narrowness is the point: a persona card has no personality, scenario,
 * greeting or example dialogue, so a file claiming to be one cannot smuggle
 * them into the row.
 */
export function personaFieldsFromParsedData(
	data: any
): Omit<InsertCharacter, "userId"> {
	// aliases/summary are read back from the same place buildPersonaExportCard
	// writes them — without this a Serene Pub persona loses both on its own
	// export/re-import round trip. Mirrors characterFieldsFromParsedData, which
	// also tolerates the un-namespaced `extensions.aliases` other tools use.
	const aliases =
		data.extensions?.serenepub?.aliases ?? data.extensions?.aliases
	return {
		name: data.name || "Unnamed Persona",
		description: data.description || "",
		creator: data.creator || null,
		aliases: Array.isArray(aliases) ? aliases : [],
		summary: data.extensions?.serenepub?.summary ?? null,
		category: data.extensions?.serenepub?.category ?? null,
		isPersona: true
	}
}

/**
 * Resolves the uuid a newly-created row should be stamped with. `characters`'s
 * uuid index is unique per-owner; a same-user collision would already have been
 * caught by the caller's dedup lookup, so falling back to a fresh uuid is
 * always safe here.
 */
async function claimIncomingPersonaUuid(
	incomingUuid: string | undefined,
	userId: number,
	dbOrTx: Db
): Promise<string | undefined> {
	if (!incomingUuid) return undefined
	const existing = await dbOrTx.query.characters.findFirst({
		where: and(
			eq(schema.characters.uuid, incomingUuid),
			eq(schema.characters.userId, userId)
		),
		columns: { id: true }
	})
	return existing ? undefined : incomingUuid
}

/**
 * The avatar write, non-fatal — same rule as `applyAvatarAndTags` in
 * characters.ts and for the same reason: this runs AFTER the row is committed,
 * and the write rejects anything over 10MB or not a recognised image, which
 * persona cards exported from SillyTavern hit routinely because the card IS a
 * full-resolution PNG. Throwing here would report "import failed" for a persona
 * that is already in the database.
 */
async function applyPersonaAvatar(
	persona: SelectCharacter,
	avatarBuffer: Buffer | undefined,
	dbOrTx: Db = db
): Promise<{ persona: SelectCharacter; warnings: ImportWarning[] }> {
	const warnings: ImportWarning[] = []
	if (avatarBuffer) {
		try {
			await handleCharacterAvatarUpload({
				character: persona,
				avatarFile: avatarBuffer
			})
			const updated = await dbOrTx.query.characters.findFirst({
				where: eq(schema.characters.id, persona.id)
			})
			if (updated) Object.assign(persona, updated)
		} catch (e: any) {
			const reason = e?.message || String(e)
			console.warn(
				`Persona ${persona.id} imported without its avatar: ${reason}`
			)
			warnings.push(`The card's image could not be saved: ${reason}`)
		}
	}
	return { persona, warnings }
}

export async function createPersonaFromParsedData(
	data: any,
	avatarBuffer: Buffer | undefined,
	userId: number,
	dbOrTx: Db = db,
	warnings?: ImportWarning[]
) {
	const uuidToStamp = await claimIncomingPersonaUuid(
		extractPersonaUuid(data),
		userId,
		dbOrTx
	)
	const [persona] = await dbOrTx
		.insert(schema.characters)
		.values({
			...personaFieldsFromParsedData(data),
			...(uuidToStamp ? { uuid: uuidToStamp } : {}),
			userId
		})
		.returning()
	const applied = await applyPersonaAvatar(persona, avatarBuffer, dbOrTx)
	warnings?.push(...applied.warnings)
	return applied.persona
}

export async function overwritePersonaFromParsedData(
	existingId: number,
	data: any,
	avatarBuffer: Buffer | undefined,
	dbOrTx: Db = db,
	warnings?: ImportWarning[]
) {
	await dbOrTx
		.update(schema.characters)
		.set(personaFieldsFromParsedData(data))
		.where(eq(schema.characters.id, existingId))
	const persona = await dbOrTx.query.characters.findFirst({
		where: eq(schema.characters.id, existingId)
	})
	if (!persona) throw new Error("Persona not found.")
	const applied = await applyPersonaAvatar(persona, avatarBuffer, dbOrTx)
	warnings?.push(...applied.warnings)
	return applied.persona
}
