/**
 * The format vocabulary's own invariants, and the boundary that keeps it
 * usable in a browser.
 *
 * Two things are worth testing here. The table's SHAPE, because every lookup
 * below assumes mimes are unique and extensions are bare and lower case, and a
 * duplicate would silently shadow one entry with another. And the IMPORT
 * BOUNDARY, because "browser-safe" is a property nothing observes until a
 * picker imports this and a `node:module` specifier takes the client bundle
 * down — the same failure `adapters/importBoundary.test.ts` exists to catch,
 * enforced the same way, by reading what a human actually wrote.
 */
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { MEDIA_KINDS } from "@serene-pub/sdk"
import {
	MEDIA_FORMATS,
	canDecodeMime,
	canEncodeMime,
	extensionForMime,
	formatByMime,
	formatIsAnimatable,
	formatsForKind,
	normalizeMime
} from "./formats"

describe("the table's shape", () => {
	test("every mime is declared exactly once", () => {
		const seen = MEDIA_FORMATS.map((f) => f.mime)
		expect(seen).toEqual([...new Set(seen)])
	})

	test("every mime is already in its own normalised form", () => {
		// Otherwise a lookup of the canonical spelling would miss its own row.
		for (const f of MEDIA_FORMATS) {
			expect(normalizeMime(f.mime), f.mime).toBe(f.mime)
		}
	})

	test("extensions are bare, lower case and non-empty", () => {
		for (const f of MEDIA_FORMATS) {
			expect(f.extensions.length, f.mime).toBeGreaterThan(0)
			for (const ext of f.extensions) {
				expect(ext, f.mime).toBe(ext.toLowerCase())
				expect(ext, f.mime).not.toContain(".")
			}
		}
	})

	test("every kind in the table is one the SDK declares, and each has entries", () => {
		for (const f of MEDIA_FORMATS) {
			expect(MEDIA_KINDS, f.mime).toContain(f.kind)
		}
		// A kind with no formats would read as "this app cannot handle audio at
		// all", which is a different and wrong claim from "it converts none".
		for (const kind of MEDIA_KINDS) {
			expect(formatsForKind(kind).length, kind).toBeGreaterThan(0)
		}
	})

	test("anything this build cannot handle says why", () => {
		// A bare `decode: false` is indistinguishable from an oversight. The note
		// is what makes a refusal downstream actionable rather than "unsupported".
		for (const f of MEDIA_FORMATS) {
			if (f.decode && f.encode) continue
			expect(
				f.note,
				`${f.mime} has no note explaining what it cannot do`
			).toBeTruthy()
		}
	})
})

describe("the format fact and the build fact are separate", () => {
	test("a format can carry animation this build cannot write", () => {
		// The whole reason `animated` is not merged into `encode`: GIF and WebP
		// both allow frames, and this build writes exactly one of them.
		expect(formatIsAnimatable("image/gif")).toBe(true)
		expect(formatIsAnimatable("image/webp")).toBe(true)
		expect(canEncodeMime("image/gif")).toBe(true)
		expect(canEncodeMime("image/webp")).toBe(true)
		// …and a format that exists and animates while nothing here reads it.
		expect(formatIsAnimatable("image/avif")).toBe(true)
		expect(canDecodeMime("image/avif")).toBe(false)
	})

	test("a still format is not marked animatable", () => {
		expect(formatIsAnimatable("image/png")).toBe(false)
		expect(formatIsAnimatable("image/jpeg")).toBe(false)
		expect(formatIsAnimatable("application/pdf")).toBe(false)
	})

	test("HEIC is declared, undecodable, and keeps the upload's own advice", () => {
		// The refusal at the door (`sniff.ts`) and the refusal in the router have
		// to say the same thing; a user told two different stories about one file
		// concludes the second one is a bug.
		const heic = formatByMime("image/heic")
		expect(heic).toBeDefined()
		expect(heic!.decode).toBe(false)
		expect(heic!.encode).toBe(false)
		expect(heic!.note).toContain("Most Compatible")
		expect(formatByMime("image/heif")!.note).toBe(heic!.note)
	})

	test("audio and video are declared and convert nothing", () => {
		for (const kind of ["audio", "video"] as const) {
			for (const f of formatsForKind(kind)) {
				expect(f.decode, f.mime).toBe(false)
				expect(f.encode, f.mime).toBe(false)
				expect(f.note, f.mime).toContain("ffmpeg")
			}
		}
	})
})

describe("mime normalisation", () => {
	test("strips parameters and case", () => {
		expect(normalizeMime("TEXT/Plain; charset=utf-8")).toBe("text/plain")
		expect(normalizeMime("  image/PNG  ")).toBe("image/png")
	})

	test("resolves the spellings that actually arrive", () => {
		expect(normalizeMime("image/jpg")).toBe("image/jpeg")
		expect(formatByMime("image/jpg")?.mime).toBe("image/jpeg")
		expect(normalizeMime("audio/x-wav")).toBe("audio/wav")
	})

	test("an unknown or missing mime is undefined, not invented", () => {
		expect(normalizeMime(null)).toBe("")
		expect(formatByMime(null)).toBeUndefined()
		expect(formatByMime("image/nonesuch")).toBeUndefined()
		expect(extensionForMime("image/nonesuch")).toBeUndefined()
		expect(canDecodeMime("image/nonesuch")).toBe(false)
	})

	test("an extension is the format's first, so a derived file is named once", () => {
		expect(extensionForMime("image/jpeg")).toBe("jpg")
		expect(extensionForMime("image/webp")).toBe("webp")
		// PNG is declared before APNG precisely so `png` resolves this way.
		expect(formatByMime("image/apng")!.extensions).toContain("png")
		expect(extensionForMime("image/png")).toBe("png")
	})
})

describe("the browser boundary", () => {
	/**
	 * A picker renders from this table, so the module has to survive being in
	 * the client bundle. Scanned rather than trusted, because the failure is
	 * invisible in Node — every one of these specifiers resolves fine in the
	 * test run that would be "proving" the module is safe.
	 */
	const SOURCE = readFileSync(
		join(
			resolve(__dirname, "../../../.."),
			"src/lib/shared/media/formats.ts"
		),
		"utf8"
	)

	const specifiers = () => {
		const out: string[] = []
		const re =
			/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"()]*?\sfrom\s+)?["']([^"']+)["']/g
		let m: RegExpExecArray | null
		while ((m = re.exec(SOURCE))) out.push(m[1])
		const dynamic = /\bimport\s*\(\s*["']([^"']+)["']/g
		while ((m = dynamic.exec(SOURCE))) out.push(m[1])
		return out
	}

	test("it imports nothing a browser cannot have", () => {
		const FORBIDDEN =
			/^(node:|\$lib\/server\/|\.\.\/\.\.\/server\/|@jimp\/|@jsquash\/|pngjs|omggif|png-chunks|fs$|path$)/
		const violations = specifiers().filter((s) => FORBIDDEN.test(s))
		expect(
			violations,
			"formats.ts is imported by client code. Keep the codecs behind $lib/server/media/convert and the vocabulary here."
		).toEqual([])
	})

	test("the scan is actually reading the module", () => {
		// A boundary test matching nothing is a green check standing where a
		// guard used to be.
		expect(specifiers()).toContain("@serene-pub/sdk")
	})
})
