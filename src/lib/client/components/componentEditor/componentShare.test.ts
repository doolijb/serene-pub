/**
 * Sharing authored components (C6, P7): the import dialog's pure decisions —
 * file type and the size cap, a pasted file becoming `{ text, filename }`,
 * the preview summary as sentences, replies taken only while waiting, and
 * the export's download name. Unit-level: no DOM.
 */
import { describe, expect, it } from "vitest"
import {
	CHOOSE,
	SHARE_CLIENT_MAX_BYTES,
	fileProblem,
	formatBytes,
	importSummaryView,
	onImportError,
	onImportReply,
	onPreviewError,
	onPreviewReply,
	pastedInput,
	readShareFile,
	safeShareFileName,
	shareFileKind,
	type ImportPhase
} from "./componentShare"

type Summary = Sockets.Components.ImportSummary

const summary = (over: Partial<Summary> = {}): Summary => ({
	slug: "stats",
	importAs: "stats",
	label: "Stats",
	framework: "svelte",
	entry: "Stats.svelte",
	basedOn: null,
	files: [{ path: "Stats.svelte", bytes: 2048 }],
	widget: { title: "Stats" },
	requestedScopes: [],
	singleFile: false,
	artifact: { carried: false, verifies: false, fingerprint: null },
	runs: "recompiled",
	compile: { errors: [], warnings: [], artifactHash: "a".repeat(64), fingerprint: "fp" },
	...over
})

const file = (name: string, text: string, size = new TextEncoder().encode(text).length) => ({
	name,
	size,
	text: async () => text
})

describe("file type and the 4 MiB cap", () => {
	it("tells a share file from one source file, and refuses anything else", () => {
		expect(shareFileKind("stats.component.json")).toBe("share-file")
		expect(shareFileKind("anything.JSON")).toBe("share-file")
		expect(shareFileKind("Tally.svelte")).toBe("source-file")
		expect(shareFileKind("dir/clock.ts")).toBe("source-file")
		expect(shareFileKind("clock.js")).toBe("source-file")
		expect(shareFileKind("notes.txt")).toBeNull()
		expect(shareFileKind("archive.zip")).toBeNull()
		expect(shareFileKind("")).toBeNull()
		expect(shareFileKind("svelte")).toBeNull()
	})

	it("refuses a file over the cap before reading it, and passes one at the cap", async () => {
		expect(fileProblem({ name: "big.component.json", size: SHARE_CLIENT_MAX_BYTES + 1 })).toMatch(/at most 4\.0 MiB/)
		expect(fileProblem({ name: "big.component.json", size: SHARE_CLIENT_MAX_BYTES })).toBeNull()
		let read = false
		const res = await readShareFile({
			name: "big.svelte",
			size: SHARE_CLIENT_MAX_BYTES + 1,
			text: async () => {
				read = true
				return ""
			}
		})
		expect(res.ok).toBe(false)
		expect(read).toBe(false)
	})

	it("refuses a wrong type by name, before reading", async () => {
		const res = await readShareFile(file("photo.png", "x"))
		expect(res).toEqual({ ok: false, problem: expect.stringMatching(/"photo\.png" is not a file this can import/) })
	})

	it("counts bytes, not characters, when a file lies about its size", async () => {
		const text = "é".repeat(SHARE_CLIENT_MAX_BYTES / 2 + 1) // 2 bytes each
		const res = await readShareFile(file("x.svelte", text, 10))
		expect(res.ok).toBe(false)
	})

	it("reads a picked file into { text, filename }", async () => {
		expect(await readShareFile(file("stats.component.json", "{}"))).toEqual({
			ok: true,
			input: { text: "{}", filename: "stats.component.json" }
		})
	})

	it("formats sizes for the file list", () => {
		expect(formatBytes(812)).toBe("812 B")
		expect(formatBytes(2048)).toBe("2.0 KB")
		expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MiB")
	})
})

describe("a pasted single file", () => {
	it("becomes { text, filename } under the name typed", () => {
		expect(pastedInput("<p>hi</p>", "Tally.svelte")).toEqual({ ok: true, input: { text: "<p>hi</p>", filename: "Tally.svelte" } })
		expect(pastedInput("export default {}", "  clock.ts ")).toEqual({
			ok: true,
			input: { text: "export default {}", filename: "clock.ts" }
		})
	})

	it("is named Component.svelte when no name is typed", () => {
		expect(pastedInput("<p>hi</p>", "")).toEqual({ ok: true, input: { text: "<p>hi</p>", filename: "Component.svelte" } })
	})

	it("is a share file when it is JSON and no name is typed", () => {
		const r = pastedInput('  {"serenePub":"component@1"}', "")
		expect(r.ok && r.input.filename).toBe("pasted.component.json")
	})

	it("refuses nothing pasted, a name of the wrong type, and text over the cap", () => {
		expect(pastedInput("   ", "a.svelte").ok).toBe(false)
		expect(pastedInput("<p/>", "a.html")).toEqual({ ok: false, problem: expect.stringMatching(/"a\.html" is not/) })
		expect(pastedInput("x".repeat(SHARE_CLIENT_MAX_BYTES + 1), "a.svelte").ok).toBe(false)
	})
})

describe("the preview summary", () => {
	it("runs line: recompiled here, the carried module, or cannot run and why", () => {
		expect(importSummaryView(summary()).runs).toEqual({ tone: "ok", text: expect.stringMatching(/^Recompiled here/) })
		expect(
			importSummaryView(summary({ runs: "carried-artifact", compile: null, artifact: { carried: true, verifies: true, fingerprint: "fp" } })).runs
		).toEqual({ tone: "ok", text: expect.stringMatching(/^Runs the compiled module the file carries/) })
		const none = importSummaryView(summary({ runs: "refused", compile: null }))
		expect(none.runs.tone).toBe("error")
		expect(none.runs.text).toMatch(/carries no compiled module/)
		expect(none.canImport).toBe(false)
		const tampered = importSummaryView(
			summary({ runs: "refused", compile: null, artifact: { carried: true, verifies: false, fingerprint: "fp" } })
		)
		expect(tampered.runs.text).toMatch(/does not match the hash/)
		expect(tampered.canImport).toBe(false)
	})

	it("verify line: source only, verifies (unused when recompiled), or does not verify", () => {
		expect(importSummaryView(summary()).verify).toEqual({ tone: "quiet", text: "Source only: no compiled module." })
		const carriedHere = importSummaryView(summary({ artifact: { carried: true, verifies: true, fingerprint: "esbuild@0.28" } }))
		expect(carriedHere.verify.text).toBe("Carries a compiled module that matches its hash. It is not used here.")
		expect(carriedHere.verify.tone).toBe("quiet")
		const runsCarried = importSummaryView(
			summary({ runs: "carried-artifact", compile: null, artifact: { carried: true, verifies: true, fingerprint: "fp" } })
		)
		expect(runsCarried.verify).toEqual({ tone: "ok", text: "Carries a compiled module that matches its hash (built by fp)." })
		expect(importSummaryView(summary({ artifact: { carried: true, verifies: false, fingerprint: "fp" } })).verify.tone).toBe("warning")
		expect(
			importSummaryView(summary({ runs: "refused", compile: null, artifact: { carried: true, verifies: false, fingerprint: "fp" } })).verify
		).toEqual({ tone: "error", text: "Carries a compiled module that does not match its hash." })
	})

	it("rename line: only when the slug is taken", () => {
		expect(importSummaryView(summary()).rename).toBeNull()
		expect(importSummaryView(summary({ importAs: "stats-2" })).rename).toBe('"stats" is taken here, so it imports as "stats-2".')
	})

	it("basedOn: says whether core's component here differs from the one it was cloned from", () => {
		const basedOn = { component: "stats", version: "0.6.0", sourceHash: "h1" }
		expect(importSummaryView(summary()).basedOn).toBeNull()
		expect(importSummaryView(summary({ basedOn }), [{ slug: "stats", sourceHash: "h1" }]).basedOn).toEqual({
			drift: "same",
			text: "Clone of core's stats (0.6.0). Core's stats here is the one it was cloned from."
		})
		expect(importSummaryView(summary({ basedOn }), [{ slug: "stats", sourceHash: "h2" }]).basedOn?.drift).toBe("changed")
		expect(importSummaryView(summary({ basedOn }), []).basedOn?.text).toMatch(/has no core stats/)
	})

	it("lists files with sizes and the entry, the scopes, and compile problems with their places", () => {
		const v = importSummaryView(
			summary({
				files: [
					{ path: "Stats.svelte", bytes: 2048 },
					{ path: "lib/util.ts", bytes: 100 }
				],
				requestedScopes: ["session:state", "characters"],
				compile: {
					errors: [
						{ file: "Stats.svelte", line: 3, column: 4, text: "Unexpected token" },
						{ file: "Stats.svelte", line: 0, column: 0, text: "imports fs, which is not allowed" }
					],
					warnings: [],
					artifactHash: null,
					fingerprint: "fp"
				}
			})
		)
		expect(v.files).toEqual([
			{ path: "Stats.svelte", size: "2.0 KB", entry: true },
			{ path: "lib/util.ts", size: "100 B", entry: false }
		])
		expect(v.totalSize).toBe("2.1 KB")
		expect(v.scopes).toEqual(["session:state", "characters"])
		expect(v.compile?.ok).toBe(false)
		expect(v.compile?.problems).toEqual([
			{ place: "Stats.svelte:3:5", text: "Unexpected token" },
			{ place: "Stats.svelte", text: "imports fs, which is not allowed" }
		])
		expect(v.canImport).toBe(true)
		expect(importSummaryView(summary({ runs: "carried-artifact", compile: null })).compile).toBeNull()
	})
})

describe("replies are taken only while this dialog waits for them", () => {
	const input = { text: "<p/>", filename: "a.svelte" }
	const previewRes = { summary: summary() }
	const importRes = {
		component: { id: "abc", label: "Stats", slug: "stats-2" } as Sockets.Components.Detail,
		compile: null,
		renamedFrom: "stats"
	}
	const phases: ImportPhase[] = [
		CHOOSE,
		{ kind: "ready", input, summary: summary() },
		{ kind: "importing", input, summary: summary() },
		{ kind: "refused", input, message: "no" }
	]

	it("a preview reply or error is ignored unless previewing", () => {
		for (const p of phases) {
			expect(onPreviewReply(p, previewRes)).toBeNull()
			expect(onPreviewError(p, { error: "x" })).toBeNull()
		}
		expect(onPreviewReply({ kind: "previewing", input }, previewRes)).toEqual({ kind: "ready", input, summary: previewRes.summary })
		expect(onPreviewError({ kind: "previewing", input }, { error: "bad file" })).toEqual({ kind: "refused", input, message: "bad file" })
	})

	it("an import reply or error is ignored unless importing", () => {
		const notImporting: ImportPhase[] = [CHOOSE, { kind: "previewing", input }, { kind: "ready", input, summary: summary() }]
		for (const p of notImporting) {
			expect(onImportReply(p, importRes)).toBeNull()
			expect(onImportError(p, { error: "x" })).toBeNull()
		}
		expect(onImportReply({ kind: "importing", input, summary: summary() }, importRes)).toEqual({
			id: "abc",
			label: "Stats",
			renamedFrom: "stats",
			compiled: true
		})
		expect(onImportError({ kind: "importing", input, summary: summary() }, {})).toEqual({
			kind: "refused",
			input,
			message: "The component could not be imported."
		})
	})
})

describe("the export's download name", () => {
	it("is always <slug>.component.json with a safe slug", () => {
		expect(safeShareFileName("stats.component.json")).toBe("stats.component.json")
		expect(safeShareFileName("../../etc/passwd")).toBe("etc_passwd.component.json")
		expect(safeShareFileName("My Stats!.component.json")).toBe("my_stats_.component.json")
		expect(safeShareFileName("", "tally")).toBe("tally.component.json")
		expect(safeShareFileName(null)).toBe("component.component.json")
		expect(safeShareFileName("x".repeat(200)).length).toBe(64 + ".component.json".length)
	})
})
