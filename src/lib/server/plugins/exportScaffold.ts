/**
 * **Export with source** — the package's authoring half (PLAN-pipeline-canvas-
 * and-genre-authoring §7, P5, built 2026-10-13).
 *
 * `exportGenrePackage` writes the BUILT package: `dist/plugin/manifest.json`,
 * one document per pipeline, components, `ui/`. This adds the half an author
 * builds that from, so the zip unpacks into a source package whose
 * `npx serene-pub build .` writes the same manifest back:
 *
 *  - `package.json`, `tsconfig.json`, `tsconfig.check.json`, `.gitignore`,
 *    `vitest.config.ts` — from the CLI's own plugin scaffold
 *    (`scaffoldPlugin`, `cli/templates/plugin/base/`), so the toolchain is the
 *    one `serene-pub scaffold plugin` writes;
 *  - `src/pipelines/*.json` — the compiled documents, as they are. A package
 *    may ship a document already compiled (`ExtensionDecl.pipelines` takes
 *    `BuiltSpec | SpecDocument`), so nothing is turned back into `C.*` builder
 *    code: there is no code generator, and the document IS the pipeline;
 *  - `src/declarations.json` — the genre, presets, configs, prompts, widgets,
 *    surfaces and layouts, as the manifest stores them;
 *  - `src/index.ts` — one `defineExtension` reading both back, with presets
 *    and configs re-bound to the spec VALUES the authoring surface asks for
 *    (`preset()` refuses a spec named as a string), another package's through
 *    `use()`; and each of the package's own node definitions re-declared from
 *    its stored declaration, with a handler that refuses until it is written;
 *  - `test/package.test.ts` and a README that says what was carried and what
 *    is left to write.
 *
 * What cannot be data is left to the author and listed in the README and in
 * the export's warnings: a node handler's code (only its declaration is
 * stored on a pub), a preset's default swaps, and anything the export itself
 * already could not carry.
 */

import { documentFileName, type PluginPackageManifest } from "./pluginPackage"

/** Files this adds beside the built package, and what the author must do. */
export interface ScaffoldFiles {
	files: Record<string, string>
	/** One sentence each: what the source package leaves for the author. */
	todo: string[]
}


/** A JS string literal. */
const lit = (v: unknown) => JSON.stringify(v)

/** The scaffold files this export keeps; the rest would name the placeholder `echo` task. */
const KEPT_FROM_SCAFFOLD = new Set([
	".gitignore",
	"package.json",
	"tsconfig.json",
	"tsconfig.check.json",
	"vitest.config.ts"
])

/**
 * The authoring half of an exported package. `files` is the built package
 * (`ExportedPackage.files`) — read for the documents and the built
 * components; nothing in it is changed.
 */
export async function scaffoldSourceFor(
	manifest: PluginPackageManifest,
	built: Record<string, Buffer | string>,
	buildDir: string
): Promise<ScaffoldFiles> {
	const m = manifest as PluginPackageManifest & Record<string, any>
	const slug = m.slug
	const todo: string[] = []
	const out: Record<string, string> = {}

	// ---- the toolchain, from the CLI's own scaffold ---------------------
	const { scaffoldPlugin } = await import("@serene-pub/cli")
	for (const f of await scaffoldPlugin({ slug }))
		if (KEPT_FROM_SCAFFOLD.has(f.path)) out[f.path] = f.text
	// The documents and declarations are JSON imported by the entry module.
	{
		const ts = JSON.parse(out["tsconfig.json"] ?? "{}")
		ts.compilerOptions = { ...(ts.compilerOptions ?? {}), resolveJsonModule: true }
		out["tsconfig.json"] = JSON.stringify(ts, null, "\t") + "\n"
	}
	{
		const pkg = JSON.parse(out["package.json"] ?? "{}")
		pkg.version = m.version
		if (typeof m.description === "string") pkg.description = m.description
		// Ships what the built package ships: components and frames beside dist.
		pkg.files = [...new Set([...(pkg.files ?? []), "components", "ui"])]
		out["package.json"] = JSON.stringify(pkg, null, "\t") + "\n"
	}

	// ---- the documents ---------------------------------------------------
	const pipelineIds: string[] = (m.pipelines ?? []).map((p: any) => p.id)
	const docVar = new Map<string, string>()
	const imports: string[] = []
	pipelineIds.forEach((id, i) => {
		const file = documentFileName(id)
		const doc = built[`${buildDir}/pipelines/${file}`]
		if (doc === undefined) return
		out[`src/pipelines/${file}`] =
			typeof doc === "string" ? doc : Buffer.from(doc).toString("utf8")
		const name = `pipeline${i}`
		docVar.set(id, name)
		imports.push(
			`import ${name}Json from './pipelines/${file}' with { type: 'json' }`
		)
	})

	// ---- components: the built module stands in as the source -----------
	const components: any[] = []
	for (const c of (m.components ?? []) as any[]) {
		const content = built[c.entry]
		if (content === undefined) continue
		const entry = `components/${c.slug}.js`
		out[entry] =
			typeof content === "string" ? content : Buffer.from(content).toString("utf8")
		const { source: _s, bundled: _b, builtAgainst: _a, ...rest } = c
		components.push({ ...rest, entry })
	}
	if (components.length)
		todo.push(
			`the components/ folder holds each component as it was BUILT, not its original ` +
				`source; replace it with the source you edit if you have it.`
		)

	// ---- the declarations, as data ---------------------------------------
	const layoutsByGenre = new Map<string, any[]>()
	for (const l of (m.layouts ?? []) as any[]) {
		const list = layoutsByGenre.get(l.genreId) ?? []
		list.push({
			slug: l.slug,
			name: l.name,
			...(l.description ? { description: l.description } : {}),
			preset: l.preset
		})
		layoutsByGenre.set(l.genreId, list)
	}
	const genres = ((m.genres ?? []) as any[]).map((g) => {
		const layouts = layoutsByGenre.get(g.id)
		return layouts?.length ? { ...g, layouts } : g
	})
	const declarations: Record<string, unknown> = {
		genres,
		presets: m.presets ?? [],
		configs: m.configs ?? [],
		...(m.prompts ? { prompts: m.prompts } : {}),
		...(m.widgets ? { widgets: m.widgets } : {}),
		...(components.length ? { components } : {}),
		...(m.surfaces ? { surfaces: m.surfaces } : {}),
		...(m.nodeDefinitions?.length
			? { nodeDefinitions: m.nodeDefinitions.map((d: any) => d.declaration ?? d) }
			: {})
	}
	out["src/declarations.json"] = JSON.stringify(declarations, null, "\t") + "\n"

	if ((m.presets ?? []).some((p: any) => p?.defaults?.swaps))
		todo.push(
			`a preset's default swaps were left out of src/index.ts — they name ` +
				`their spec by value; add them back to the preset's \`defaults\`.`
		)
	for (const d of (m.nodeDefinitions ?? []) as any[])
		todo.push(
			`write the handler for '${d.id}' in src/index.ts — a pub stores a ` +
				`node's declaration, never its code, so it refuses until you do.`
		)

	// ---- the entry module --------------------------------------------------
	const pipelineMap = pipelineIds
		.filter((id) => docVar.has(id))
		.map((id) => `\t${lit(id)}: ${docVar.get(id)}Json as unknown as SpecDocument,`)
		.join("\n")
	out["src/index.ts"] = `/**
 * ${String(m.name).replace(/\*\//g, "*\\/")} — exported from a Serene Pub as source.
 *
 * One \`defineExtension\`, one default export, as \`serene-pub scaffold plugin\`
 * writes it. What the pub stored as data stays data: the pipelines are the
 * compiled documents in \`./pipelines/\`, and the genre, presets, configs,
 * prompts and widgets are \`./declarations.json\`. This module only re-binds
 * them to values — a preset binds spec values, another package's through
 * \`use()\` — so \`npx serene-pub build .\` writes the manifest the pub exported.
 *
 * ✎ CHANGE: the README lists what is left for you to write.
 */

import {
	config,
	defineExtension,
	describeInletDefinition,
	describeOracleDefinition,
	describeOutletDefinition,
	describeQueryDefinition,
	describeTaskDefinition,
	getShape,
	handler,
	pin,
	use,
	type ConfigInput,
	type Descriptor,
	type GenreDecl,
	type PresetInput,
	type SpecDocument,
} from '@serene-pub/sdk'
import declarations from './declarations.json' with { type: 'json' }
${imports.join("\n")}

/** The namespace every id this package registers sits under. */
export const PLUGIN_SLUG = ${lit(slug)}

/** The pipelines this package ships, by id — compiled documents, as exported. */
export const pipelines: Record<string, SpecDocument> = {
${pipelineMap}
}

const d = declarations as Record<string, any>

/** A spec by id: this package's own document, else another package's by \`use()\`. */
const specRef = (id: string) => pipelines[id] ?? use(id)

/* ── Node definitions: re-declared from what the pub stored ─────────────── */

const describe = {
	inlet: describeInletDefinition,
	query: describeQueryDefinition,
	task: describeTaskDefinition,
	oracle: describeOracleDefinition,
	outlet: describeOutletDefinition,
} as Record<string, (decl: any) => Descriptor<any, any, any>>

/** A stored port map (\`name → shape id\`) as the shapes a declaration takes. */
const shapesOf = (ports: Record<string, string> | undefined) =>
	Object.fromEntries(
		Object.entries(ports ?? {}).map(([name, id]) => {
			const shape = getShape(id)
			if (!shape) throw new Error(\`port '\${name}' names the shape '\${id}', which this SDK does not have\`)
			return [name, shape]
		}),
	)

/**
 * Each of this package's own node definitions, from its stored declaration.
 * ✎ CHANGE: write each one's handler below. The pub kept the declaration and
 *   not the code, so until you do the node refuses every run.
 */
export const definitions = ((d.nodeDefinitions ?? []) as any[]).map(({ kind, ports, ...decl }) =>
	pin(describe[kind]!({ ...decl, ports: { in: shapesOf(ports?.in), out: shapesOf(ports?.out) } })),
)

const handlers = definitions.map((definition) =>
	handler(definition, async () => {
		throw new Error(\`✎ CHANGE: '\${definition.id}' has no handler yet — write it in src/index.ts\`)
	}),
)

/* ── Configs and presets, re-bound to values ─────────────────────────────── */

export const configs: ConfigInput<any>[] = ((d.configs ?? []) as any[]).map((c) =>
	config(specRef(c.spec), c.slug, { label: c.label, ...(c.description !== undefined ? { description: c.description } : {}) }, c.values),
)

const genres = (d.genres ?? []) as GenreDecl[]
const genreRef = (id: string) => genres.find((g) => g.id === id) ?? use(id)

export const presets: PresetInput[] = ((d.presets ?? []) as any[]).map((p) => {
	// One binding per spec, on the events the stored preset binds it on.
	const bySpec = new Map<string, { events: string[]; config?: string }>()
	for (const [event, b] of Object.entries(p.bindings ?? {}) as [string, any][]) {
		const entry = bySpec.get(b.spec) ?? { events: [] as string[], config: b.config as string | undefined }
		entry.events.push(event)
		bySpec.set(b.spec, entry)
	}
	const { swaps: _swaps, ...defaults } = p.defaults ?? {}
	return {
		slug: p.slug,
		genre: genreRef(p.genre) as PresetInput['genre'],
		label: p.label,
		...(p.description !== undefined ? { description: p.description } : {}),
		bindings: [...bySpec].map(([spec, b]) => ({
			spec: specRef(spec),
			events: b.events,
			...(b.config !== undefined
				? { config: configs.find((c) => (c.spec as { id: string }).id === spec && c.slug === b.config) }
				: {}),
		})),
		...(p.actions?.include
			? {
					actions: {
						include: (p.actions.include as string[]).map((pick) => {
							const [spec, key] = pick.split('#')
							return { spec: specRef(spec!), key: key! }
						}),
					},
				}
			: {}),
		...(p.defaults ? { defaults } : {}),
		...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
	} as PresetInput
})

/* ── The package ────────────────────────────────────────────────────────── */

export const extension = defineExtension({
	slug: PLUGIN_SLUG,
	name: ${lit(m.name)},
	version: ${lit(m.version)},
	${typeof m.description === "string" ? `description: ${lit(m.description)},\n\t` : ""}${m.engines ? `engines: ${lit(m.engines)},\n\t` : ""}handlers,
	genres,
	pipelines: Object.values(pipelines),
	presets,
	configs,
	...(d.prompts ? { prompts: d.prompts } : {}),
	...(d.widgets ? { widgets: d.widgets } : {}),
	...(d.components ? { components: d.components } : {}),
	...(d.surfaces ? { surfaces: d.surfaces } : {}),
})

export default extension
`

	// ---- the test ------------------------------------------------------------
	out["test/package.test.ts"] = `/**
 * What this package declares — pinned where an install would read it.
 * ✎ CHANGE: as the declaration grows, so does this file.
 */

import { describe, expect, it } from 'vitest'
import { validate } from '@serene-pub/sdk'

import { extension, PLUGIN_SLUG } from '../src/index.js'

describe('the package', () => {
	it('is the one this repository owns', () => {
		expect(extension.slug).toBe(PLUGIN_SLUG)
		expect(extension.genres?.map((g) => g.id)).toEqual(${lit(genres.map((g) => g.id))})
	})

	it('ships the pipelines it was exported with, each valid', () => {
		expect((extension.pipelines ?? []).map((p) => p.id)).toEqual(${lit(pipelineIds)})
		for (const doc of extension.pipelines ?? []) {
			const errors = validate(doc as never).filter((f) => f.severity === 'error')
			expect(errors, doc.id).toEqual([])
		}
	})
})
`

	// ---- the README ----------------------------------------------------------
	const list = (xs: string[]) => (xs.length ? xs.map((x) => `\`${x}\``).join(" · ") : "none")
	out["README.md"] = `# ${m.name} — a Serene Pub plugin

${typeof m.description === "string" ? m.description : "✎ CHANGE: two sentences saying what this plugin is for."}

Exported from a Serene Pub **with source**: \`dist/plugin/\` is the package as the pub
built it, and \`src/\` is what builds it again.

\`\`\`bash
npm install
npx serene-pub build .   # dist/plugin/: the manifest plus one document per pipeline
npm test                 # the declaration
npm run check            # what core would refuse, and the permissions the code requests
\`\`\`

## What it declares

| | |
| --- | --- |
| Genres | ${list(genres.map((g: any) => g.id))} |
| Pipelines | ${list(pipelineIds)} |
| Presets | ${list(((m.presets ?? []) as any[]).map((p) => p.slug))} |
| Configs | ${list(((m.configs ?? []) as any[]).map((c) => `${c.spec}#${c.slug}`))} |
| Node definitions | ${list(((m.nodeDefinitions ?? []) as any[]).map((d) => d.id))} |
| Requires | ${list((m.requires ?? []) as string[])} |

## Where things are

- \`src/pipelines/*.json\` — each pipeline as a **compiled document**. Edit it on the pub's
  canvas and export again, or rewrite it with the SDK's builder (\`spec(…)\`) and put the
  built spec in \`pipelines\` in its place.
- \`src/declarations.json\` — the genre, presets, configs, prompts, widgets and layouts,
  as the manifest stores them.
- \`src/index.ts\` — the one \`defineExtension\`; it re-binds presets and configs to the
  spec values the SDK asks for.

## What is left for you to write

${todo.length ? todo.map((t) => `- ${t.charAt(0).toUpperCase()}${t.slice(1)}`).join("\n") : "- Nothing: everything this package declares was data."}
`

	return { files: out, todo }
}
