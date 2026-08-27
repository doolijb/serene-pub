/**
 * Plugin settings — the app half of 12 §6's "one declaration, four uses".
 *
 * The SDK owns the declaration and every pure judgement about it (`checkValues`,
 * `reconcile`, `forClient`, `forOwningHook`, `configState` — settings.ts). What
 * lives here is only what the SDK cannot know: where the values are stored
 * (`plugins.settings`), and the instance's crypto.
 *
 * ## Secrets (13 §6)
 *
 * A `secret` field's stored form is the SDK's typed `{$secret: true, value}`
 * envelope with `value` holding AES-256-GCM ciphertext under the app secret —
 * its own HKDF key class, so a plugin setting is cryptographically independent
 * of connection keys despite sharing the root secret. The type is what makes
 * custody defensible: core mechanically masks it to the client (`forClient`
 * reports only set/unset), never exports it, and decrypts it only into the
 * declaring plugin's own hook invocations (`forOwningHook`).
 *
 * ## Delivery
 *
 * Resolved values ride the descriptor (`PluginDescriptor.settings`) and the
 * manager merges them into every hook's input as the reserved `settings` key —
 * the same per-call injection posture as F18's connection material. Updating a
 * setting re-registers the descriptor, so the next call sees the new values
 * and an in-flight one keeps the values it started with.
 */

import { eq } from "drizzle-orm"
import { plugins } from "$lib/server/db/schema"
import {
	checkValues,
	configState,
	forClient,
	forOwningHook,
	isSecret,
	reconcile,
	type PluginConfigState,
	type SettingsSchema
} from "@serene-pub/sdk"
import {
	encryptToken,
	decryptToken,
	type EncryptedToken
} from "$lib/server/utils/tokenCrypto"

type Db = { select: any; update: any }

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
 * The values a hook invocation receives — plaintext, only here, only for the
 * declaring plugin. Undefined when the manifest declares no settings, so the
 * manager can skip injecting a key the plugin never asked for.
 */
export function hookSettingsFor(
	manifest: unknown,
	settings: unknown
): Record<string, unknown> | undefined {
	const schema = settingsSchemaOf(manifest)
	if (!Object.keys(schema).length) return undefined
	const r = reconcile(schema, stored(settings))
	return forOwningHook(schema, r.values, (cipher) => {
		try {
			return decryptToken(
				JSON.parse(cipher) as EncryptedToken,
				PLUGIN_SETTINGS_KEY_INFO
			)
		} catch {
			// A key mismatch (restored backup, 13 §5) fails loudly and locally
			// at the field, not the call: the hook sees an empty string and
			// the admin re-enters the secret.
			return ""
		}
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
