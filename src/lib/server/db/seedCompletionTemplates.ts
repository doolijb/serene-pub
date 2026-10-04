import { eq } from "drizzle-orm"
import * as schema from "./schema"
import { BUILTIN_COMPLETION_TEMPLATES } from "$lib/shared/constants/completionTemplates"

/**
 * Write the built-in completion templates, matched by `seed_key`.
 *
 * Seeded from BUILTIN_COMPLETION_TEMPLATES rather than re-typed, so the rows a
 * connection references and the framing the renderer actually uses are one
 * list. A second copy would drift silently: nothing compares them at runtime,
 * and the symptom of disagreement is a prompt wrapped in markers the stop
 * strings do not mention.
 *
 * EVERY row is `isImmutable: true`. That is load-bearing, not a preference —
 * the update branch is `set({ ...data, id: undefined })`, which re-applies a
 * seed's full contents on every boot. It is safe only because the server
 * refuses edits to an immutable row, so there are no user edits for it to
 * revert. A mutable seeded row here would lose a user's changes on every
 * restart with nothing to catch it.
 *
 * No `id` on any of them: seedKey only.
 *
 * Its own module, taking the handle, so `createTestDb` writes exactly the rows
 * boot writes without importing `defaults.ts` (which opens the app database).
 */
export async function seedCompletionTemplates(db: Db): Promise<void> {
	const existing = await db
		.select({
			id: schema.completionTemplates.id,
			seedKey: schema.completionTemplates.seedKey
		})
		.from(schema.completionTemplates)

	const queries: Promise<unknown>[] = []
	for (const template of BUILTIN_COMPLETION_TEMPLATES) {
		const data: InsertCompletionTemplate = {
			seedKey: `completion-template-${template.key}`,
			key: template.key,
			name: template.name,
			isImmutable: true,
			renderMode: template.renderMode,
			roles: template.roles,
			fallbackRole: template.fallbackRole,
			stopStrings: [...template.stopStrings],
			isSelectable: template.isSelectable
		}
		const found = existing.find((c) => c.seedKey === data.seedKey)
		queries.push(
			found
				? db
						.update(schema.completionTemplates)
						.set({ ...data, id: undefined })
						.where(eq(schema.completionTemplates.id, found.id))
				: db.insert(schema.completionTemplates).values(data)
		)
	}
	await Promise.all(queries)
}
