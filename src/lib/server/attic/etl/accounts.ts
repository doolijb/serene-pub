/**
 * Users and what hangs off them alone: settings, passphrases, sign-in tokens,
 * the setup checklist, tags, custom themes.
 *
 * Ids are kept. The one row `defaults.sync()` seeds into the emptied `users`
 * table — the `user-admin` seed, id 1 — is the 0.5.3 admin itself, matched
 * by `seed_key` and overwritten with the attic's values, never inserted twice;
 * its seeded `user_settings` row is updated the same way, since `user_id` is
 * unique there.
 */
import { asc, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import * as attic from "../tables"
import {
	countLoss,
	insertBatched,
	mapFor,
	mapped,
	type RestoreContext
} from "../context"

export async function restoreUsers(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	const old = await tx.select().from(attic.users).orderBy(asc(attic.users.id))
	const seeded = await tx
		.select()
		.from(schema.users)
		.where(isNotNull(schema.users.seedKey))
	const userMap = mapFor(ctx, "users")
	const oldIds = new Set(old.map((u) => u.id))

	// A seed nobody in the attic matches is only in the way of the attic's
	// own ids: it was written into a table the stash had just emptied.
	for (const s of seeded) {
		const twin = old.find((u) => u.seedKey === s.seedKey)
		if (!twin && oldIds.has(s.id))
			await tx.delete(schema.users).where(eq(schema.users.id, s.id))
	}

	const fresh: (typeof schema.users.$inferInsert)[] = []
	for (const u of old) {
		const values = {
			seedKey: u.seedKey,
			username: u.username,
			displayName: u.displayName,
			theme: u.theme,
			darkMode: u.darkMode,
			isAdmin: u.isAdmin,
			isDeleted: u.isDeleted,
			lastLoginAt: null,
			createdAt: u.createdAt,
			updatedAt: u.updatedAt
		}
		const twin = u.seedKey
			? seeded.find((s) => s.seedKey === u.seedKey)
			: undefined
		if (twin) {
			await tx
				.update(schema.users)
				.set(values)
				.where(eq(schema.users.id, twin.id))
			if (twin.id !== u.id) userMap.set(u.id, twin.id)
		} else fresh.push({ id: u.id, ...values })
	}
	await insertBatched(tx, schema.users, fresh)
}

export async function restoreUserSettings(
	ctx: RestoreContext
): Promise<Array<{ userId: number; backgroundImagePath: string | null }>> {
	const { tx } = ctx
	const old = await tx
		.select()
		.from(attic.userSettings)
		.orderBy(asc(attic.userSettings.id))
	const backgrounds: Array<{ userId: number; backgroundImagePath: string | null }> =
		[]
	for (const s of old) {
		const userId = mapped(ctx, "users", s.userId)!
		// `enable_easy_persona_creation` has no 0.6 column (personas are
		// characters) — switched off, it is an accepted loss; the six
		// `active_*_config_id` pointers are the wiring's to read from the
		// attic, not this table's to hold.
		if (s.enableEasyPersonaCreation === false)
			countLoss(ctx, "the easy persona creation switch (personas are characters in 0.6)")
		const values = {
			theme: s.theme,
			darkMode: s.darkMode,
			showHomePageBanner: s.showHomePageBanner,
			enableEasyCharacterCreation: s.enableEasyCharacterCreation,
			showAllCharacterFields: s.showAllCharacterFields,
			backgroundImagePath: s.backgroundImagePath,
			backgroundMediaId: null,
			backgroundOpacity: s.backgroundOpacity,
			charaVaultIncludeNsfw: s.charaVaultIncludeNsfw,
			createdAt: s.createdAt,
			updatedAt: s.updatedAt
		}
		const [live] = await tx
			.select({ id: schema.userSettings.id })
			.from(schema.userSettings)
			.where(eq(schema.userSettings.userId, userId))
			.limit(1)
		if (live)
			await tx
				.update(schema.userSettings)
				.set(values)
				.where(eq(schema.userSettings.id, live.id))
		else await tx.insert(schema.userSettings).values({ userId, ...values })
		backgrounds.push({ userId, backgroundImagePath: s.backgroundImagePath })
	}
	return backgrounds
}

export async function restoreAccountRows(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	const passphrases = await tx.select().from(attic.passphrases)
	await insertBatched(
		tx,
		schema.passphrases,
		passphrases.map((p) => ({
			id: p.id,
			userId: mapped(ctx, "users", p.userId)!,
			hash: p.hash,
			salt: p.salt,
			iterations: p.iterations,
			createdAt: p.createdAt,
			invalidatedAt: p.invalidatedAt
		}))
	)

	// Sign-ins carry over, so nobody is logged out by an upgrade.
	const tokens = await tx.select().from(attic.userTokens)
	await insertBatched(
		tx,
		schema.userTokens,
		tokens.map((t) => ({
			id: t.id,
			userId: mapped(ctx, "users", t.userId),
			token: t.token,
			createdAt: t.createdAt,
			expiresAt: t.expiresAt,
			browser: t.browser,
			os: t.os,
			mfaVerifiedAt: null
		}))
	)

	// `summarization_step_complete` has no 0.6 column: summarization is
	// always on (D10).
	const setup = await tx.select().from(attic.setup)
	for (const s of setup)
		if (s.summarizationStepComplete) countLoss(ctx, "the summarization setup step")
	await insertBatched(
		tx,
		schema.setup,
		setup.map((s) => ({
			id: s.id,
			userId: mapped(ctx, "users", s.userId)!,
			ragStepComplete: s.ragStepComplete
		}))
	)

	const themes = await tx.select().from(attic.customThemes)
	await insertBatched(
		tx,
		schema.customThemes,
		themes.map((t) => ({
			id: t.id,
			name: t.name,
			label: t.label,
			css: t.css,
			cssKey: t.cssKey,
			uploadedBy: mapped(ctx, "users", t.uploadedBy),
			isPubTheme: t.isInstanceTheme,
			createdAt: t.createdAt,
			updatedAt: t.updatedAt
		}))
	)

	const tags = await tx.select().from(attic.tags)
	await insertBatched(
		tx,
		schema.tags,
		tags.map((t) => ({
			id: t.id,
			userId: mapped(ctx, "users", t.userId)!,
			name: t.name,
			description: t.description,
			colorPreset: t.colorPreset
		}))
	)
}

