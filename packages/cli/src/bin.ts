#!/usr/bin/env node
/**
 * `serene-pub` — the plugin author's command line.
 *
 * Three verbs, and each one answers a question an author actually asks:
 *
 *   build     what will core see when it installs this? (manifest + documents)
 *   check     what am I doing that core will refuse, and why?
 *   contracts what types does this release give me to pin against?
 *
 * There is deliberately no `publish` and no `install`. Installing an extension is an
 * admin action inside SP, not something a build tool can do to somebody's instance —
 * a CLI that could install would be a CLI that could be scripted into installing.
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compilePlugin, scanSource, renderFindings, cannotDo } from './compiler.js'
import { generateContracts } from './codegen.js'

const USAGE = `serene-pub <command>

  build [dir]        package the plugin in [dir] (default: .) into dist/plugin/
  check [dir]        report what core would refuse, without writing anything
  contracts [dir]    generate a /contracts module from the types [dir] registers

Options
  --out <dir>        where to write (build, contracts)
  --release <ver>    stamped into the generated contracts banner
  --json             machine-readable output
`

async function sourcesIn(dir: string): Promise<Array<{ path: string; text: string }>> {
	const out: Array<{ path: string; text: string }> = []
	const walk = async (d: string) => {
		for (const entry of await readdir(d)) {
			if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
			const full = join(d, entry)
			const s = await stat(full)
			if (s.isDirectory()) await walk(full)
			else if (/\.(ts|tsx|js|mjs)$/.test(entry) && !/\.d\.ts$/.test(entry))
				out.push({ path: relative(dir, full), text: await readFile(full, 'utf8') })
		}
	}
	await walk(dir)
	return out
}

/**
 * The dynamic half. The packager reads source statically *and* evaluates the author's
 * entry module to get the built `Extension` — the two halves are cross-checked against
 * each other, which is what catches a hook registered behind an `if` (13 §30).
 *
 * Evaluating here is safe in a way it is not in core: this runs on the author's own
 * machine, on their own code. **Core never does this** — it imports documents, never
 * authoring JS (F6).
 */
async function loadExtension(dir: string): Promise<unknown> {
	for (const candidate of ['dist/index.js', 'src/index.ts', 'index.ts', 'index.js']) {
		const p = resolve(dir, candidate)
		try {
			const mod = await import(pathToFileURL(p).href)
			return mod.default ?? mod.extension
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw e
		}
	}
	throw new Error(
		`no entry module found in ${dir}. Export your defineExtension(…) result as the default ` +
			`export of src/index.ts or dist/index.js.`,
	)
}

const flag = (argv: string[], name: string) => {
	const i = argv.indexOf(`--${name}`)
	return i === -1 ? undefined : argv[i + 1]
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	const [cmd, maybeDir] = argv
	const dir = resolve(maybeDir && !maybeDir.startsWith('--') ? maybeDir : '.')
	const json = argv.includes('--json')

	if (!cmd || cmd === '--help' || cmd === '-h') {
		process.stdout.write(USAGE)
		return 0
	}

	if (cmd === 'check') {
		const scan = scanSource(await sourcesIn(dir))
		if (json) process.stdout.write(JSON.stringify(scan, null, 2) + '\n')
		else {
			process.stdout.write(renderFindings(scan.findings) + '\n')
			process.stdout.write(`\npermissions this code would request:\n`)
			for (const p of scan.permissions) process.stdout.write(`  ${p}\n`)
		}
		return scan.findings.some((f) => f.severity === 'error') ? 1 : 0
	}

	if (cmd === 'build') {
		const sources = await sourcesIn(dir)
		const extension = await loadExtension(dir)
		const r = compilePlugin({ sources, extension: extension as never })
		if (!r.ok) {
			process.stderr.write(renderFindings(r.findings) + '\n')
			return 1
		}
		const out = resolve(dir, flag(argv, 'out') ?? 'dist/plugin')
		await mkdir(join(out, 'pipelines'), { recursive: true })
		await writeFile(join(out, 'manifest.json'), JSON.stringify(r.manifest, null, 2))
		for (const doc of r.documents)
			await writeFile(join(out, 'pipelines', `${doc.id.replace(/[:/]/g, '_')}.json`), JSON.stringify(doc, null, 2))
		if (json) process.stdout.write(JSON.stringify(r.manifest, null, 2) + '\n')
		else {
			process.stdout.write(`wrote ${r.documents.length + 1} files to ${relative(process.cwd(), out)}\n\n`)
			// Printed on every successful build on purpose. The list of what a plugin
			// *cannot* do is generated from the manifest, so it cannot flatter — and an
			// author who sees it here is not surprised by it on the consent screen.
			process.stdout.write('what this plugin cannot do:\n')
			for (const line of cannotDo(r.manifest!)) process.stdout.write(`  · ${line}\n`)
		}
		return 0
	}

	if (cmd === 'contracts') {
		const { allTypes } = await import('@serene-pub/sdk')
		await loadExtension(dir).catch(() => undefined)
		const text = generateContracts(allTypes(), { release: flag(argv, 'release') })
		const out = flag(argv, 'out')
		if (out) {
			await writeFile(resolve(out), text)
			process.stdout.write(`wrote ${out}\n`)
		} else process.stdout.write(text)
		return 0
	}

	process.stderr.write(`unknown command '${cmd}'\n\n${USAGE}`)
	return 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main().then(
		(code) => process.exit(code),
		(e) => {
			process.stderr.write(`${(e as Error).message}\n`)
			process.exit(1)
		},
	)
}
