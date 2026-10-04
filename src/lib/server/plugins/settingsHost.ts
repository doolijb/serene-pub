/**
 * Plugin settings — the app half of 12 §6's "one declaration, four uses".
 *
 * The SDK owns the declaration and every pure judgement about it (`checkValues`,
 * `reconcile`, `forClient`, `forOwningHook`, `configState` — settings.ts). What
 * lives here is only what the SDK cannot know: where the values are stored
 * (`plugins.settings`), and the pub's crypto.
 *
 * ## Secrets (13 §6)
 *
 * A `secret` field's stored form is the SDK's typed `{$secret: true, value}`
 * envelope with `value` holding AES-256-GCM ciphertext under the app secret —
 * its own HKDF key class, so a plugin setting is cryptographically independent
 * of connection keys despite sharing the root secret. The type is what makes
 * custody defensible: core mechanically masks it to the client (`forClient`
 * reports only set/unset), never exports it, and decrypts it only host-side
 * for the declaring plugin (`forOwningHookSplit`, R63): its hooks hold a
 * handle, the fetch bridge fills the value in, and every result is scrubbed.
 *
 * ## Delivery
 *
 * Resolved values ride the descriptor (`PluginDescriptor.settings`) and the
 * manager merges them into every hook's input as the reserved `settings` key —
 * the same per-call injection posture as F18's connection material. Updating a
 * setting re-registers the descriptor, so the next call sees the new values
 * and an in-flight one keeps the values it started with.
 *
 * ## User-scoped settings (`scope: 'user'`)
 *
 * A field declared `scope: 'user'` is one each person may set for themselves.
 * Their values live in `plugin_user_settings`, one row per (plugin, user); the
 * pub's value in `plugins.settings` is what everyone gets until they set
 * their own, and the declared default is what the pub gets until an
 * administrator sets one. So a hook acting for a user resolves
 * **user → pub → default** (`resolveSettingsFor`). The descriptor carries
 * one resolution per user who has a row (`settingsByUser`, keyed by the user id
 * as text — the same spelling a call's `user` has) and the manager picks the
 * one for the user the call acts for; a call for anyone else, or for no one,
 * gets the pub's.
 *
 * Who may write what: an administrator writes the pub's values for every
 * field; a person writes only their own values, and only for user-scoped
 * fields (`applyUserSettingsWrite` refuses a pub field by name).
 */

import { randomBytes } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { plugins, pluginUserSettings } from "$lib/server/db/schema"
import {
	checkValues,
	configState,
	forClient,
	forOwningHookSplit,
	isSecret,
	reconcile,
	type PluginConfigState,
	type SettingsSchema
} from "@serene-pub/sdk"
import type { PluginDescriptor } from "./SandboxManager"
import {
	encryptToken,
	decryptToken,
	type EncryptedToken
} from "$lib/server/utils/tokenCrypto"

/** Own HKDF class — see tokenCrypto.ts on why this must never be defaulted. */
export const PLUGIN_SETTINGS_KEY_INFO = "serene-pub:pluginSetting:v1"

const FIELD_TYPES = new Set([
	"string",
	"text",
	"number",
	"integer",
	"boolean",
	"enum",
	"string[]",
	"secret"
])

/**
 * Read the settings schema off a stored manifest, tolerant of the json being
 * anything — the manifest is installed data, not trusted structure. A field
 * whose `type` is not in the SDK vocabulary is dropped rather than rendered
 * as a form control nobody can fill.
 */
export function settingsSchemaOf(manifest: unknown): SettingsSchema {
	const raw =
		manifest && typeof manifest === "object"
			? (manifest as any).settings
			: undefined
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
	const out: SettingsSchema = {}
	for (const [key, decl] of Object.entries(raw as Record<string, unknown>))
		if (
			decl &&
			typeof decl === "object" &&
			FIELD_TYPES.has(String((decl as any).type))
		)
			out[key] = decl as SettingsSchema[string]
	return out
}

const stored = (row: unknown): Record<string, unknown> =>
	row && typeof row === "object" && !Array.isArray(row)
		? (row as Record<string, unknown>)
		: {}

/** What the admin form renders: schema, masked values, and the config state. */
export interface ClientSettingsView {
	schema: SettingsSchema
	/** Reconciled values with every secret reduced to `{$secretSet: boolean}`. */
	values: Record<string, unknown>
	state: PluginConfigState
	/** Stored fields the current schema no longer declares — shown, never dropped. */
	orphaned: string[]
}

export function clientSettingsView(
	manifest: unknown,
	settings: unknown
): ClientSettingsView | null {
	const schema = settingsSchemaOf(manifest)
	if (!Object.keys(schema).length) return null
	const r = reconcile(schema, stored(settings))
	return {
		schema,
		values: forClient(schema, r.values),
		state: configState(schema, r.values),
		orphaned: r.orphaned.map((o) => o.field)
	}
}

/**
 * Fold an admin's edit into the stored values.
 *
 * Only declared fields are writable, and a secret arrives as one of three
 * spellings: absent (unchanged), empty/null (cleared), or a plaintext string
 * (replaced — encrypted here, at the one write path, so ciphertext is the
 * only form that ever rests). Provided values are validated against their
 * declarations; a *missing* required field does not block the save — an
 * incomplete config is the legitimate `needs-configuration` state, not an
 * error (12 §6).
 */
export function applySettingsWrite(
	schema: SettingsSchema,
	current: unknown,
	incoming: Record<string, unknown>
): { ok: true; next: Record<string, unknown> } | { ok: false; error: string } {
	const next = { ...stored(current) }
	for (const [key, value] of Object.entries(incoming)) {
		const decl = schema[key]
		if (!decl)
			return {
				ok: false,
				error: `'${key}' is not a setting this extension declares.`
			}
		if (decl.type === "secret") {
			if (value === undefined) continue
			if (value === null || value === "") {
				delete next[key]
				continue
			}
			if (typeof value !== "string")
				return {
					ok: false,
					error: `'${key}' is a secret — write it as text, or clear it.`
				}
			// Shorter than the scrub can safely match (R63): it would reach
			// outputs untouched, so it is refused rather than half-protected.
			if (value.length < 4)
				return {
					ok: false,
					error: `'${key}' is too short to be kept out of what the extension returns — use the full key.`
				}
			next[key] = {
				$secret: true,
				value: JSON.stringify(
					encryptToken(value, PLUGIN_SETTINGS_KEY_INFO)
				)
			}
			continue
		}
		if (value === undefined || value === null) delete next[key]
		else next[key] = value
	}

	// Validate what was provided; findings about untouched fields are the
	// config state's business, not this write's.
	const provided = new Set(Object.keys(incoming))
	const problems = checkValues(schema, reconcile(schema, next).values)
		.filter((f) => f.severity === "error")
		.filter((f) => f.field && provided.has(f.field))
	if (problems.length)
		return {
			ok: false,
			error: problems.map((f) => `${f.message} — ${f.fix}`).join("; ")
		}
	return { ok: true, next }
}

/**
 * What a plugin's hooks are handed (R63): `settings` with a **secret handle**
 * (`⟦secret:<key>:<nonce>⟧`, the nonce minted per registration) in place of
 * each secret, and — host-side only — the
 * plaintext values and the keys the package lends. Undefined when the
 * manifest declares no settings, so the manager injects nothing a plugin
 * never asked for.
 */
export function hookSettingsFor(
	manifest: unknown,
	settings: unknown,
	nonce: string = randomBytes(8).toString("hex")
):
	| { settings: Record<string, unknown>; secrets: Record<string, string>; lent: string[]; nonce: string }
	| undefined {
	const schema = settingsSchemaOf(manifest)
	if (!Object.keys(schema).length) return undefined
	const r = reconcile(schema, stored(settings))
	const split = forOwningHookSplit(schema, r.values, (cipher) => {
		try {
			return decryptToken(
				JSON.parse(cipher) as EncryptedToken,
				PLUGIN_SETTINGS_KEY_INFO
			)
		} catch {
			// A key mismatch (restored backup, 13 §5) fails loudly and locally
			// at the field, not the call: the hook sees an empty value and
			// the admin re-enters the secret.
			return ""
		}
	}, nonce)
	return { ...split, nonce }
}

/* ── user-scoped settings ─────────────────────────────────────────────────── */

/** The fields a person may set for themselves: those declared `scope: 'user'`. */
export function userScopedSchema(schema: SettingsSchema): SettingsSchema {
	const out: SettingsSchema = {}
	for (const [key, decl] of Object.entries(schema))
		if (decl.scope === "user") out[key] = decl
	return out
}

/**
 * The stored values a user's resolution starts from: the pub's, with the
 * user's own laid over them for user-scoped fields only. A user row that
 * somehow holds a pub field (written before a manifest changed a
 * field's scope) is ignored rather than trusted.
 */
export function layeredStored(
	schema: SettingsSchema,
	pubStored: unknown,
	userStored: unknown
): Record<string, unknown> {
	const out = { ...stored(pubStored) }
	const own = stored(userStored)
	for (const key of Object.keys(userScopedSchema(schema)))
		if (key in own && own[key] !== undefined && own[key] !== null)
			out[key] = own[key]
	return out
}

/**
 * The values a hook acting for one user reads: the user's value, then the
 * pub value, then the declared default. Secrets stay in their stored
 * envelope here — `hookSettingsFor` is what turns them into handles.
 */
export function resolveSettingsFor(
	schema: SettingsSchema,
	pubStored: unknown,
	userStored: unknown
): Record<string, unknown> {
	return reconcile(schema, layeredStored(schema, pubStored, userStored))
		.values
}

/** What a person's own settings form renders for one plugin. */
export interface PluginUserSettingsView extends ClientSettingsView {
	/** The user-scoped fields this person has set themselves; the rest show the pub's value. */
	own: string[]
}

/**
 * The user-scoped half of a plugin's settings, for one person: only the
 * fields they may set, each showing what a hook acting for them would read
 * (masked like the admin view). Null when the plugin declares no user-scoped
 * field, which is also how the user surface knows to leave it out.
 */
export function pluginUserSettingsView(
	manifest: unknown,
	pubStored: unknown,
	userStored: unknown
): PluginUserSettingsView | null {
	const schema = userScopedSchema(settingsSchemaOf(manifest))
	if (!Object.keys(schema).length) return null
	const values = resolveSettingsFor(schema, pubStored, userStored)
	const own = stored(userStored)
	return {
		schema,
		values: forClient(schema, values),
		state: configState(schema, values),
		orphaned: [],
		own: Object.keys(schema).filter(
			(k) => own[k] !== undefined && own[k] !== null
		)
	}
}

/**
 * Fold a person's edit into their own stored values. The same write rules as
 * the pub's (`applySettingsWrite`) over the user-scoped fields only — an
 * pub field is refused by name, since only an administrator sets it.
 * Clearing a value (null, or "" for a secret) removes the user's own value,
 * so they read the pub's again.
 */
export function applyUserSettingsWrite(
	schema: SettingsSchema,
	current: unknown,
	incoming: Record<string, unknown>
): { ok: true; next: Record<string, unknown> } | { ok: false; error: string } {
	const userSchema = userScopedSchema(schema)
	for (const key of Object.keys(incoming))
		if (schema[key] && !userSchema[key])
			return {
				ok: false,
				error: `'${key}' applies to everyone on this pub — only an administrator can change it.`
			}
	return applySettingsWrite(userSchema, current, incoming)
}

/** One person's stored row for a plugin, as `settingsDelivery` reads them. */
export interface PluginUserSettingsRow {
	userId: number
	settings: unknown
}

/**
 * Everything the descriptor carries about settings: the pub resolution
 * (handles for the hook, plaintext host-side, R63), and one resolution per
 * user with a row of their own. Every resolution shares one nonce, so a
 * handle reads the same whoever the call is for. Empty when the manifest
 * declares no settings.
 */
export function settingsDelivery(
	manifest: unknown,
	pubStored: unknown,
	userRows: readonly PluginUserSettingsRow[] = [],
	nonce: string = randomBytes(8).toString("hex")
): Pick<
	PluginDescriptor,
	"settings" | "secrets" | "lentSecrets" | "secretNonce" | "settingsByUser"
> {
	const base = hookSettingsFor(manifest, pubStored, nonce)
	if (!base) return {}
	const schema = settingsSchemaOf(manifest)
	const hasUserFields = Object.keys(userScopedSchema(schema)).length > 0
	const byUser: NonNullable<PluginDescriptor["settingsByUser"]> = {}
	if (hasUserFields)
		for (const row of userRows) {
			const own = hookSettingsFor(
				manifest,
				layeredStored(schema, pubStored, row.settings),
				nonce
			)!
			byUser[String(row.userId)] = {
				settings: own.settings,
				...(Object.keys(own.secrets).length ? { secrets: own.secrets } : {})
			}
		}
	return {
		settings: base.settings,
		...(Object.keys(base.secrets).length ||
		Object.values(byUser).some((u) => u.secrets)
			? { secrets: base.secrets, lentSecrets: base.lent, secretNonce: nonce }
			: {}),
		...(Object.keys(byUser).length ? { settingsByUser: byUser } : {})
	}
}

/** Every stored user row for these plugins, grouped by plugin id. */
export async function loadPluginUserSettingsRows(
	db: Db,
	pluginIds: readonly string[]
): Promise<Map<string, PluginUserSettingsRow[]>> {
	const out = new Map<string, PluginUserSettingsRow[]>()
	if (!pluginIds.length) return out
	const rows = await db
		.select({
			pluginId: pluginUserSettings.pluginId,
			userId: pluginUserSettings.userId,
			settings: pluginUserSettings.settings
		})
		.from(pluginUserSettings)
		.where(inArray(pluginUserSettings.pluginId, [...pluginIds]))
	for (const r of rows) {
		const list = out.get(r.pluginId) ?? []
		list.push({ userId: r.userId, settings: r.settings })
		out.set(r.pluginId, list)
	}
	return out
}

/** One person's stored values for a plugin — `{}` when they have set none. */
export async function readUserPluginSettings(
	db: Db,
	pluginId: string,
	userId: number
): Promise<Record<string, unknown>> {
	const [row] = await db
		.select({ settings: pluginUserSettings.settings })
		.from(pluginUserSettings)
		.where(
			and(
				eq(pluginUserSettings.pluginId, pluginId),
				eq(pluginUserSettings.userId, userId)
			)
		)
	return stored(row?.settings)
}

/**
 * Persist one person's values. An empty map deletes their row, so a person
 * who cleared everything has nothing stored. The caller re-syncs the manager.
 */
export async function writeUserPluginSettings(
	db: Db,
	pluginId: string,
	userId: number,
	next: Record<string, unknown>
): Promise<void> {
	if (!Object.keys(next).length) {
		await db
			.delete(pluginUserSettings)
			.where(
				and(
					eq(pluginUserSettings.pluginId, pluginId),
					eq(pluginUserSettings.userId, userId)
				)
			)
		return
	}
	await db
		.insert(pluginUserSettings)
		.values({ pluginId, userId, settings: next })
		.onConflictDoUpdate({
			target: [pluginUserSettings.pluginId, pluginUserSettings.userId],
			set: { settings: next, updatedAt: new Date() }
		})
}

/** Persist a successful write. The caller re-syncs the manager afterwards. */
export async function writePluginSettings(
	db: Db,
	pluginId: string,
	next: Record<string, unknown>
): Promise<void> {
	await db
		.update(plugins)
		.set({ settings: next, updatedAt: new Date() })
		.where(eq(plugins.pluginId, pluginId))
}

/** Guard for tests and callers that need to know a value is the stored envelope. */
export const isStoredSecret = isSecret
