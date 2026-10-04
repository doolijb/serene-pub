/**
 * Which 0.5.3 connections are one 0.6 connection, and what it is called.
 *
 * In 0.5.3 a connection was ONE model on a service: type, address, key and
 * model name together, so somebody with five Ollama models had five Ollama
 * connections to the same `localhost:11434`. In 0.6 a connection is the
 * **endpoint** and the models are rows under it, so those five are one Ollama
 * connection with five models (owner, 2026-10-03).
 *
 * ## The endpoint signature
 *
 * Two 0.5.3 rows are one endpoint when they share an **endpoint signature**:
 *
 *   · the 0.6 connection type (after the upgrade's renames — an llmman row is
 *     an Ollama row by then);
 *   · the address, as `hostKey` spells it — the ONE rule the server's
 *     one-Ollama-per-host refusal and the Ollama view's "Other connections
 *     point at this same Ollama" notice read, so the upgrade can never build
 *     two connections that notice would then call duplicates, nor merge two it
 *     would call different. A trailing slash, the case of scheme and host, and a
 *     default port written out are forgiven; a path is not, `/v1` included,
 *     because every 0.6 adapter appends its routes to the stored address as it
 *     stands (`normalizeBaseUrl` trims slashes only), so `http://h/v1` and
 *     `http://h` reach different routes. `localhost` and `127.0.0.1` stay two
 *     addresses, for the reason `hostKey` gives;
 *   · the API key, compared decrypted — two encryptions of one key differ —
 *     except for a type that holds none (`credentialPolicy` "none": Ollama,
 *     LM Studio, the managed KoboldCPP), whose adapters never send one.
 *
 * The managed KoboldCPP is one endpoint whatever its rows said: its address is
 * the pub's own setting, not the row's. A type 0.5.3 never had is carried
 * alone, as it was.
 *
 * ## What the combined connection holds
 *
 * The endpoint is the first row's (the lowest id that names a model). Every
 * other row's settings that differ — prompt format, token counter, the
 * adapter's options, the completion-wire intent — become overrides on ITS
 * model, which is what `connection_models` overrides are for
 * (`mergeEndpointModel`: model over endpoint), so each model is sent exactly
 * as its 0.5.3 connection sent it. Two rows naming the same model share one
 * model row; the first one's settings are kept and the note says so.
 *
 * ## The name
 *
 * The name a new connection to that service gets in 0.6: a preset's when the
 * address is one a preset names (OpenRouter, OpenAI (Official), Groq …), else
 * the type's — the label the Add connection picker shows and fills the name
 * with. The managed KoboldCPP takes the name a fresh managed endpoint takes
 * (`managedEndpointName`). A second connection to one service (another host,
 * another key) is numbered the way the Add menu numbers one: "OpenRouter 2"
 * (`uniqueName`). The 0.5.3 names are not lost: the upgrade note lists them.
 *
 * Pure: the caller decrypts keys and writes rows (`connections.ts`).
 */
import { hostKey } from "$lib/shared/connections/hostKey"
import { credentialPolicy } from "$lib/shared/connections/credentials"
import { uniqueName } from "$lib/shared/connections/connectionName"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	OPENAI_COMPATIBLE_PRESETS,
	stableStringify,
	withConnectionDefaults
} from "$lib/shared/utils/connectionDefaults"
import { buildConnectionServiceItems } from "$lib/shared/utils/connectionServiceItems"
import { managedEndpointName } from "$lib/server/koboldcpp/managedEndpoint"

/** One 0.5.3 connection row as 0.6 reads it: type renamed, prompt format checked. */
export interface LegacyEndpointRow {
	id: number
	/** What the person called it in 0.5.3. */
	name: string
	/** The 0.6 type. */
	type: string
	baseUrl: string | null
	/** The model it named; blank names none. */
	model: string | null
	extraJson: Record<string, any>
	tokenCounter: string
	/** A completion template key 0.6 has, or null. */
	promptFormat: string | null
	/** It turned the chat wire off or pre-rendered its prompt. */
	wantsCompletion: boolean
}

/** An OpenAI-compatible preset, as the upgrade reads one. */
export interface MatchedPreset {
	/** The picker label — what the Add connection form names the connection. */
	label: string
	/** `connections.preset`; null for a preset with no capability slug. */
	slug: string | null
	value: number
}

/** What a model row overrides of its endpoint (see `connection_models`). */
export interface ModelOverrides {
	promptFormat?: string | null
	tokenCounter?: string
	extraJson?: Record<string, unknown>
	/** Set only where the group's rows disagreed about the completion wire. */
	wireChat?: false
}

export interface GroupModel {
	/** The identifier, trimmed — what `connection_models.model` holds. */
	model: string
	/** Every row that named it, id order; the first one's settings are kept. */
	from: LegacyEndpointRow[]
	overrides: ModelOverrides
}

export interface ConnectionGroup {
	signature: string
	/** The row the endpoint's own settings (and its id) come from. */
	lead: LegacyEndpointRow
	/** Every row, id order. */
	members: LegacyEndpointRow[]
	type: string
	preset: MatchedPreset | null
	/** Assigned by `nameGroups`. */
	name: string
	/** The name before enumeration: the service's own. */
	baseName: string
	models: GroupModel[]
	/** Every row asked for the completion wire: an endpoint override. */
	wantsCompletion: boolean
	/** Names of earlier groups at the same address with another key. */
	sameAddressAs: string[]
}

/** The 0.6 types a 0.5.3 row can have become; any other is carried alone. */
const GROUPABLE: ReadonlySet<string> = new Set([
	CONNECTION_TYPE.OPENAI,
	CONNECTION_TYPE.OLLAMA,
	CONNECTION_TYPE.LM_STUDIO,
	CONNECTION_TYPE.LLAMACPP,
	CONNECTION_TYPE.KOBOLDCPP,
	CONNECTION_TYPE.KOBOLDCPP_MANAGED,
	CONNECTION_TYPE.ANTHROPIC
])

const hostnameOf = (url: string | null | undefined): string | null => {
	try {
		return new URL((url ?? "").trim()).hostname.toLowerCase() || null
	} catch {
		return null
	}
}

/**
 * The OpenAI-compatible preset an address belongs to, or undefined.
 *
 * The preset's own address first, by `hostKey` (0.5.3 offered the same
 * presets at the same addresses, so a row that holds one exactly was made
 * from it). Failing that, a CLOUD preset by host name alone — a hosted API has
 * one host, so `https://openrouter.ai/api/v1` and `https://OpenRouter.ai/api/v1/`
 * are OpenRouter however the path was typed. A local preset never matches by
 * host alone: `localhost:8080` is LocalAI's default and llama.cpp's too.
 */
export function presetForAddress(
	type: string,
	baseUrl: string | null | undefined
): MatchedPreset | undefined {
	if (type !== CONNECTION_TYPE.OPENAI) return undefined
	const key = hostKey(baseUrl)
	if (!key) return undefined
	const presets = OPENAI_COMPATIBLE_PRESETS as ReadonlyArray<{
		name: string
		slug?: string
		value: number
		category: string
		connectionDefaults: { baseUrl: string }
	}>
	const host = hostnameOf(baseUrl)
	const hit =
		presets.find(
			(p) => p.connectionDefaults.baseUrl && hostKey(p.connectionDefaults.baseUrl) === key
		) ??
		(host
			? presets.find(
					(p) => p.category === "cloud" && hostnameOf(p.connectionDefaults.baseUrl) === host
				)
			: undefined)
	if (!hit) return undefined
	return { label: pickerLabel(type, hit.value) ?? hit.name, slug: hit.slug ?? null, value: hit.value }
}

/** The Add connection picker's label for a type, or for one of its presets. */
function pickerLabel(type: string, presetValue?: number): string | undefined {
	const items = buildConnectionServiceItems()
	if (type === CONNECTION_TYPE.OPENAI)
		// No preset is the picker's custom entry, "Empty" (value 0).
		return items.find((i) => i.type === type && i.presetValue === (presetValue ?? 0))?.label
	return items.find((i) => i.key === `type:${type}`)?.label
}

/**
 * The name 0.6 gives a new connection of this type (and preset), or null for
 * a type it has no name for. The managed KoboldCPP's is `managedEndpointName`'s.
 */
export function serviceName(type: string, preset?: MatchedPreset | null): string | null {
	if (preset) return preset.label
	return (
		pickerLabel(type) ??
		CONNECTION_TYPE.options.find((o) => o.value === type)?.label ??
		null
	)
}

/**
 * The endpoint signature (see the header). `credentialOf` turns a stored
 * `apiKey` — an encrypted envelope, a legacy plaintext string, or nothing —
 * into something two equal keys share; the caller decrypts.
 */
export function endpointSignature(
	row: Pick<LegacyEndpointRow, "id" | "type" | "baseUrl" | "extraJson">,
	credentialOf: (apiKey: unknown) => string
): string {
	if (!GROUPABLE.has(row.type)) return `alone:${row.id}`
	if (row.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED) return row.type
	const preset = presetForAddress(row.type, row.baseUrl)
	const keyless =
		credentialPolicy({ type: row.type, preset: preset?.slug, baseUrl: row.baseUrl }) === "none"
	const credential = keyless ? "" : credentialOf(row.extraJson?.apiKey)
	return JSON.stringify([row.type, hostKey(row.baseUrl) ?? "", credential])
}

/** The adapter's options as the adapter will read them: the type's defaults under the row's. */
function effectiveOptions(row: LegacyEndpointRow): Record<string, unknown> {
	const merged = withConnectionDefaults({ type: row.type, extraJson: row.extraJson ?? {} } as any)
	const out = { ...((merged as any).extraJson ?? {}) }
	// The key is the endpoint's, equal across the group by its signature (or
	// never sent); a model row may not hold one.
	delete out.apiKey
	return out
}

/** What `row` overrides of `lead` when its model sits under `lead`'s endpoint. */
function overridesOf(
	row: LegacyEndpointRow,
	lead: LegacyEndpointRow,
	mixedWire: boolean
): ModelOverrides {
	const out: ModelOverrides = {}
	if (row !== lead) {
		if (row.promptFormat !== lead.promptFormat) out.promptFormat = row.promptFormat
		if (row.tokenCounter !== lead.tokenCounter) out.tokenCounter = row.tokenCounter
		const mine = effectiveOptions(row)
		const theirs = effectiveOptions(lead)
		const extra: Record<string, unknown> = {}
		for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)]))
			if (stableStringify(mine[k]) !== stableStringify(theirs[k])) extra[k] = mine[k] ?? null
		if (Object.keys(extra).length) out.extraJson = extra
	}
	if (mixedWire && row.wantsCompletion) out.wireChat = false
	return out
}

/** Whether two rows would send one model the same way. */
function sameSettings(a: LegacyEndpointRow, b: LegacyEndpointRow): boolean {
	return (
		a.promptFormat === b.promptFormat &&
		a.tokenCounter === b.tokenCounter &&
		a.wantsCompletion === b.wantsCompletion &&
		stableStringify(effectiveOptions(a)) === stableStringify(effectiveOptions(b))
	)
}

/**
 * The 0.5.3 rows as endpoint groups, ordered by their first row's id, each
 * with its distinct models and their overrides. Names are `nameGroups`'.
 */
export function groupLegacyConnections(
	rows: readonly LegacyEndpointRow[],
	credentialOf: (apiKey: unknown) => string
): ConnectionGroup[] {
	const bySignature = new Map<string, LegacyEndpointRow[]>()
	for (const row of [...rows].sort((a, b) => a.id - b.id)) {
		const sig = endpointSignature(row, credentialOf)
		const list = bySignature.get(sig)
		if (list) list.push(row)
		else bySignature.set(sig, [row])
	}
	const groups: ConnectionGroup[] = []
	for (const [signature, members] of bySignature) {
		const named = (r: LegacyEndpointRow) => (r.model ?? "").trim() !== ""
		const lead = members.find(named) ?? members[0]
		const wire = new Set(members.filter(named).map((r) => r.wantsCompletion))
		const mixedWire = wire.size > 1
		const models: GroupModel[] = []
		for (const row of members) {
			const model = (row.model ?? "").trim()
			if (!model) continue
			const seen = models.find((m) => m.model === model)
			if (seen) seen.from.push(row)
			else models.push({ model, from: [row], overrides: overridesOf(row, lead, mixedWire) })
		}
		const preset = presetForAddress(lead.type, lead.baseUrl) ?? null
		groups.push({
			signature,
			lead,
			members,
			type: lead.type,
			preset,
			name: "",
			baseName: serviceName(lead.type, preset) ?? lead.name.trim(),
			models,
			wantsCompletion: !mixedWire && lead.wantsCompletion,
			sameAddressAs: []
		})
	}
	// A group at an earlier group's address is there for its key.
	const addressOf = (g: ConnectionGroup) =>
		g.signature.startsWith("alone:") || g.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED
			? null
			: `${g.type} ${hostKey(g.lead.baseUrl) ?? ""}`
	groups.forEach((g, i) => {
		const at = addressOf(g)
		if (at)
			g.sameAddressAs = groups
				.slice(0, i)
				.filter((o) => addressOf(o) === at)
				.map((o) => o.signature)
	})
	return groups
}

/**
 * Name every group in order, against the names already taken (the live rows,
 * and each group's as it is named). Returns the taken list grown.
 */
export function nameGroups(groups: ConnectionGroup[], taken: readonly string[]): string[] {
	const names = [...taken]
	const bySignature = new Map<string, string>()
	for (const g of groups) {
		g.name =
			g.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED
				? managedEndpointName(names)
				: g.signature.startsWith("alone:")
					? uniqueName(g.lead.name.trim() || g.baseName, names)
					: uniqueName(g.baseName, names)
		names.push(g.name)
		bySignature.set(g.signature, g.name)
	}
	for (const g of groups) g.sameAddressAs = g.sameAddressAs.map((s) => bySignature.get(s) ?? s)
	return names
}

/** Two rows that named one model with different settings: whose were kept. */
export interface ModelConflict {
	model: string
	kept: string
	others: string[]
}

export function conflictsOf(group: ConnectionGroup): ModelConflict[] {
	const out: ModelConflict[] = []
	for (const m of group.models) {
		const [kept, ...rest] = m.from
		const differing = rest.filter((r) => !sameSettings(kept, r))
		if (differing.length)
			out.push({ model: m.model, kept: kept.name, others: differing.map((r) => r.name) })
	}
	return out
}

const quoted = (names: readonly string[]): string => {
	const q = names.map((n) => `"${n}"`)
	return q.length <= 1 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`
}

/** Where a group's connections went, as a sentence names it. */
function whereOf(group: ConnectionGroup): string {
	if (group.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED) return "the KoboldCPP this pub runs"
	const service =
		group.preset?.label ??
		(group.type === CONNECTION_TYPE.OPENAI
			? "the OpenAI-compatible service"
			: (CONNECTION_TYPE.options.find((o) => o.value === group.type)?.label ?? group.type))
	const address = (group.lead.baseUrl ?? "").trim()
	return address ? `${service} at ${address}` : service
}

/** True when the group's rows all share a key worth mentioning. */
function keyed(group: ConnectionGroup, credentialOf: (apiKey: unknown) => string): boolean {
	return (
		credentialPolicy({ type: group.type, preset: group.preset?.slug, baseUrl: group.lead.baseUrl }) !==
			"none" && credentialOf(group.lead.extraJson?.apiKey) !== ""
	)
}

/**
 * The upgrade note for a group, or null when there is nothing to say (one row
 * whose name already was the service's).
 */
export function groupNote(
	group: ConnectionGroup,
	credentialOf: (apiKey: unknown) => string
): { topic: "connection-merged" | "connection-renamed"; summary: string } | null {
	const split = group.sameAddressAs.length
		? ` It reaches the same address as ${quoted(group.sameAddressAs)} with a different API key, so it is a connection of its own.`
		: ""
	const models = group.models.map((m) => m.model)
	if (group.members.length > 1) {
		const differs = group.models.some((m) => Object.keys(m.overrides).length > 0)
		const conflicts = conflictsOf(group)
			.map(
				(c) =>
					` ${quoted([c.kept, ...c.others])} ${c.others.length === 1 ? "both" : "all"} named ${c.model} with different settings; those of "${c.kept}" were kept.`
			)
			.join("")
		const list = models.length
			? `, with ${models.length} model${models.length === 1 ? "" : "s"}: ${models.join(", ")}`
			: ""
		return {
			topic: "connection-merged",
			summary:
				`${group.members.length} connections to ${whereOf(group)}${keyed(group, credentialOf) ? " with the same API key" : ""} ` +
				`were combined into one connection, "${group.name}"${list}. ` +
				`In 0.5.3 they were ${quoted(group.members.map((m) => m.name))}.` +
				(differs ? " Where their settings differed, each model keeps its own." : "") +
				conflicts +
				split
		}
	}
	const old = group.lead.name
	if (old.trim() === group.name) return null
	return {
		topic: "connection-renamed",
		summary:
			`"${old}" is now called "${group.name}", the name Serene Pub gives a connection to ${whereOf(group)}` +
			(models.length ? `; its model, ${models[0]}, is unchanged.` : ".") +
			split
	}
}
