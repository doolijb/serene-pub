/**
 * The component editor's pure decisions (C6, P6): completions generated from
 * the SDK's host-element table, compile errors mapped to places in the files,
 * the "core changed since you cloned" banner, file-tab path rules, the admin
 * redirect and stale-save handling. Unit-level: no DOM, no CodeMirror.
 */
import { describe, expect, it } from "vitest"
import { GLOBAL_ATTRIBUTES, SP_HOST_ELEMENTS, type HostElementSpec } from "@serene-pub/sdk"
import { isSafeComponentPath as sdkIsSafeComponentPath } from "@serene-pub/cli/component-source"
import {
	hostAttributeOptions,
	hostCompletions,
	hostElementTagOptions,
	hostSlotOptions
} from "./spCompletions"
import { errorLocation, errorPlace, errorRows, offsetOf } from "./compileErrors"
import {
	COMPONENT_DRAFT_TEXT,
	SAVE_CONFLICT_TEXT,
	adminRedirect,
	canRevertDraft,
	editorSource,
	exportNotice,
	saveNotice,
	coreDrift,
	fileDiffList,
	isSaveConflict,
	sameFiles,
	withEnglish
} from "./editorState"
import {
	COMPONENT_FILE_LIMIT,
	deleteFileProblem,
	fileOrder,
	filePathProblem,
	isSafeComponentPath,
	renameFile,
	tabLabels
} from "./componentFiles"
import { previewRequestHandler, PREVIEW_LORE } from "./previewFixtures"

const TABLE = SP_HOST_ELEMENTS as unknown as Record<string, HostElementSpec>

describe("host-element completions match SP_HOST_ELEMENTS", () => {
	it("offers every tag in the table and nothing else", () => {
		const labels = hostElementTagOptions().map((o) => o.label)
		expect([...labels].sort()).toEqual(Object.keys(TABLE).sort())
		// sp elements lead the list.
		const firstPlain = labels.findIndex((l) => !l.startsWith("sp-"))
		expect(labels.slice(firstPlain).every((l) => !l.startsWith("sp-"))).toBe(true)
	})

	it("offers each tag's attributes, the global ones, slot, and on<event> per event", () => {
		for (const [tag, spec] of Object.entries(TABLE)) {
			const labels = new Set(hostAttributeOptions(tag)!.map((o) => o.label))
			for (const a of spec.attributes) expect(labels, `${tag} ${a}`).toContain(a)
			for (const a of GLOBAL_ATTRIBUTES) expect(labels).toContain(a)
			expect(labels).toContain("slot")
			for (const e of spec.events) expect(labels, `${tag} on${e}`).toContain(`on${e}`)
			const expected = new Set([...spec.attributes, ...GLOBAL_ATTRIBUTES, "slot", ...spec.events.map((e) => `on${e}`)])
			expect(labels.size).toBe(expected.size)
		}
	})

	it("offers every declared slot name", () => {
		const declared = new Set(Object.values(TABLE).flatMap((s) => s.slots ?? []))
		expect(new Set(hostSlotOptions().map((o) => o.label))).toEqual(declared)
	})

	it("reads the cursor's context in a .svelte file", () => {
		const tag = hostCompletions("<div>\n\t<sp-sw", "svelte")!
		expect(tag.from).toBe("<div>\n\t<".length)
		expect(tag.options.some((o) => o.label === "sp-switch")).toBe(true)

		const before = `<sp-switch checked={on} onchange={(e) => (on = e.detail > 0)} `
		const attr = hostCompletions(before, "svelte")!
		expect(attr.from).toBe(before.length)
		expect(attr.options.map((o) => o.label)).toEqual(hostAttributeOptions("sp-switch")!.map((o) => o.label))

		const partial = hostCompletions(`<sp-switch lab`, "svelte")!
		expect(partial.from).toBe(`<sp-switch `.length)

		const slotName = TABLE["sp-dialog"]?.slots?.[0]
		if (slotName) {
			const s = hostCompletions(`<div slot="`, "svelte")!
			expect(s.options.map((o) => o.label)).toContain(slotName)
		}
	})

	it("offers nothing where no host element is being named", () => {
		expect(hostCompletions("<sp-switch>", "svelte")).toBeNull() // tag closed
		expect(hostCompletions("<SlotControl ", "svelte")).toBeNull() // a Svelte component
		expect(hostCompletions("<Slot", "svelte")).toBeNull()
		expect(hostCompletions("<sp-switch onchange={() => ", "svelte")).toBeNull() // inside an expression
		expect(hostCompletions(`<sp-switch class="a`, "svelte")).toBeNull() // inside a value that is not slot
		expect(hostCompletions(`<script lang="ts">\n\tconst xs: Array<`, "svelte")).toBeNull() // a generic
		expect(hostCompletions("const x = a <", "ts")).toBeNull()
	})

	it("completes the tag inside createElement in a vanilla module", () => {
		const r = hostCompletions("const el = document.createElement('sp-ba", "ts")!
		expect(r.from).toBe("const el = document.createElement('".length)
		expect(r.options.some((o) => o.label === "sp-badge")).toBe(true)
	})
})

describe("compile errors map to places in the files", () => {
	const files = { "Stats.svelte": "<script>\n\tlet a = 1\n</script>\n<p>{a}</p>", "stats.ts": "export {}" }

	it("turns 1-based line and 0-based column into an offset", () => {
		expect(offsetOf(files["Stats.svelte"], 1, 0)).toBe(0)
		expect(offsetOf(files["Stats.svelte"], 2, 1)).toBe("<script>\n\t".length)
		expect(offsetOf(files["Stats.svelte"], 4, 3)).toBe("<script>\n\tlet a = 1\n</script>\n<p>".length)
	})

	it("clamps a place the draft has since moved past", () => {
		const text = files["Stats.svelte"]
		expect(offsetOf(text, 99, 0)).toBe(text.lastIndexOf("\n") + 1)
		expect(offsetOf(text, 2, 500)).toBe("<script>\n\tlet a = 1".length)
	})

	it("has no location for line 0, an unknown file or no file", () => {
		expect(errorLocation({ file: "Stats.svelte", line: 0, column: 0, text: "x" }, files)).toBeNull()
		expect(errorLocation({ file: "Gone.svelte", line: 1, column: 0, text: "x" }, files)).toBeNull()
		expect(errorLocation({ file: "", line: 3, column: 0, text: "x" }, files)).toBeNull()
		expect(errorLocation({ file: "./stats.ts", line: 1, column: 7, text: "x" }, files)).toEqual({
			file: "stats.ts",
			offset: 7,
			line: 1,
			column: 7
		})
	})

	it("prints the place 1-based and lists compile errors before runtime ones", () => {
		expect(errorPlace({ file: "Stats.svelte", line: 2, column: 4, text: "" })).toBe("Stats.svelte:2:5")
		expect(errorPlace({ file: "Stats.svelte", line: 0, column: 0, text: "" })).toBe("Stats.svelte")
		const rows = errorRows(
			[{ file: "Stats.svelte", line: 2, column: 1, text: "Unexpected token" }],
			[{ message: "boom", stack: "    at x (y.js:1:1)" }],
			files
		)
		expect(rows.map((r) => [r.kind, r.place, r.text, !!r.location])).toEqual([
			["compile", "Stats.svelte:2:2", "Unexpected token", true],
			["runtime", "", "boom", false]
		])
		expect(rows[1]!.stack).toContain("y.js")
	})
})

describe("the core-changed banner", () => {
	const basedOn = { component: "stats", version: "0.6.0", sourceHash: "aaa" }

	it("shows only when core's source hash moved since the clone", () => {
		expect(coreDrift(basedOn, { slug: "stats", sourceHash: "bbb" })).toBe("changed")
		expect(coreDrift(basedOn, { slug: "stats", sourceHash: "aaa" })).toBe("same")
	})

	it("says nothing it cannot know", () => {
		expect(coreDrift(null, { slug: "stats", sourceHash: "bbb" })).toBe("not-a-clone")
		expect(coreDrift(basedOn, null)).toBe("unknown")
		expect(coreDrift(basedOn, { slug: "world-state", sourceHash: "bbb" })).toBe("unknown")
		expect(coreDrift({ component: "stats", version: "0.6.0" }, { slug: "stats", sourceHash: "bbb" })).toBe("unknown")
	})

	it("lists which files differ from core, changed first", () => {
		expect(fileDiffList({ "a.ts": "1", "b.ts": "2", "c.ts": "3" }, { "a.ts": "1", "b.ts": "x", "d.ts": "4" })).toEqual([
			{ path: "b.ts", status: "changed" },
			{ path: "d.ts", status: "added" },
			{ path: "c.ts", status: "removed" },
			{ path: "a.ts", status: "same" }
		])
	})
})

describe("file tabs hold to the compiler's path rules", () => {
	it("agrees with the SDK's isSafeComponentPath", () => {
		const cases = [
			"Widget.svelte",
			"sessions/stats/Stats.svelte",
			"state/slotWriter.svelte.ts",
			"a.js",
			"../x.ts",
			"a/../b.ts",
			"./a.ts",
			"/abs.ts",
			"a\\b.ts",
			"a b.ts",
			"notes.md",
			"x.svelte.md",
			".hidden.ts",
			"-a.ts",
			"",
			"a//b.ts",
			"ünï.ts"
		]
		for (const p of cases) expect(isSafeComponentPath(p), p).toBe(sdkIsSafeComponentPath(p))
	})

	it("refuses a bad name, a taken name and the file past the limit", () => {
		const files = { "widget.ts": "", "Widget.svelte": "" }
		expect(filePathProblem("Other.svelte", files)).toBeNull()
		expect(filePathProblem("", files)).toMatch(/Name the file/)
		expect(filePathProblem(" a.ts", files)).toMatch(/no spaces/)
		expect(filePathProblem("../escape.ts", files)).toMatch(/\.svelte, \.ts or \.js/)
		expect(filePathProblem("readme.md", files)).toMatch(/\.svelte, \.ts or \.js/)
		expect(filePathProblem("Widget.svelte", files)).toMatch(/already a file/)
		const full = Object.fromEntries(Array.from({ length: COMPONENT_FILE_LIMIT }, (_, i) => [`f${i}.ts`, ""]))
		expect(filePathProblem("more.ts", full)).toMatch(/at most 64/)
	})

	it("lets a rename keep its own name, and moves the entry with its file", () => {
		const files = { "widget.ts": "w", "Widget.svelte": "s" }
		expect(filePathProblem("Widget.svelte", files, "Widget.svelte")).toBeNull()
		expect(filePathProblem("widget.ts", files, "Widget.svelte")).toMatch(/already a file/)
		expect(renameFile(files, "widget.ts", "widget.ts", "main.ts")).toEqual({
			files: { "main.ts": "w", "Widget.svelte": "s" },
			entry: "main.ts"
		})
	})

	it("labels a tab by its file name, with folders only where two names collide", () => {
		expect(tabLabels(["sessions/stats/stats.ts", "sessions/stats/Stats.svelte", "a/context.ts", "b/context.ts", "x.ts"])).toEqual({
			"sessions/stats/stats.ts": "stats.ts",
			"sessions/stats/Stats.svelte": "Stats.svelte",
			"a/context.ts": "a/context.ts",
			"b/context.ts": "b/context.ts",
			"x.ts": "x.ts"
		})
	})

	it("never deletes the entry or the last file", () => {
		const files = { "widget.ts": "", "Widget.svelte": "" }
		expect(deleteFileProblem("Widget.svelte", files, "widget.ts")).toBeNull()
		expect(deleteFileProblem("widget.ts", files, "widget.ts")).toMatch(/entry/)
		expect(deleteFileProblem("gone.ts", files, "widget.ts")).toMatch(/no file/)
		expect(fileOrder({ "b.ts": "", "a.svelte": "", "widget.ts": "" }, "widget.ts")).toEqual(["widget.ts", "a.svelte", "b.ts"])
	})
})

describe("who may be here, and a stale save", () => {
	it("sends a non-admin home and keeps an admin", () => {
		expect(adminRedirect(null)).toBe("/")
		expect(adminRedirect(undefined)).toBe("/")
		expect(adminRedirect({ isAdmin: false })).toBe("/")
		expect(adminRedirect({ isAdmin: true })).toBeNull()
	})

	it("recognises the server's conflict refusal and nothing else", () => {
		expect(
			isSaveConflict("authored component 'abc123defg' changed since it was read — reload it and save again")
		).toBe(true)
		expect(isSaveConflict("The component was refused: entry \"x\" is not one of the files.")).toBe(false)
		expect(isSaveConflict(undefined)).toBe(false)
		expect(SAVE_CONFLICT_TEXT).toMatch(/reload/i)
	})

	it("compares drafts by content and keeps a locale map's other locales", () => {
		expect(sameFiles({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true)
		expect(sameFiles({ a: "1" }, { a: "1", b: "" })).toBe(false)
		expect(withEnglish("Stats", "My stats")).toBe("My stats")
		expect(withEnglish({ en: "Stats", fr: "Stats" }, "My stats")).toEqual({ en: "My stats", fr: "Stats" })
	})
})

describe("the preview's requests", () => {
	it("answers from fixtures or stubs, and never rejects", async () => {
		const notes: string[] = []
		const handle = previewRequestHandler((n) => notes.push(`${n.kind}:${n.answered}`))
		const from = { widgetId: "authored.x:stats", owner: "authored.abcdefghij" }
		const page = (await handle("session-entries", { titleOrKey: "lant" }, from)) as { rows: unknown[]; total: number }
		expect(page.total).toBe(1)
		expect(page.rows).toEqual([PREVIEW_LORE[2]])
		await expect(handle("set-attribute-value", { owner: { kind: "session_cast", id: 11 }, slotId: "s", value: 1 }, from)).resolves.toBeUndefined()
		expect(notes).toEqual(["session-entries:fixture", "set-attribute-value:stub"])
	})
})

describe("the saved version and the component draft", () => {
	const saved = { "w.ts": "export default 1" }
	const broken = { "w.ts": "export default {" }

	it("opens the draft when there is one, else the saved version", () => {
		expect(editorSource({ files: saved, entry: "w.ts", componentDraft: null })).toEqual({ files: saved, entry: "w.ts", fromDraft: false })
		expect(editorSource({ files: saved, entry: "w.ts" })).toMatchObject({ fromDraft: false })
		expect(editorSource({ files: saved, entry: "w.ts", componentDraft: { files: broken, entry: "w.ts" } })).toEqual({
			files: broken,
			entry: "w.ts",
			fromDraft: true
		})
	})

	it("offers Revert to last save only over a draft, with a compiler, and nothing in flight", () => {
		const drafted = { componentDraft: { files: broken, entry: "w.ts" } }
		expect(canRevertDraft(drafted, { busy: false, readOnly: false })).toBe(true)
		expect(canRevertDraft(drafted, { busy: true, readOnly: false })).toBe(false)
		expect(canRevertDraft(drafted, { busy: false, readOnly: true })).toBe(false)
		expect(canRevertDraft({ componentDraft: null }, { busy: false, readOnly: false })).toBe(false)
		expect(canRevertDraft(null, { busy: false, readOnly: false })).toBe(false)
	})

	it("says a broken save was kept as a draft and sessions keep the last save", () => {
		expect(COMPONENT_DRAFT_TEXT).toBe("Draft — doesn't compile; sessions keep running the last save.")
		const d = saveNotice({ stored: "component-draft", compile: { errors: [{}] } })
		expect(d.tone).toBe("warning")
		expect(d.title).toMatch(/draft/i)
		expect(d.description).toMatch(/keep running the last save/)
		const never = saveNotice({ stored: "saved-version", compile: { errors: [{}] } })
		expect(never.description).toMatch(/not offered/)
		expect(saveNotice({ stored: "saved-version", compile: { errors: [] } })).toEqual({ tone: "success", title: "Saved" })
	})

	it("an export says when a draft was left out of the file", () => {
		expect(exportNotice({ componentDraftLeftOut: true }, false)?.title).toBe("Exported the last save")
		expect(exportNotice({ componentDraftLeftOut: false }, true)?.title).toBe("Exported the saved version")
		expect(exportNotice({ componentDraftLeftOut: false }, false)).toBeNull()
	})
})
