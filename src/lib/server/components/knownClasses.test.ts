/**
 * The class list a component is checked against (D5): the build writes
 * `build/component-classes.json` from the built CSS (scripts/component-classes.js),
 * and the compile service loads it — or checks nothing when there is none.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The compile service's store and cache reach the database; this reads a file only.
vi.mock("./store", () => ({ getAuthoredComponent: vi.fn(), recordAuthoredCompile: vi.fn() }))
vi.mock("./cache", () => ({ writeArtifact: vi.fn() }))

import { COMPONENT_CLASSES_FILE, loadKnownClasses } from "./compile"
import { cssClassNames, writeComponentClasses, COMPONENT_CLASSES_FILE as WRITTEN_FILE } from "../../../../scripts/component-classes.js"

let root: string
beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "sp-known-classes-"))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("the built class list", () => {
	test("takes each class selector out of the CSS, unescaped, and nothing that only looks like one", () => {
		const css = [
			`/* .not-a-class */ .flex{display:flex}`,
			`.md\\:flex{display:flex}.hover\\:underline:hover{text-decoration:underline}`,
			`.w-1\\/2{width:50%}.\\32 xl\\:p-0{padding:0}`,
			`@media (min-width:40rem){.sm\\:gap-2{gap:.5rem}}`,
			`@font-face{src:url(fonts/sans.woff2)}`,
			`.card :is(.title, .sub)>p{margin:0.5rem;content:".fake"}`
		].join("\n")
		expect(cssClassNames(css)).toEqual(["2xl:p-0", "card", "flex", "hover:underline", "md:flex", "sm:gap-2", "sub", "title", "w-1/2"])
	})

	test("the build writes it where the compile service reads it, and the service loads it", () => {
		expect(WRITTEN_FILE).toBe(COMPONENT_CLASSES_FILE)
		const assets = join(root, "build", "client", "_app", "immutable", "assets")
		mkdirSync(assets, { recursive: true })
		writeFileSync(join(assets, "0.css"), `.flex{display:flex}.text-sm{font-size:.875rem}`)
		writeFileSync(join(assets, "1.css"), `.flex{display:flex}.md\\:grid{display:grid}`)
		const r = writeComponentClasses(join(root, "build"))
		expect(r).toMatchObject({ classes: 3, stylesheets: 2 })
		expect(loadKnownClasses(root)).toEqual(["flex", "md:grid", "text-sm"])
	})

	test("no list, or not a list of strings, checks nothing", () => {
		const bare = mkdtempSync(join(root, "bare-"))
		expect(loadKnownClasses(bare)).toBeNull()
		mkdirSync(join(bare, "build"))
		writeFileSync(join(bare, "build", COMPONENT_CLASSES_FILE), `{"flex":true}`)
		expect(loadKnownClasses(bare)).toBeNull()
		writeFileSync(join(bare, "build", COMPONENT_CLASSES_FILE), `not json`)
		expect(loadKnownClasses(bare)).toBeNull()
	})
})
