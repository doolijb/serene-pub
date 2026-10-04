/**
 * Connections, sampling configs, the instance's settings, and the managers.
 *
 * A 0.5.3 connection was one model on a service; 0.6 splits the endpoint from
 * its models. Rows that reach the same service — same type, address and key
 * (`connectionGroups.ts`, the endpoint signature) — become ONE endpoint with a
 * model row each, named the way 0.6 names a new connection to that service,
 * keeping the first row's id; every other row's id maps to it, and whatever it
 * set differently rides on its own model as an override. A note says what was
 * combined or renamed. The endpoint's `extra_json` — the encrypted API key
 * included — is carried as it is, because both versions encrypt it under the
 * same key and the same `meta.json` secret. The pieces are the ones
 * `connections:create` runs, in its order: defaults merged under the row, the
 * preset normalised, capabilities resolved from the static manifest (never by
 * loading an adapter), then the model rows.
 *
 * Type changes:
 *   · `llamacpp_completion` → `llamacpp` (one type per service; the wire mode
 *     is a capability, and the manifest leaves this row on completion);
 *   · `llmman` → an **Ollama** connection at the same base URL, its options
 *     (`think`, `keepAlive`, `useChat`, `stream`) carried as they were (owner
 *     ruling D9, revised 2026-10-01), with a note — the type is gone and its
 *     adapter with it.
 *
 * The 0.5.3 embedding singleton (`vectorization_configs` plus two settings
 * columns) becomes an embedding connection, starred when it was enabled; its
 * API key is quarantined for the `embedding` boot task to re-encrypt under the
 * connection key class.
 */
import { createHash } from "node:crypto"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { normalizeSamplingRow, S } from "@serene-pub/sdk"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { withConnectionDefaults } from "$lib/shared/utils/connectionDefaults"
import { normalizeConnectionPreset } from "$lib/shared/connectionAdapters/presetSlug"
import { resolveConnectionCapabilities } from "$lib/server/connections/resolve"
import { ensureConnectionModel } from "$lib/server/connections/models"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"
import { modalityForKind } from "$lib/server/localModels/registry"
import { uniqueName } from "$lib/shared/connections/connectionName"
import * as attic from "../tables"
import {
	groupLegacyConnections,
	groupNote,
	nameGroups,
	serviceName,
	type LegacyEndpointRow
} from "./connectionGroups"
import {
	countAdd,
	countDrop,
	countLoss,
	insertBatched,
	mapFor,
	mapped,
	maxId,
	type RestoreContext
} from "../context"

const LLMMAN = "llmman"
const LLAMACPP_COMPLETION = "llamacpp_completion"
const TEXT_CAPABILITY = "text->text"
const EMBEDDING_CAPABILITY = "text->embedding"
const LEGACY_VECTORIZATION_KEY = "__legacyVectorizationApiKey"

/** 0.5.3's flat sampler columns, by the shape key each one became. */
const SAMPLERS = [
	"temperature",
	"topP",
	"topK",
	"minP",
	"typicalP",
	"seed",
	"repetitionPenalty",
	"repeatLastN",
	"frequencyPenalty",
	"presencePenalty",
	"penalizeNewline",
	"mirostat",
	"mirostatTau",
	"mirostatEta",
	"xtcProbability",
	"xtcThreshold",
	"dryMultiplier",
	"dryBase",
	"dryAllowedLength",
	"dryPenaltyLastN",
	"drySequenceBreakers",
	"dynatempRange",
	"dynatempExponent",
	"tfsZ",
	"responseTokens",
	"contextTokens",
	"stop",
	"logitBias",
	"maxTokens"
] as const

/** A value 0.6's sampling schema moved into range, or could not hold. */
export interface SamplingClamp {
	field: string
	before: unknown
	/** Undefined when the value was dropped rather than moved. */
	after: unknown
}

/**
 * A 0.5.3 sampling row as the `values`/`enabled` pair 0.6 stores, and what
 * the schema had to change to store it (`normalizeSamplingRow` clamps a
 * number to its declared range and rounds an integer).
 */
export function samplingValuesOf(row: typeof attic.samplingConfigs.$inferSelect): {
	values: Record<string, unknown>
	enabled: string[]
	clamped: SamplingClamp[]
} {
	const flat = row as unknown as Record<string, unknown>
	const values: Record<string, unknown> = {}
	const enabled: string[] = []
	for (const key of SAMPLERS) {
		const v = flat[key]
		if (v !== null && v !== undefined) values[key] = v
		if (flat[`${key}Enabled`] === true) enabled.push(key)
	}
	// UI-only flags, kept as `values` memory the way the form writes them.
	values.responseTokensUnlocked = row.responseTokensUnlocked
	values.contextTokensUnlocked = row.contextTokensUnlocked
	const normalized = normalizeSamplingRow({
		shape: S.textGen,
		values,
		enabled
	})
	const clamped: SamplingClamp[] = []
	for (const key of SAMPLERS)
		if (
			key in values &&
			JSON.stringify(values[key]) !== JSON.stringify(normalized.values[key])
		)
			clamped.push({ field: key, before: values[key], after: normalized.values[key] })
	return { values: normalized.values, enabled: normalized.enabled, clamped }
}

const clampText = (c: SamplingClamp) =>
	c.after === undefined
		? `${c.field} ${JSON.stringify(c.before)} (dropped)`
		: `${c.field} ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`

const nameKey = (name: string) => name.trim().toLowerCase()

export async function restoreSamplingConfigs(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	const old = await tx
		.select()
		.from(attic.samplingConfigs)
		.orderBy(asc(attic.samplingConfigs.id))
	const live = await tx.select().from(schema.samplingConfigs)
	const map = mapFor(ctx, "sampling_configs")
	const liveIds = new Set(live.map((r) => r.id))
	// A person's names only: a seed YIELDS a name a person holds, the rule
	// `defaults.sync()` applies on every boot (`(Built-in)`), so it is applied
	// here once the person's rows are known rather than left for the next boot.
	const taken = new Set<string>()
	let next = Math.max(await maxId(tx, "sampling_configs"), ...old.map((r) => r.id)) + 1

	const rows: (typeof schema.samplingConfigs.$inferInsert)[] = []
	for (const r of old) {
		const seed = r.seedKey ? live.find((l) => l.seedKey === r.seedKey) : undefined
		if (seed) {
			// Core's own row: the seeded 0.6 row is its successor. Pointers
			// follow it; its values are core's, not this install's.
			if (seed.id !== r.id) map.set(r.id, seed.id)
			continue
		}
		const id = liveIds.has(r.id) ? next++ : r.id
		if (id !== r.id) map.set(r.id, id)
		let name = r.name
		if (taken.has(nameKey(name))) {
			let n = 2
			while (taken.has(nameKey(`${r.name.trim()} (${n})`))) n++
			name = `${r.name.trim()} (${n})`
			ctx.notes.add({
				topic: "sampling-renamed",
				objectLabel: r.name,
				summary: `The sampling config "${r.name}" is now "${name}": two configs may not share a name that differs only in case or spacing.`,
				changes: [{ field: "name", label: "name", before: r.name, after: name }]
			})
		}
		taken.add(nameKey(name))
		const { values, enabled, clamped } = samplingValuesOf(r)
		if (clamped.length)
			ctx.notes.add({
				topic: "sampling-clamped",
				objectLabel: name,
				summary: `The sampling config "${name}" held ${clamped.length} value(s) outside what 0.6 accepts, brought into range: ${clamped.map(clampText).join(", ")}.`,
				changes: clamped.map((c) => ({
					field: c.field,
					label: c.field,
					before: c.before,
					after: c.after
				}))
			})
		rows.push({
			id,
			seedKey: null,
			name,
			isImmutable: false,
			shape: S.textGen,
			values,
			enabled
		})
	}
	await yieldSeedNames(tx, live, taken)
	await insertBatched(tx, schema.samplingConfigs, rows)
}

/** Rename a text seed whose name a person's row holds, as `defaults.sync()` would. */
async function yieldSeedNames(
	tx: Db,
	live: Array<typeof schema.samplingConfigs.$inferSelect>,
	personal: Set<string>
): Promise<void> {
	const all = new Set(
		live.filter((r) => r.shape === S.textGen).map((r) => nameKey(r.name))
	)
	for (const n of personal) all.add(n)
	for (const seed of live) {
		if (!seed.seedKey || seed.shape !== S.textGen) continue
		if (!personal.has(nameKey(seed.name))) continue
		let n = 1
		let name = `${seed.name} (Built-in)`
		while (all.has(nameKey(name))) name = `${seed.name} (Built-in ${++n})`
		all.add(nameKey(name))
		await tx
			.update(schema.samplingConfigs)
			.set({ name })
			.where(eq(schema.samplingConfigs.id, seed.id))
	}
}

/** `prompt_format` values a completion template still answers to. */
async function templateKeys(tx: Db): Promise<Set<string>> {
	const rows = await tx
		.select({ key: schema.completionTemplates.key })
		.from(schema.completionTemplates)
	return new Set(rows.map((r) => r.key))
}

export async function restoreConnections(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	const old = await tx
		.select()
		.from(attic.connections)
		.orderBy(asc(attic.connections.id))
	const keys = await templateKeys(tx)

	// Each row as 0.6 reads it — the type renames, Ollama's keep-alive, the
	// prompt format checked against the templates — said once per row.
	const rows: LegacyEndpointRow[] = []
	for (const c of old) {
		let type = c.type
		const baseUrl = c.baseUrl
		const extraJson: Record<string, any> = { ...(c.extraJson ?? {}) }
		if (type === LLAMACPP_COMPLETION) type = CONNECTION_TYPE.LLAMACPP
		if (type === LLMMAN) {
			type = CONNECTION_TYPE.OLLAMA
			ctx.notes.add({
				topic: "connection-converted",
				objectLabel: c.name,
				summary: `"${c.name}" was an llmman connection, which 0.6 does not have; its model is on an Ollama connection at the same address (${baseUrl ?? "no address"}) now, with its thinking, keep-alive and chat settings as they were.`
			})
		}
		// 0.5.3's own Ollama default of 300 ms unloads the model between every
		// pair of requests; 0.6's default is five minutes.
		if (type === CONNECTION_TYPE.OLLAMA && extraJson.keepAlive === "300ms")
			extraJson.keepAlive = "5m"

		let promptFormat: string | null = c.promptFormat ?? null
		if (promptFormat !== null && !keys.has(promptFormat)) {
			if (promptFormat !== "")
				ctx.notes.add({
					topic: "prompt-format",
					objectLabel: c.name,
					summary: `"${c.name}" named the prompt format "${promptFormat}", which no completion template provides; it uses the default template now.`
				})
			promptFormat = null
		}

		rows.push({
			id: c.id,
			name: c.name,
			type,
			baseUrl,
			model: c.model,
			extraJson,
			tokenCounter: c.tokenCounter,
			promptFormat,
			// A row that turned the chat wire off or pre-rendered its prompt
			// asked for the completion wire; that intent is a capability
			// override now.
			wantsCompletion:
				extraJson.useChat === false || extraJson.prerenderPrompt === true
		})
	}

	// Rows to one service are one endpoint with a model each (`connectionGroups.ts`).
	const credentialOf = await apiKeyComparer()
	const groups = groupLegacyConnections(rows, credentialOf)
	const live = await tx.select({ name: schema.connections.name }).from(schema.connections)
	const taken = nameGroups(
		groups,
		live.map((r) => r.name ?? "")
	)

	/** 0.5.3 connection id → the (endpoint, model) pair its model is now. */
	const pairs = new Map<number, { connectionId: number; connectionModelId: number | null }>()
	for (const g of groups) {
		const id = g.lead.id
		const overrides = g.wantsCompletion ? { wire_chat: false } : undefined
		const merged = withConnectionDefaults({
			type: g.type,
			baseUrl: g.lead.baseUrl,
			extraJson: g.lead.extraJson
		} as any)
		const preset = normalizeConnectionPreset(g.preset?.slug ?? null, g.type).preset ?? null
		const capabilities: Record<string, unknown> = overrides ? { overrides } : {}
		capabilities.resolved = resolveConnectionCapabilities({
			type: g.type,
			preset,
			capabilities
		} as any)

		await tx.insert(schema.connections).values({
			id,
			name: g.name,
			type: g.type,
			modality: (merged as any).modality ?? "text-gen",
			capabilities,
			preset,
			baseUrl: g.lead.baseUrl,
			extraJson: g.lead.extraJson,
			tokenCounter: g.lead.tokenCounter,
			promptFormat: g.lead.promptFormat
		})
		for (const m of g.models) {
			const row = await ensureConnectionModel(tx, id, m.model)
			if (!row) continue
			const o = m.overrides
			const set: Partial<typeof schema.connectionModels.$inferInsert> = {}
			if (o.promptFormat !== undefined) set.promptFormat = o.promptFormat
			if (o.tokenCounter !== undefined) set.tokenCounter = o.tokenCounter
			if (o.extraJson) set.extraJson = o.extraJson
			if (o.wireChat === false) set.capabilities = { overrides: { wire_chat: false } }
			if (Object.keys(set).length)
				await tx
					.update(schema.connectionModels)
					.set(set)
					.where(eq(schema.connectionModels.id, row.id))
			for (const r of m.from) pairs.set(r.id, { connectionId: id, connectionModelId: row.id })
			// A second row naming the same model shares this one.
			countDrop(ctx, "connection_models", m.from.length - 1)
		}
		for (const r of g.members) {
			if (!pairs.has(r.id)) pairs.set(r.id, { connectionId: id, connectionModelId: null })
			if (r.id !== id) mapFor(ctx, "connections").set(r.id, id)
		}
		countDrop(ctx, "connections", g.members.length - 1)

		const note = groupNote(g, credentialOf)
		if (note)
			ctx.notes.add({
				topic: note.topic,
				objectLabel: g.name,
				summary: note.summary,
				changes: [
					{
						field: "name",
						label: "name",
						before: g.members.map((m) => m.name).join(", "),
						after: g.name
					},
					...(g.members.length > 1
						? [{ field: "models", label: "models", after: g.models.length }]
						: [])
				]
			})
	}

	const [settings] = await tx.select().from(attic.systemSettings).limit(1)
	if (settings) {
		const pair =
			settings.defaultConnectionId != null
				? pairs.get(settings.defaultConnectionId)
				: undefined
		await setCapabilityDefault(tx, TEXT_CAPABILITY, {
			...(pair ?? {}),
			...(settings.defaultSamplingConfigId != null
				? {
						samplingConfigId: mapped(
							ctx,
							"sampling_configs",
							settings.defaultSamplingConfigId
						)
					}
				: {})
		})
	}

	await restoreEmbeddingConnection(ctx, settings, taken)
}

/**
 * How two stored API keys are compared: decrypted, since two encryptions of
 * one key never match. A key that will not decrypt is compared as stored, so
 * at worst two rows stay two connections — never one row's key on another's.
 * The plaintext lives only in this comparison's memory.
 */
async function apiKeyComparer(): Promise<(apiKey: unknown) => string> {
	const { decryptApiKeyField } = await import("$lib/server/utils/tokenCrypto")
	return (apiKey) => {
		if (apiKey == null || apiKey === "") return ""
		try {
			const plain = decryptApiKeyField(apiKey)
			if (plain !== undefined)
				return plain === ""
					? ""
					: `key:${createHash("sha256").update(plain).digest("hex")}`
		} catch {
			// Fall through to the stored form.
		}
		return `stored:${JSON.stringify(apiKey)}`
	}
}

/** The 0.5.3 embedding singleton, as an embedding connection. */
async function restoreEmbeddingConnection(
	ctx: RestoreContext,
	settings: typeof attic.systemSettings.$inferSelect | undefined,
	/** Every connection name taken so far: the new one is numbered past them. */
	taken: readonly string[]
): Promise<void> {
	const { tx } = ctx
	if (!settings) return
	const [vc] = await tx.select().from(attic.vectorizationConfigs).limit(1)

	let row: typeof schema.connections.$inferInsert | null = null
	let model: string | null = null
	if (vc?.mode === "api" && (vc.apiBaseUrl ?? "") !== "") {
		const extra: Record<string, unknown> = {}
		if (vc.apiKey && vc.apiKeyIv && vc.apiKeyAuthTag)
			extra[LEGACY_VECTORIZATION_KEY] = {
				ciphertext: vc.apiKey,
				iv: vc.apiKeyIv,
				authTag: vc.apiKeyAuthTag
			}
		if (vc.apiDimensions != null) extra.dimensions = vc.apiDimensions
		model = vc.apiModel ?? null
		row = {
			name: "",
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			baseUrl: vc.apiBaseUrl,
			extraJson: extra
		}
	} else if ((settings.embeddingModelName ?? "") !== "") {
		model = settings.embeddingModelName
		row = {
			name: "",
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			modality: "embeddings",
			extraJson: {}
		}
	}
	if (!row) return
	// The name a new connection of its type gets, as every other connection
	// the upgrade builds is named (`connectionGroups.ts`). It is never one of
	// the groups: no 0.5.3 connection had an embedding type, and 0.6's
	// OpenAI-compatible chat type cannot embed.
	row.name = uniqueName(serviceName(row.type) ?? "Embeddings", taken)
	if (vc && vc.embeddingModelTtlMinutes != null && vc.embeddingModelTtlMinutes !== 5)
		(row.extraJson as Record<string, unknown>).embeddingModelTtlMinutes =
			vc.embeddingModelTtlMinutes

	const capabilities = {
		resolved: resolveConnectionCapabilities({
			type: row.type,
			preset: null,
			capabilities: {}
		} as any)
	}
	const id = (await maxId(tx, "connections")) + 1
	await tx.insert(schema.connections).values({ ...row, id, capabilities })
	countAdd(ctx, "connections")
	const m = await ensureConnectionModel(tx, id, model)
	if (settings.vectorizationEnabled)
		await setCapabilityDefault(tx, EMBEDDING_CAPABILITY, {
			connectionId: id,
			connectionModelId: m?.id ?? null
		})
}

/** The instance settings row, the two managers, and the local model list. */
export async function restorePubSettings(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	const [s] = await tx.select().from(attic.systemSettings).limit(1)
	if (s) {
		// The `default_*_config_id` pointers are the wiring's to read from the
		// attic; `summarization_enabled` has no column (summarization is always
		// on, D10); the embedding columns became the embedding connection.
		if (s.summarizationEnabled === false)
			countLoss(ctx, "the summarization switch (always on in 0.6)")
		const values = {
			lockConnection: s.lockConnection,
			lockSamplingConfig: s.lockSamplingConfig,
			lockContextConfig: s.lockContextConfig,
			lockPromptConfig: s.lockPromptConfig,
			isAccountsEnabled: s.isAccountsEnabled,
			contextDebuggingEnabled: s.contextDebuggingEnabled,
			charaVaultEmail: s.charaVaultEmail,
			charaVaultEncryptedToken: s.charaVaultEncryptedToken,
			charaVaultTokenIv: s.charaVaultTokenIv,
			charaVaultTokenAuthTag: s.charaVaultTokenAuthTag
		}
		const [live] = await tx.select({ id: schema.systemSettings.id }).from(schema.systemSettings).limit(1)
		if (live)
			await tx
				.update(schema.systemSettings)
				.set(values)
				.where(eq(schema.systemSettings.id, live.id))
		else await tx.insert(schema.systemSettings).values({ id: s.id, ...values })
	}

	const [ollama] = await tx.select().from(attic.ollamaSettings).limit(1)
	if (ollama)
		await tx
			.insert(schema.ollamaSettings)
			.values({
				id: ollama.id,
				ollamaManagerEnabled: ollama.ollamaManagerEnabled,
				ollamaManagerBaseUrl: ollama.ollamaManagerBaseUrl
			})
			.onConflictDoUpdate({
				target: schema.ollamaSettings.id,
				set: {
					ollamaManagerEnabled: ollama.ollamaManagerEnabled,
					ollamaManagerBaseUrl: ollama.ollamaManagerBaseUrl
				}
			})

	const [kcpp] = await tx.select().from(attic.koboldCppSettings).limit(1)
	if (kcpp) {
		const values = {
			koboldCppManagerEnabled: kcpp.koboldCppManagerEnabled,
			koboldCppManagerBaseUrl: kcpp.koboldCppManagerBaseUrl,
			koboldCppManagedMode: kcpp.koboldCppManagedMode,
			// The binary folder and variant are kept from 0.5.3 where it chose
			// them; where it chose none, the seed's (an env-var deployment's,
			// `defaults.sync()`) stands — what that sync would patch in anyway.
			...(kcpp.koboldCppManagedBinaryVariant
				? { koboldCppManagedBinaryVariant: kcpp.koboldCppManagedBinaryVariant }
				: {}),
			...(kcpp.koboldCppManagedBinaryDir
				? { koboldCppManagedBinaryDir: kcpp.koboldCppManagedBinaryDir }
				: {}),
			koboldCppManagedPort: kcpp.koboldCppManagedPort,
			koboldCppManagedAdminPassword: kcpp.koboldCppManagedAdminPassword,
			koboldCppManagedModelTtlSecs: kcpp.koboldCppManagedModelTtlSecs,
			koboldCppManagedSubprocessTimeoutSecs:
				kcpp.koboldCppManagedSubprocessTimeoutSecs,
			koboldCppManagedReleaseTag: kcpp.koboldCppManagedReleaseTag,
			// A 0.5.3 install chose its models folder; a fresh 0.6 seed's
			// default is only kept where it chose none.
			...(kcpp.koboldCppManagerModelsDir
				? { koboldCppManagerModelsDir: kcpp.koboldCppManagerModelsDir }
				: {})
		}
		await tx
			.insert(schema.koboldCppSettings)
			.values({ id: kcpp.id, ...values })
			.onConflictDoUpdate({ target: schema.koboldCppSettings.id, set: values })
	}

	const models = await tx
		.select()
		.from(attic.koboldCppModels)
		.orderBy(asc(attic.koboldCppModels.id))
	await insertBatched(
		tx,
		schema.localModels,
		models.map((m) => ({
			id: m.id,
			filename: m.filename,
			modelName: m.modelName,
			modelUrl: m.modelUrl,
			downloadUrl: m.downloadUrl,
			description: m.description,
			quantization: m.quantization,
			sizeBytes: m.sizeBytes,
			status: m.status,
			errorMessage: m.errorMessage,
			// The file says what it is; 0.5.3's list only ever held text models.
			format: /\.safetensors$/i.test(m.filename) ? "safetensors" : "gguf",
			kind: "text",
			kindSource: "assumed",
			modality: modalityForKind("text"),
			createdAt: m.createdAt,
			updatedAt: m.updatedAt
		}))
	)
}

