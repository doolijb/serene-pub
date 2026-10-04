/**
 * The faces the page hands core's conversation box (C7): what the box takes
 * goes as it is, an inline image it refuses (an envoy's SVG) is drawn once
 * to a WebP and re-projects when it lands, anything else is no face.
 * happy-dom has no canvas, so the drawing is stood in for; the rules the box
 * judges by are the SDK's own.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync } from "svelte"
import { receiverAttribute } from "@serene-pub/sdk"
import {
	createRemoteFaces,
	rasterizeFace,
	PNG_FALLBACK_SIDE,
	remoteFaceKind,
	REMOTE_FACE_DRAWING,
	REMOTE_FACE_PX
} from "./remoteFace"

const PAGE = resolve(__dirname, "../../../../routes/sessions/[id]/+page.svelte")
/** Where the core message skins size their avatar box (`--sp-av`, `--sp-portrait`). */
const SKINS = [
	resolve(__dirname, "../../../shared/widgets/corePresets.ts"),
	resolve(__dirname, "../../sessionLayout/messageLayouts.css")
]

/** Core's own envoys' shape: an SVG, inline, percent-encoded (`GUIDE_MASCOT_IMAGE`). */
const SVG_UTF8 =
	"data:image/svg+xml;utf8," +
	encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>')
const SVG_BASE64 = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4="
const PNG = "data:image/png;base64,iVBORw0KGgo="
const DRAWN = "data:image/png;base64,ZHJhd24="

/** Lets a stubbed drawing settle. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe("which faces core's box is given", () => {
	test.each([
		["/media/8f14e45f-ceea-467a-9b3c-8c1d2a3f4e5b?v=thumb&r=3", "pass"],
		["/media/12?v=thumb", "pass"],
		["/session-assets/41", "pass"],
		["https://cdn.example.com/face.png", "pass"],
		[PNG, "pass"],
		["data:image/webp;base64,UklGRg==", "pass"],
		[SVG_UTF8, "rasterize"],
		[SVG_BASE64, "rasterize"],
		// Not base64: the box refuses it, the page can still draw it.
		["data:image/png," + encodeURIComponent("\x89PNG"), "rasterize"],
		["http://example.com/face.png", "drop"],
		["javascript:alert(1)", "drop"],
		["/images/default-avatar.png", "drop"],
		["/media/../api/users", "drop"],
		["data:text/html,<b>hi</b>", "drop"],
		["", "drop"],
		[null, "drop"],
		[undefined, "drop"]
	] as const)("%s → %s", (url, kind) => {
		expect(remoteFaceKind(url)).toBe(kind)
	})

	test("what passes is what core's box writes, and nothing it refuses passes", () => {
		const faces = createRemoteFaces({ rasterize: async () => DRAWN })
		expect(faces.face("  /media/12?v=thumb ")).toBe("/media/12?v=thumb")
		for (const url of ["/session-assets/41", "https://cdn.example.com/face.png", PNG]) {
			expect(faces.face(url)).toBe(url)
			expect(receiverAttribute("img", "src", url, "core")).toEqual({ value: url })
		}
		// The SVG itself never reaches the box; the box would refuse it.
		expect("refused" in receiverAttribute("img", "src", SVG_UTF8, "core")).toBe(true)
	})
})

describe("a face drawn in the page", () => {
	test("is null while it is drawn, drawn once per source, then the drawing — and `landed` moves", async () => {
		const rasterize = vi.fn(async (_src: string, _drawing: unknown) => DRAWN)
		const faces = createRemoteFaces({ rasterize })
		expect(faces.landed).toBe(0)
		expect(faces.face(SVG_UTF8)).toBeNull()
		expect(faces.face(SVG_UTF8)).toBeNull()
		await settle()
		expect(rasterize).toHaveBeenCalledTimes(1)
		expect(rasterize).toHaveBeenCalledWith(SVG_UTF8, REMOTE_FACE_DRAWING)
		expect(faces.landed).toBe(1)
		expect(faces.face(SVG_UTF8)).toBe(DRAWN)
		// Cached by source: asked again, never drawn again.
		expect(faces.face(` ${SVG_UTF8} `)).toBe(DRAWN)
		await settle()
		expect(rasterize).toHaveBeenCalledTimes(1)
		// Another source is its own drawing.
		expect(faces.face(SVG_BASE64)).toBeNull()
		await settle()
		expect(rasterize).toHaveBeenCalledTimes(2)
		expect(faces.landed).toBe(2)
	})

	test("what the box takes, or refuses outright, is never drawn", async () => {
		const rasterize = vi.fn(async () => DRAWN)
		const faces = createRemoteFaces({ rasterize })
		expect(faces.face("http://example.com/face.png")).toBeNull()
		expect(faces.face("/media/12?v=thumb")).toBe("/media/12?v=thumb")
		expect(faces.face(null)).toBeNull()
		await settle()
		expect(rasterize).not.toHaveBeenCalled()
		expect(faces.landed).toBe(0)
	})

	test("a drawing that fails — or gives what the box would refuse — settles as no face, and is not retried", async () => {
		const fails = vi.fn(async () => {
			throw new Error("no canvas")
		})
		const faces = createRemoteFaces({ rasterize: fails })
		expect(faces.face(SVG_UTF8)).toBeNull()
		await settle()
		expect(faces.landed).toBe(1)
		expect(faces.face(SVG_UTF8)).toBeNull()
		await settle()
		expect(fails).toHaveBeenCalledTimes(1)

		const throwsNow = createRemoteFaces({
			rasterize: () => {
				throw new Error("synchronously")
			}
		})
		expect(throwsNow.face(SVG_UTF8)).toBeNull()
		await settle()
		expect(throwsNow.landed).toBe(1)

		const svgAgain = createRemoteFaces({ rasterize: async (src) => src })
		expect(svgAgain.face(SVG_UTF8)).toBeNull()
		await settle()
		expect(svgAgain.face(SVG_UTF8)).toBeNull()
		expect(svgAgain.landed).toBe(1)
	})

	test("re-projects what read it: a derived that caches by `landed` rebuilds when the face lands", async () => {
		let release!: (png: string) => void
		const faces = createRemoteFaces({ rasterize: () => new Promise<string>((r) => (release = r)) })
		const cache = new Map<string, { key: string; face: string | null }>()
		let builds = 0
		let read!: () => string | null
		const stop = $effect.root(() => {
			// The dossier's shape: a line rebuilt only when its key moves.
			const projected = $derived.by(() => {
				const key = `speaker|${faces.landed}`
				const held = cache.get("line")
				if (held?.key === key) return held.face
				builds++
				const face = faces.face(SVG_UTF8)
				cache.set("line", { key, face })
				return face
			})
			read = () => projected
		})
		try {
			expect(read()).toBeNull()
			expect(builds).toBe(1)
			await settle()
			flushSync()
			expect(read()).toBeNull()
			release(DRAWN)
			await settle()
			flushSync()
			expect(read()).toBe(DRAWN)
			expect(builds).toBe(2)
		} finally {
			stop()
		}
	})
})

describe("how a refused face is drawn", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	test("every drawing is asked for as a WebP at twice the widest avatar box", async () => {
		const rasterize = vi.fn(async (_src: string, _drawing: unknown) => DRAWN)
		const faces = createRemoteFaces({ rasterize })
		faces.face(SVG_UTF8)
		faces.face(SVG_BASE64)
		await settle()
		expect(rasterize.mock.calls.map(([, drawing]) => drawing)).toEqual([
			{ side: 304, type: "image/webp", quality: 0.8 },
			{ side: 304, type: "image/webp", quality: 0.8 }
		])
		expect(REMOTE_FACE_DRAWING.side).toBe(REMOTE_FACE_PX * 2)
	})

	test("the drawing covers the widest avatar box a core message skin draws", () => {
		// Every `--sp-av` / `--sp-portrait` a skin sets, at its largest (a
		// `clamp()`'s last term); `var(...)` and `0` add nothing.
		const rems = SKINS.flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(/--sp-(?:av|portrait):\s*([^;]+);/g)].flatMap(([, value]) =>
				[...value.matchAll(/(\d+(?:\.\d+)?)rem/g)].map(([, n]) => Number(n))
			)
		)
		expect(rems.length).toBeGreaterThan(3)
		// Matched: never smaller than a box draws it (soft), nor larger (paid per line).
		expect(REMOTE_FACE_PX).toBe(Math.max(...rems) * 16)
	})

	test("the page's own drawing paints that side and encodes as it is told; a browser that cannot encode it gets a smaller PNG", async () => {
		/** A browser with a WebP encoder answers WebP; turn `webp` off and it answers PNG, as Safari does. */
		let webp = true
		const toDataURL = vi.fn((type?: string, _quality?: number) =>
			type === "image/webp" && webp ? "data:image/webp;base64,d2VicA==" : "data:image/png;base64,ZmFsbGJhY2s="
		)
		const drawImage = vi.fn()
		const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL }
		const createElement = document.createElement.bind(document)
		vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
			tag === "canvas" ? canvas : createElement(tag)) as typeof document.createElement)
		/** An image as decoded: an SVG with only a `viewBox` has no size of its own. */
		let natural = { width: 0, height: 0 }
		vi.stubGlobal(
			"Image",
			class {
				src = ""
				get naturalWidth() {
					return natural.width
				}
				get naturalHeight() {
					return natural.height
				}
				decode() {
					return Promise.resolve()
				}
			}
		)
		// Square, at the side asked for, encoded as asked.
		const drawn = await rasterizeFace(SVG_UTF8, REMOTE_FACE_DRAWING)
		expect([canvas.width, canvas.height]).toEqual([304, 304])
		expect(toDataURL).toHaveBeenCalledTimes(1)
		expect(toDataURL).toHaveBeenLastCalledWith("image/webp", 0.8)
		expect(receiverAttribute("img", "src", drawn, "core")).toEqual({ value: drawn })
		// No WebP encoder: drawn again as a PNG, never larger than the old 128px one.
		webp = false
		const fallback = await rasterizeFace(SVG_UTF8, REMOTE_FACE_DRAWING)
		expect([canvas.width, canvas.height]).toEqual([PNG_FALLBACK_SIDE, PNG_FALLBACK_SIDE])
		expect(toDataURL).toHaveBeenLastCalledWith("image/png", 0.8)
		expect(receiverAttribute("img", "src", fallback, "core")).toEqual({ value: fallback })
		// A wide picture: its shorter side is the side asked for (below the fallback's, kept).
		natural = { width: 300, height: 150 }
		await rasterizeFace(PNG, { side: 80, type: "image/webp", quality: 0.5 })
		expect([canvas.width, canvas.height]).toEqual([160, 80])
		expect(toDataURL).toHaveBeenLastCalledWith("image/png", 0.5)
	})
})

describe("the session page", () => {
	test("hands the conversation only faces its box takes: every dossier face and sprite, keyed on `landed`", () => {
		const src = readFileSync(PAGE, "utf8")
		expect(src).toMatch(
			/import\s*\{[^}]*\bcreateRemoteFaces\b[^}]*\}\s*from\s*"\$lib\/client\/components\/sessionPage\/remoteFace"/
		)
		const start = src.indexOf("let conversationDossier")
		const end = src.indexOf("setContext(SESSION_DOSSIER_KEY", start)
		expect(start).toBeGreaterThan(-1)
		expect(end).toBeGreaterThan(start)
		const builder = src.slice(start, end)
		expect(builder).toMatch(/\bface:\s*remoteFaces\.face\(\s*avatarSrc\(/)
		expect(builder).toMatch(/\bsprite:\s*remoteFaces\.face\(\s*spriteSrc\(/)
		// Every face-shaped key of the dossier goes through it — none raw.
		expect(builder).not.toMatch(/\b(face|sprite):\s*(avatarSrc|spriteSrc)\(/)
		// The line cache's key moves when a drawing lands.
		expect(builder).toMatch(/const castKey = \[[^\]]*\bremoteFaces\.landed\b/)
	})

	test("the line cache's key moves when the view's envoys do: an envoy line never keeps a stale name or face", () => {
		const src = readFileSync(PAGE, "utf8")
		const start = src.indexOf("const castKey = [")
		const end = src.indexOf('].join("|")', start)
		expect(start).toBeGreaterThan(-1)
		expect(end).toBeGreaterThan(start)
		const castKey = src.slice(start, end)
		// The same list the lines' speakers are resolved from (`getMessageCharacter`).
		expect(src).toMatch(/messageSpeaker\(\s*session \? \{ \.\.\.session, envoys: sessionFrames\?\.envoys \}/)
		expect(castKey).toMatch(/\.\.\.\(sessionFrames\?\.envoys \?\? \[\]\)\.map\(/)
		for (const field of ["slug", "name", "image"]) expect(castKey).toMatch(new RegExp(`\\be\\.${field}\\b`))
	})
})
