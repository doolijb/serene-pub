/**
 * Which socket events the admin logbook records, and how — as data.
 *
 * The socket wrapper (`sockets/index.ts` `register`) asks this table about
 * every event it dispatches; an event that is not here costs one map lookup.
 * An event that is here gets its object snapshotted before the handler runs
 * and after it succeeds, and the difference is the record. A handler never
 * has to know it is being logged, so a new admin verb is covered by adding a
 * row here, not by remembering a call.
 *
 * Only an ADMIN actor's change is recorded (the logbook is the pub's
 * change history, not a user's activity), and only on success: no throw, no
 * `{event}:error` emitted, no `{ error }` returned.
 *
 * ⚠ Nothing here may return a secret. Snapshots go through `diff.ts`'s
 * redaction by field name, and the few snapshots that read a secret column's
 * PRESENCE (never its value) say so.
 */
import { desc, eq } from "drizzle-orm"
import { capabilityLabel, type CapabilityId } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type {
	LogbookAction,
	LogbookObjectTypeId
} from "$lib/shared/adminLogbook"

export interface ObjectSnapshot {
	/** The object's name, as a person reads it. */
	label: string
	/** Its fields; redacted and diffed by `diff.ts`. */
	fields: Record<string, unknown>
}

export type Snapshot = (
	db: Db,
	id: string | null,
	params: any
) => Promise<ObjectSnapshot | null>

export interface LogbookEventSpec {
	objectType: LogbookObjectTypeId
	action: LogbookAction
	/** The object's id, read from the params before the handler runs. */
	id?: (params: any) => unknown
	/**
	 * For an add: where the new id is in the handler's reply. `true` takes the
	 * first plausible one (`diff.ts` `idFromResult`); a string names the key.
	 */
	idFromResult?: true | string
	/**
	 * The object's state. Read before the handler (change, delete, other) and
	 * after it (add, change); the two are diffed for a change.
	 */
	snapshot?: Snapshot
	/** Params recorded as the change when there is no snapshot to diff. */
	fields?: readonly string[]
	/** A sentence of the descriptor's own, instead of the generic one. */
	verb?: (params: any, label: string) => string
	/** The object's name from the params, when no snapshot supplies one. */
	label?: (params: any) => string | null | undefined
	/** Record only when this holds, e.g. a pipeline change at pub scope. */
	when?: (params: any) => boolean
}

/* ── snapshots ────────────────────────────────────────────────────────── */

const num = (id: string | null) => {
	const n = Number(id)
	return id != null && Number.isInteger(n) ? n : null
}

/** One row by integer id, labelled by `labelOf`. */
function rowById(
	table: any,
	labelOf: (row: any) => string = (r) => r.name ?? ""
): Snapshot {
	return async (db, id) => {
		const n = num(id)
		if (n == null) return null
		const [row] = await (db as any)
			.select()
			.from(table)
			.where(eq(table.id, n))
			.limit(1)
		return row ? { label: String(labelOf(row) ?? ""), fields: row } : null
	}
}

/** A singleton settings row (`id = 1`, or the first row). */
function singleton(
	table: any,
	label: string,
	omit: readonly string[] = []
): Snapshot {
	return async (db) => {
		const [row] = await (db as any).select().from(table).limit(1)
		if (!row) return { label, fields: {} }
		const fields = { ...row }
		for (const k of omit) delete fields[k]
		return { label, fields }
	}
}

/** The newest row of a name — for an add whose reply carries no id. */
export function newestByName(table: any): Snapshot {
	return async (db, _id, params) => {
		const name = typeof params?.name === "string" ? params.name : null
		if (!name) return null
		const [row] = await (db as any)
			.select()
			.from(table)
			.where(eq(table.name, name))
			.orderBy(desc(table.id))
			.limit(1)
		return row ? { label: row.name, fields: row } : null
	}
}

const componentLabel = (r: any) => {
	const l = r.label
	if (typeof l === "string") return l
	if (l && typeof l === "object")
		return String(l.en ?? Object.values(l)[0] ?? r.slug)
	return r.slug ?? ""
}

/**
 * A component's snapshot WITHOUT its source files: the diff would be every
 * byte of every file, clipped into noise. Whether the source moved is one
 * line (`source hash`).
 */
const componentSnap: Snapshot = async (db, id) => {
	if (!id) return null
	const [row] = await (db as any)
		.select()
		.from(schema.authoredComponents)
		.where(eq(schema.authoredComponents.id, id))
		.limit(1)
	if (!row) return null
	const {
		files: _f,
		draftFiles: _df,
		draftErrors: _de,
		lastError: _le,
		fingerprint: _fp,
		artifactHash: _ah,
		...fields
	} = row
	return { label: componentLabel(row), fields }
}

const pluginSnap: Snapshot = async (db, id) => {
	if (!id) return null
	const [row] = await (db as any)
		.select()
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, id))
		.limit(1)
	if (!row) return null
	// The manifest and the bundle are the package, not its settings; an
	// update is one `version` line, not the whole manifest re-diffed.
	const { manifest: _m, bundleSource: _b, bundleHash: _h, ...fields } = row
	return { label: row.name ?? row.pluginId, fields }
}

const genreSnap: Snapshot = async (db, id) => {
	if (!id) return null
	const [row] = await (db as any)
		.select()
		.from(schema.sessionGenreSettings)
		.where(eq(schema.sessionGenreSettings.genreId, id))
		.limit(1)
	return { label: id, fields: row ?? {} }
}

const capabilityDefaultSnap: Snapshot = async (db, id) => {
	if (!id) return null
	const { capabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	const row = await capabilityDefault(db, id)
	// Names, not ids: "Changed connection from “none” to “Ollama”" is the line a
	// person can read. The capability's own label names the job ("Chat").
	const nameOf = async (table: any, rowId: number | null, col: string) => {
		if (rowId == null) return null
		const [r] = await (db as any)
			.select()
			.from(table)
			.where(eq(table.id, rowId))
			.limit(1)
		return r ? String(r[col] ?? rowId) : `#${rowId}`
	}
	return {
		label: `${capabilityLabel(id as CapabilityId)} default`,
		fields: {
			connection: await nameOf(schema.connections, row?.connectionId ?? null, "name"),
			model: await nameOf(
				schema.connectionModels,
				row?.connectionModelId ?? null,
				"name"
			),
			sampling: await nameOf(
				schema.samplingConfigs,
				row?.samplingConfigId ?? null,
				"name"
			)
		}
	}
}

const tunnelSnap = singleton(schema.tunnels, "Tunnel")

/**
 * The pub settings row, less the CharaVault credential columns (redacted
 * anyway by name — dropped here so an unrelated change never even diffs them).
 */
const pubSnap = singleton(schema.systemSettings, "Pub settings", [
	"charaVaultEncryptedToken",
	"charaVaultTokenIv",
	"charaVaultTokenAuthTag",
	"recoveryKeyHash"
])

/**
 * The KoboldCPP manager's settings. The admin password column is replaced by
 * whether one is set, so setting or clearing it is a line and its value is
 * never read into the record.
 */
const koboldSnap: Snapshot = async (db) => {
	const [row] = await (db as any)
		.select()
		.from(schema.koboldCppSettings)
		.limit(1)
	if (!row) return { label: "KoboldCPP manager", fields: {} }
	const { koboldCppManagedAdminPassword, ...fields } = row
	return {
		label: "KoboldCPP manager",
		fields: { ...fields, adminPasswordSet: !!koboldCppManagedAdminPassword }
	}
}

const ollamaSnap = singleton(schema.ollamaSettings, "Ollama manager")

/** The CharaVault account: which e-mail is connected, never the token. */
const charaVaultSnap: Snapshot = async (db) => {
	const [row] = await (db as any)
		.select({
			email: schema.systemSettings.charaVaultEmail,
			tokenSet: schema.systemSettings.charaVaultEncryptedToken
		})
		.from(schema.systemSettings)
		.limit(1)
	return {
		label: "CharaVault",
		fields: { email: row?.email ?? null, connected: !!row?.tokenSet }
	}
}

const userSnap: Snapshot = async (db, id) => {
	const n = num(id)
	if (n == null) return null
	const [row] = await (db as any)
		.select({
			username: schema.users.username,
			displayName: schema.users.displayName,
			isAdmin: schema.users.isAdmin,
			isDeleted: schema.users.isDeleted
		})
		.from(schema.users)
		.where(eq(schema.users.id, n))
		.limit(1)
	return row ? { label: row.username, fields: row } : null
}

const inviteSnap: Snapshot = async (db, id) => {
	const n = num(id)
	if (n == null) return null
	const [row] = await (db as any)
		.select({
			kind: schema.accountInvites.kind,
			userId: schema.accountInvites.userId,
			expiresAt: schema.accountInvites.expiresAt,
			revokedAt: schema.accountInvites.revokedAt
		})
		.from(schema.accountInvites)
		.where(eq(schema.accountInvites.id, n))
		.limit(1)
	if (!row) return null
	return {
		label: row.kind === "account" ? `Reset for user #${row.userId}` : "Sign-up",
		fields: row
	}
}

const templateTable = (kind: unknown) =>
	kind === "variable"
		? schema.pipelineVariableTemplates
		: schema.pipelineContextTemplates

const libraryTemplateSnap: Snapshot = (db, id, params) =>
	rowById(templateTable(params?.kind))(db, id, params)

/* ── helpers for the table ────────────────────────────────────────────── */

const idOf = (p: any) => p?.id
/** A pipeline change made to the pub, not inside one session. */
const pubScope = (p: any) => p?.sessionId == null
const q = (s: unknown) => (s == null || s === "" ? "" : ` “${String(s)}”`)

const systemSetting = (
	fields?: readonly string[]
): LogbookEventSpec => ({
	objectType: "pub",
	action: "change",
	snapshot: pubSnap,
	...(fields ? { fields } : {})
})

const kobold: LogbookEventSpec = {
	objectType: "koboldcpp",
	action: "change",
	snapshot: koboldSnap
}

const connection = (
	action: LogbookAction,
	extra: Partial<LogbookEventSpec> = {}
): LogbookEventSpec => ({
	objectType: "connection",
	action,
	id: idOf,
	snapshot: rowById(schema.connections),
	...extra
})

const byName = (table: any) => rowById(table)

/* ── the table ────────────────────────────────────────────────────────── */

export const LOGBOOK_EVENTS: Record<string, LogbookEventSpec> = {
	/* Pub settings */
	"systemSettings:updateScriptsEnabled": systemSetting(),
	"systemSettings:updateContextDebuggingEnabled": systemSetting(),
	"systemSettings:updateAccountsEnabled": systemSetting(),
	"systemSettings:updateRequireTwoFactor": systemSetting(),
	"systemSettings:updateDefaultLanguage": systemSetting(),
	"systemSettings:updateLoreWriteModeDefault": systemSetting(),
	"systemSettings:updateAutoTranslate": systemSetting(),
	"systemSettings:updateBackupSettings": systemSetting(),
	"customThemes:setPubTheme": {
		objectType: "theme",
		action: "change",
		id: idOf,
		snapshot: rowById(schema.customThemes, (r) => r.label ?? r.name),
		verb: (p, label) =>
			p?.enabled
				? `Made${q(label)} the pub theme`
				: `Stopped using${q(label)} as the pub theme`
	},
	"cardSources:charaVault:connect": {
		objectType: "chara-vault",
		action: "change",
		snapshot: charaVaultSnap
	},
	"cardSources:charaVault:disconnect": {
		objectType: "chara-vault",
		action: "change",
		snapshot: charaVaultSnap
	},

	/* Network */
	"tunnels:updateConfig": {
		objectType: "tunnel",
		action: "change",
		snapshot: tunnelSnap
	},
	"tunnels:enable": {
		objectType: "tunnel",
		action: "change",
		snapshot: tunnelSnap
	},
	"tunnels:disable": {
		objectType: "tunnel",
		action: "change",
		snapshot: tunnelSnap
	},

	/* People */
	"users:create": {
		objectType: "user",
		action: "add",
		idFromResult: "user",
		snapshot: userSnap,
		label: (p) => p?.username
	},
	"users:update": {
		objectType: "user",
		action: "change",
		id: idOf,
		snapshot: userSnap,
		// The passphrase is not a column of the snapshot; a reset is a line.
		fields: ["passphrase"]
	},
	"users:delete": {
		objectType: "user",
		action: "delete",
		id: idOf,
		snapshot: userSnap
	},
	"invites:create": {
		objectType: "invite",
		action: "add",
		idFromResult: "id",
		snapshot: inviteSnap,
		fields: ["kind", "userId"]
	},
	"invites:revoke": {
		objectType: "invite",
		action: "delete",
		id: idOf,
		snapshot: inviteSnap,
		verb: (_p, label) => `Revoked invite${q(label)}`
	},
	"totp:adminClear": {
		objectType: "two-factor",
		action: "other",
		id: (p) => p?.userId,
		snapshot: userSnap,
		verb: (_p, label) => `Cleared two-factor for${q(label)}`
	},

	/* Data */
	"backups:create": {
		objectType: "backup",
		action: "add",
		idFromResult: "backup.name",
		label: (p) => p?.label,
		fields: ["label", "includeUserFiles"]
	},
	"backups:delete": {
		objectType: "backup",
		action: "delete",
		id: (p) => p?.name,
		label: (p) => p?.name,
		fields: ["kind"]
	},
	"systemSettings:updateKoboldCppManagerEnabled": kobold,
	"systemSettings:updateOllamaManagerEnabled": {
		objectType: "ollama",
		action: "change",
		snapshot: ollamaSnap
	},

	/* Models */
	"connections:create": connection("add", {
		id: undefined,
		idFromResult: "connection",
		label: (p) => p?.connection?.name
	}),
	"connections:update": connection("change", {
		id: (p) => p?.connection?.id
	}),
	"connections:delete": connection("delete"),
	"connections:setCapability": connection("change", {
		fields: ["capability"],
		verb: (p) => `Set capability${q(p?.capability)}`
	}),
	"connections:attachScript": connection("change", {
		fields: ["scriptId"],
		verb: (p) => `Attached script #${p?.scriptId}`
	}),
	"connections:detachScript": connection("change", {
		fields: ["scriptId"],
		verb: (p) => `Detached script #${p?.scriptId}`
	}),
	"connections:createModel": connection("change", {
		fields: ["model"],
		verb: (p) => `Added model${q(p?.model?.name ?? p?.model?.modelId)}`
	}),
	"connections:updateModel": connection("change", {
		fields: ["modelId", "model"],
		verb: (p) => `Changed model #${p?.modelId}`
	}),
	"connections:deleteModel": connection("change", {
		fields: ["modelId"],
		verb: (p) => `Deleted model #${p?.modelId}`
	}),
	"connections:importModels": connection("change", {
		verb: (p) =>
			`Imported ${Array.isArray(p?.models) ? p.models.length : ""} models`.replace(
				"  ",
				" "
			)
	}),
	"connections:setDefault": {
		objectType: "capability-default",
		action: "change",
		id: (p) => p?.capability,
		snapshot: capabilityDefaultSnap
	},
	"connectionDefaults:set": {
		objectType: "capability-default",
		action: "change",
		id: (p) => p?.capability,
		snapshot: capabilityDefaultSnap
	},
	"samplingConfigs:create": {
		objectType: "sampling-config",
		action: "add",
		idFromResult: "sampling",
		snapshot: byName(schema.samplingConfigs),
		label: (p) => p?.sampling?.name
	},
	"samplingConfigs:update": {
		objectType: "sampling-config",
		action: "change",
		id: (p) => p?.sampling?.id,
		snapshot: byName(schema.samplingConfigs)
	},
	"samplingConfigs:delete": {
		objectType: "sampling-config",
		action: "delete",
		id: idOf,
		snapshot: byName(schema.samplingConfigs)
	},

	/* Managers */
	"koboldcpp:setBaseUrl": kobold,
	"koboldcpp:setModelsDir": kobold,
	"koboldcpp:setManagedMode": kobold,
	"koboldcpp:setManagedPort": kobold,
	"koboldcpp:setManagedBinaryDir": kobold,
	"koboldcpp:setManagedAdminPassword": kobold,
	"koboldcpp:setModelTtl": kobold,
	"koboldcpp:setSubprocessTimeout": kobold,
	"koboldcpp:setModelKind": {
		objectType: "koboldcpp",
		action: "other",
		fields: ["filename", "kind"],
		verb: (p) => `Marked${q(p?.filename)} as ${p?.kind ?? "a model"}`
	},
	"koboldcpp:startSubprocess": {
		objectType: "koboldcpp",
		action: "other",
		verb: () => "Started the KoboldCPP process"
	},
	"koboldcpp:stopSubprocess": {
		objectType: "koboldcpp",
		action: "other",
		verb: () => "Stopped the KoboldCPP process"
	},
	"koboldcpp:downloadModel": {
		objectType: "koboldcpp",
		action: "other",
		fields: ["kind", "repo", "filename", "url"],
		verb: (p) => `Started downloading${q(p?.filename ?? p?.url)}`
	},
	"koboldcpp:deleteModel": {
		objectType: "koboldcpp",
		action: "other",
		fields: ["modelName"],
		verb: (p) => `Deleted model file${q(p?.modelName)}`
	},
	"koboldcpp:downloadBinary": {
		objectType: "koboldcpp",
		action: "other",
		fields: ["releaseTag", "assetName"],
		verb: (p) => `Started downloading KoboldCPP${q(p?.releaseTag)}`
	},
	"ollama:setBaseUrl": {
		objectType: "ollama",
		action: "change",
		snapshot: ollamaSnap
	},
	"ollama:pullModel": {
		objectType: "connection",
		action: "other",
		id: (p) => p?.connectionId,
		snapshot: rowById(schema.connections),
		fields: ["modelName"],
		verb: (p) => `Started pulling${q(p?.modelName)}`
	},
	"ollama:deleteModel": {
		objectType: "connection",
		action: "other",
		id: (p) => p?.connectionId,
		snapshot: rowById(schema.connections),
		fields: ["modelName"],
		verb: (p) => `Deleted Ollama model${q(p?.modelName)}`
	},

	/* Play */
	"sessionGenres:update": {
		objectType: "session-genre",
		action: "change",
		id: (p) => p?.slug,
		snapshot: genreSnap
	},
	"sessionGenres:setPresetsEnabled": {
		objectType: "session-genre",
		action: "change",
		id: (p) => p?.genreId,
		fields: ["enabled"],
		verb: (p) => (p?.enabled ? "Turned presets on" : "Turned presets off")
	},
	"sessionGenres:setSwapEnabled": {
		objectType: "session-genre",
		action: "change",
		id: (p) => p?.genreId,
		fields: ["pluginId", "spec", "node", "definition", "enabled"],
		verb: (p) =>
			`${p?.enabled ? "Enabled" : "Disabled"} swap${q(p?.definition ?? p?.node)}`
	},
	"sessionPresets:create": {
		objectType: "session-preset",
		action: "add",
		idFromResult: "preset",
		snapshot: byName(schema.sessionPresets),
		label: (p) => p?.name
	},
	"sessionPresets:update": {
		objectType: "session-preset",
		action: "change",
		id: idOf,
		snapshot: byName(schema.sessionPresets)
	},
	"sessionPresets:delete": {
		objectType: "session-preset",
		action: "delete",
		id: idOf,
		snapshot: byName(schema.sessionPresets)
	},

	/* Pipelines — pub scope only; a session's own override is its owner's. */
	"pipelines:setOption": {
		objectType: "pipeline",
		action: "change",
		id: (p) => p?.slug,
		label: (p) => p?.slug,
		when: pubScope,
		fields: ["configId", "optionId"],
		// The VALUE is not recorded: an option may be a credential, and the
		// panel stores those sealed with the pub secret.
		verb: (p) => `Changed option${q(p?.optionId)}`
	},
	"pipelines:clearOption": {
		objectType: "pipeline",
		action: "change",
		id: (p) => p?.slug,
		label: (p) => p?.slug,
		when: pubScope,
		fields: ["configId", "optionId"],
		verb: (p) => `Reset option${q(p?.optionId)}`
	},
	"pipelines:setOptions": {
		objectType: "pipeline",
		action: "change",
		id: (p) => p?.slug,
		label: (p) => p?.slug,
		when: pubScope,
		fields: ["configId"],
		verb: (p) => {
			const set = p?.set && typeof p.set === "object" ? Object.keys(p.set) : []
			const clear = Array.isArray(p?.clear) ? p.clear : []
			const n = set.length + clear.length
			return `Changed ${n} option${n === 1 ? "" : "s"}`
		}
	},
	"pipelines:resetConfig": {
		objectType: "pipeline",
		action: "change",
		id: (p) => p?.slug,
		label: (p) => p?.slug,
		when: pubScope,
		fields: ["configId"],
		verb: () => "Reset a configuration to its defaults"
	},
	"pipelines:setPresetActions": {
		objectType: "pipeline",
		action: "change",
		id: (p) => p?.slug,
		label: (p) => p?.slug,
		when: pubScope,
		fields: ["configId", "includedActions", "enabled"]
	},
	"pipelines:createConfig": {
		objectType: "pipeline",
		action: "change",
		id: (p) => p?.slug,
		label: (p) => p?.slug,
		when: pubScope,
		fields: ["name", "fromConfigId"],
		verb: (p) => `Added configuration${q(p?.name)}`
	},
	"pipelines:renameConfig": {
		objectType: "pipeline",
		action: "change",
		id: (p) => p?.slug,
		label: (p) => p?.slug,
		when: pubScope,
		fields: ["configId", "name"],
		verb: (p) => `Renamed configuration #${p?.configId} to${q(p?.name)}`
	},
	"pipelines:deleteConfig": {
		objectType: "pipeline",
		action: "change",
		id: (p) => p?.slug,
		label: (p) => p?.slug,
		when: pubScope,
		fields: ["configId"],
		verb: (p) => `Deleted configuration #${p?.configId}`
	},
	"pipelines:selectConfig": {
		objectType: "pipeline",
		action: "change",
		id: (p) => p?.slug,
		label: (p) => p?.slug,
		when: pubScope,
		fields: ["configId", "scope"],
		verb: (p) => `Selected configuration #${p?.configId}`
	},

	/* Writing — through a pipeline's panel (pub scope) and the library */
	"pipelines:createPrompt": {
		objectType: "prompt",
		action: "add",
		idFromResult: "promptId",
		snapshot: byName(schema.pipelinePrompts),
		label: (p) => p?.name,
		when: pubScope
	},
	"pipelines:clonePrompt": {
		objectType: "prompt",
		action: "add",
		idFromResult: "promptId",
		snapshot: byName(schema.pipelinePrompts),
		label: (p) => p?.name,
		when: pubScope
	},
	"pipelines:updatePrompt": {
		objectType: "prompt",
		action: "change",
		id: (p) => p?.promptId,
		snapshot: byName(schema.pipelinePrompts),
		when: pubScope
	},
	"pipelines:deletePrompt": {
		objectType: "prompt",
		action: "delete",
		id: (p) => p?.promptId ?? p?.templateId,
		snapshot: byName(schema.pipelinePrompts),
		when: pubScope
	},
	"pipelines:libraryClonePrompt": {
		objectType: "prompt",
		action: "add",
		snapshot: newestByName(schema.pipelinePrompts),
		label: (p) => p?.name
	},
	"pipelines:libraryUpdatePrompt": {
		objectType: "prompt",
		action: "change",
		id: idOf,
		snapshot: byName(schema.pipelinePrompts)
	},
	"pipelines:libraryDeletePrompt": {
		objectType: "prompt",
		action: "delete",
		id: idOf,
		snapshot: byName(schema.pipelinePrompts)
	},
	"pipelines:createContextTemplate": {
		objectType: "context-template",
		action: "add",
		idFromResult: "templateId",
		snapshot: byName(schema.pipelineContextTemplates),
		label: (p) => p?.name,
		when: pubScope
	},
	"pipelines:cloneContextTemplate": {
		objectType: "context-template",
		action: "add",
		idFromResult: "templateId",
		snapshot: byName(schema.pipelineContextTemplates),
		label: (p) => p?.name,
		when: pubScope
	},
	"pipelines:updateContextTemplate": {
		objectType: "context-template",
		action: "change",
		id: (p) => p?.templateId,
		snapshot: byName(schema.pipelineContextTemplates),
		when: pubScope
	},
	"pipelines:deleteContextTemplate": {
		objectType: "context-template",
		action: "delete",
		id: (p) => p?.templateId,
		snapshot: byName(schema.pipelineContextTemplates),
		when: pubScope
	},
	"pipelines:cloneVariableTemplate": {
		objectType: "variable-template",
		action: "add",
		idFromResult: "templateId",
		snapshot: byName(schema.pipelineVariableTemplates),
		label: (p) => p?.name,
		when: pubScope
	},
	"pipelines:updateVariableTemplate": {
		objectType: "variable-template",
		action: "change",
		id: (p) => p?.templateId,
		snapshot: byName(schema.pipelineVariableTemplates),
		when: pubScope
	},
	"pipelines:deleteVariableTemplate": {
		objectType: "variable-template",
		action: "delete",
		id: (p) => p?.templateId,
		snapshot: byName(schema.pipelineVariableTemplates),
		when: pubScope
	},
	// The library's template verbs carry `kind`; the record's object type
	// follows it (see `resolveObjectType`).
	"pipelines:libraryCreateTemplate": {
		objectType: "context-template",
		action: "add",
		snapshot: async (db, id, p) =>
			newestByName(templateTable(p?.kind))(db, id, p),
		label: (p) => p?.name
	},
	"pipelines:libraryCloneTemplate": {
		objectType: "context-template",
		action: "add",
		snapshot: async (db, id, p) =>
			newestByName(templateTable(p?.kind))(db, id, p),
		label: (p) => p?.name
	},
	"pipelines:libraryUpdateTemplate": {
		objectType: "context-template",
		action: "change",
		id: idOf,
		snapshot: libraryTemplateSnap
	},
	"pipelines:libraryDeleteTemplate": {
		objectType: "context-template",
		action: "delete",
		id: idOf,
		snapshot: libraryTemplateSnap
	},
	"pipelines:createScript": {
		objectType: "script",
		action: "add",
		snapshot: newestByName(schema.pipelineScripts),
		label: (p) => p?.name
	},
	"pipelines:cloneScript": {
		objectType: "script",
		action: "add",
		snapshot: newestByName(schema.pipelineScripts),
		label: (p) => p?.name
	},
	"pipelines:updateScript": {
		objectType: "script",
		action: "change",
		id: idOf,
		snapshot: byName(schema.pipelineScripts)
	},
	"pipelines:deleteScript": {
		objectType: "script",
		action: "delete",
		id: idOf,
		snapshot: byName(schema.pipelineScripts)
	},
	"pipelines:importScripts": {
		objectType: "script",
		action: "other",
		verb: () => "Imported scripts"
	},
	"completionTemplates:create": {
		objectType: "completion-template",
		action: "add",
		idFromResult: "completionTemplate",
		snapshot: byName(schema.completionTemplates),
		label: (p) => p?.completionTemplate?.name
	},
	"completionTemplates:update": {
		objectType: "completion-template",
		action: "change",
		id: (p) => p?.completionTemplate?.id,
		snapshot: byName(schema.completionTemplates)
	},
	"completionTemplates:delete": {
		objectType: "completion-template",
		action: "delete",
		id: idOf,
		snapshot: byName(schema.completionTemplates)
	},
	"completionTemplates:clone": {
		objectType: "completion-template",
		action: "add",
		idFromResult: "completionTemplate",
		snapshot: byName(schema.completionTemplates)
	},

	/* Extensions */
	"plugins:install": {
		objectType: "plugin",
		action: "add",
		id: (p) => p?.pluginId,
		snapshot: pluginSnap,
		label: (p) => p?.name ?? p?.pluginId
	},
	"plugins:installLocal": {
		objectType: "plugin",
		action: "add",
		idFromResult: "pluginId",
		snapshot: pluginSnap,
		fields: ["dir"]
	},
	"plugins:uninstall": {
		objectType: "plugin",
		action: "delete",
		id: (p) => p?.pluginId,
		snapshot: pluginSnap
	},
	"plugins:setEnabled": {
		objectType: "plugin",
		action: "change",
		id: (p) => p?.pluginId,
		snapshot: pluginSnap
	},
	"plugins:setBackend": {
		objectType: "plugin",
		action: "change",
		id: (p) => p?.pluginId,
		snapshot: pluginSnap
	},
	"plugins:setSequential": {
		objectType: "plugin",
		action: "change",
		id: (p) => p?.pluginId,
		snapshot: pluginSnap
	},
	"plugins:setPermission": {
		objectType: "plugin",
		action: "change",
		id: (p) => p?.pluginId,
		snapshot: pluginSnap,
		verb: (p) =>
			`${p?.granted ? "Granted" : "Denied"} permission${q(p?.key)}`
	},
	"plugins:reviewPermissions": {
		objectType: "plugin",
		action: "change",
		id: (p) => p?.pluginId,
		snapshot: pluginSnap
	},
	"plugins:setStorageQuota": {
		objectType: "plugin",
		action: "change",
		id: (p) => p?.pluginId,
		snapshot: pluginSnap
	},
	"plugins:setSettings": {
		objectType: "plugin",
		action: "change",
		id: (p) => p?.pluginId,
		snapshot: pluginSnap
	},
	"components:create": {
		objectType: "component",
		action: "add",
		idFromResult: "component",
		snapshot: componentSnap
	},
	"components:clone": {
		objectType: "component",
		action: "add",
		idFromResult: "component",
		snapshot: componentSnap
	},
	"components:import": {
		objectType: "component",
		action: "add",
		idFromResult: "component",
		snapshot: componentSnap
	},
	"components:save": {
		objectType: "component",
		action: "change",
		id: idOf,
		snapshot: componentSnap
	},
	"components:revertDraft": {
		objectType: "component",
		action: "change",
		id: idOf,
		snapshot: componentSnap,
		verb: () => "Discarded the draft"
	},
	"components:setEnabled": {
		objectType: "component",
		action: "change",
		id: idOf,
		snapshot: componentSnap
	},
	"components:reviewScopes": {
		objectType: "component",
		action: "change",
		id: idOf,
		snapshot: componentSnap
	},
	"components:delete": {
		objectType: "component",
		action: "delete",
		id: idOf,
		snapshot: componentSnap
	}
}

/** The spec for an event, or null — the wrapper's one lookup per dispatch. */
export function logbookSpecFor(event: string): LogbookEventSpec | null {
	return Object.hasOwn(LOGBOOK_EVENTS, event) ? LOGBOOK_EVENTS[event] : null
}

/** A spec's object type for these params — the library template verbs follow `kind`. */
export function resolveObjectType(
	spec: LogbookEventSpec,
	params: any
): LogbookObjectTypeId {
	if (spec.objectType === "context-template" && params?.kind === "variable")
		return "variable-template"
	return spec.objectType
}

