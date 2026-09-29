/**
 * Who provides a tool, and in what order (20 §9).
 *
 * The one place that turns a tool NAME into something that runs. Both nodes
 * read it — `core:query/available-tools@1` for the advertisement and
 * `core:oracle/run-tool@1` for the call — so the list a model is shown and
 * the list it is answered from are the same list by construction. Two
 * resolutions would eventually differ, and the failure would read as a model
 * hallucinating a tool it was genuinely offered.
 *
 * ## The extension convention
 *
 * `manifest.tools: { '<toolName>': { hook, description, parameters } }` — the
 * sibling of `hookKinds` (a script link's hook) and `nodeDefinitions` (a node's),
 * read the same way: the STORED manifest is the one source of truth (F6),
 * never a naming convention guessed from the id. A tool is a hook like any
 * other, so it runs through the same sandbox, under the same permissions, with
 * the same deadline and the same invocation log — this module adds a name and
 * a description and nothing else.
 *
 * `description` and `parameters` are the plugin's own words: they are what a
 * model reads before deciding to call the thing, so an author who cannot write
 * them cannot make their tool usable, and core inventing them would be core
 * describing code it has not seen.
 */

import { and, eq } from "drizzle-orm"
import { notCoreRow } from "$lib/server/plugins/frameHost"
import * as schema from "$lib/server/db/schema"
import {
	CORE_TOOLS,
	coreTool
} from "$lib/server/pipelines/runtime/tools/coreTools"
import type {
	CoreTool,
	ToolDeclaration
} from "$lib/server/pipelines/runtime/tools"

/** A tool implemented by an installed extension's sandboxed hook. */
export interface PluginToolBinding extends ToolDeclaration {
	/** The sandbox address — `namespace/name`. */
	pluginId: string
	/** The exported hook that implements it. */
	hook: string
}

export type ToolProvider =
	| { kind: "core"; declaration: ToolDeclaration; tool: CoreTool }
	| {
			kind: "plugin"
			declaration: ToolDeclaration
			binding: PluginToolBinding
	  }

/**
 * Read `tools` off a stored manifest, tolerant of its json being anything.
 *
 * A malformed entry is skipped rather than raising: a third party's packaging
 * mistake must not be able to stop a turn, the same judgement `nodeDefinitionsOf`
 * makes one module over. An entry with no `hook` names nothing to call, and
 * one with no `description` is a tool no model can decide to use — both are
 * incomplete declarations rather than declarations of something incomplete.
 */
export function pluginToolsOf(
	pluginId: string,
	manifest: unknown
): PluginToolBinding[] {
	const raw =
		manifest && typeof manifest === "object"
			? (manifest as { tools?: unknown }).tools
			: undefined
	if (!raw || typeof raw !== "object") return []

	const out: PluginToolBinding[] = []
	for (const [name, decl] of Object.entries(raw as Record<string, unknown>)) {
		if (!name || !decl || typeof decl !== "object") continue
		const { hook, description, parameters } = decl as Record<
			string,
			unknown
		>
		if (typeof hook !== "string" || !hook) continue
		if (typeof description !== "string" || !description) continue
		out.push({
			name,
			description,
			hook,
			pluginId,
			parameters:
				parameters &&
				typeof parameters === "object" &&
				!Array.isArray(parameters)
					? (parameters as Record<string, unknown>)
					: { type: "object", properties: {} }
		})
	}
	return out
}

/**
 * Every tool this install can offer, extensions first.
 *
 * `plugins: false` is the switch on `available-tools` — a spec that wants only
 * the tools it can reason about, rather than whatever an admin installed
 * yesterday. Core's four are always in the list: they read this session and
 * nothing else, so there is no configuration under which offering them is a
 * decision an author needs to make.
 */
export async function toolProviders(
	db: Db,
	opts: { plugins?: boolean } = {}
): Promise<ToolProvider[]> {
	const providers: ToolProvider[] = []
	const claimed = new Set<string>()

	if (opts.plugins !== false) {
		const rows = await db
			.select({
				pluginId: schema.plugins.pluginId,
				manifest: schema.plugins.manifest
			})
			.from(schema.plugins)
			.where(and(eq(schema.plugins.enabled, true), notCoreRow()))

		for (const row of rows)
			for (const binding of pluginToolsOf(row.pluginId, row.manifest)) {
				// First declaration of a name wins, and two extensions claiming
				// one name is an install-level collision nothing here can
				// arbitrate: picking by a rule the admin cannot see would be
				// worse than the first-come order they can at least observe in
				// the advertisement.
				if (claimed.has(binding.name)) continue
				claimed.add(binding.name)
				providers.push({
					kind: "plugin",
					declaration: {
						name: binding.name,
						description: binding.description,
						parameters: binding.parameters
					},
					binding
				})
			}
	}

	for (const tool of CORE_TOOLS) {
		if (claimed.has(tool.name)) continue
		providers.push({
			kind: "core",
			declaration: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters
			},
			tool
		})
	}

	return providers
}

/**
 * The provider for one name, or null — resolution order (a) then (b), with
 * (c), refusal, left to the caller because only it knows what to say.
 */
export async function resolveTool(
	db: Db,
	name: string,
	opts: { plugins?: boolean } = {}
): Promise<ToolProvider | null> {
	if (!name) return null
	if (opts.plugins !== false) {
		const providers = await toolProviders(db, opts)
		const found = providers.find((p) => p.declaration.name === name)
		if (found) return found
		return null
	}
	const tool = coreTool(name)
	return tool
		? {
				kind: "core",
				tool,
				declaration: {
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters
				}
			}
		: null
}
