/**
 * The limits vocabulary's own invariants, and every declaration measured
 * against them.
 *
 * Four things earn a test here. Each is a failure that is SILENT — the app runs,
 * the types check, and the wrong answer arrives at a user as though a service
 * had given it:
 *
 *  1. **Absent means no known limit.** The rule the whole file is arranged
 *     around, and the one a `?? 0` re-introduces. Tested as behaviour rather
 *     than trusted as a comment, in both the reader and the declarations.
 *  2. **No cap is zero, negative or fractional, and every one cites a source.**
 *     The literal `0` is a compile error (held below with `@ts-expect-error`, so
 *     `svelte-check` fails if the overload ever stops rejecting it); everything
 *     else needs this walk, because `cap()` is deliberately total — the manifest
 *     is evaluated in the client bundle, where a throw would take a page down
 *     over an authoring mistake.
 *  3. **Every declared format is a format the table names**, of the kind it is
 *     filed under, and `prefers` never names something `accepts` does not.
 *     Preferring a format the backend will not take is a conversion into a
 *     guaranteed rejection.
 *  4. **A limits block never describes a kind the entry cannot carry.** Limits
 *     on `audio` for a text backend are limits nothing will ever read, which is
 *     the same undeliverable-declaration bug the capability conformance test
 *     exists for, one field over.
 */

import { describe, expect, test } from "vitest"
import { isTransformId, parseTransform } from "@serene-pub/sdk"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { formatByMime, MEDIA_KINDS } from "$lib/shared/media/formats"
import { ADAPTER_MANIFEST, adapterIo } from "./manifest"
import {
	cap,
	capsOf,
	inputLimits,
	offeredMimes,
	outputLimits,
	withinCap,
	mib,
	type AdapterIo,
	type Cap
} from "./io"

describe("absent means NO KNOWN LIMIT", () => {
	test("withinCap passes anything at all when nothing is declared", () => {
		// The single most important assertion in this file. A zero default here
		// would refuse every request in the app, and it would look like the
		// backend doing the refusing.
		expect(withinCap(0, undefined)).toBe(true)
		expect(withinCap(1, undefined)).toBe(true)
		expect(withinCap(30, undefined)).toBe(true)
		expect(withinCap(Number.MAX_SAFE_INTEGER, undefined)).toBe(true)
	})

	test("a declared cap is inclusive, and one over is out", () => {
		const c = cap(20, "a test")
		expect(withinCap(19, c)).toBe(true)
		expect(withinCap(20, c)).toBe(true)
		expect(withinCap(21, c)).toBe(false)
	})

	test("an entry with no io block reads as undefined, not as an empty one", () => {
		// `{}` and `undefined` behave the same through every reader here, but the
		// distinction is what lets a reader tell "nobody has looked this up" from
		// "somebody looked and there is no limit" — so nothing is invented to
		// stand in for the absent case.
		expect(adapterIo("no-such-connection-type")).toBeUndefined()
		expect(inputLimits(undefined, "image")).toBeUndefined()
		expect(outputLimits(undefined, "image")).toBeUndefined()
		expect(offeredMimes(undefined, "image")).toBeUndefined()
	})

	test("a kind with no declared formats is forwarded, not refused", () => {
		// `offeredMimes` returning undefined is what the engine reads as "send it
		// as it is". An empty array would read as "this backend accepts nothing",
		// which the conversion router refuses outright.
		const io: AdapterIo = { in: { image: { maxFiles: cap(3, "a test") } } }
		expect(offeredMimes(io, "image")).toBeUndefined()
	})

	test("a cap of zero is not declarable", () => {
		// The type-level half of rule 1. `cap(0, …)` resolves to the overload
		// whose return type IS the explanation, and a string is not assignable to
		// `Cap` — so this line fails to compile without the suppression below,
		// and `svelte-check` fails if the overload is ever removed.
		// @ts-expect-error a cap of 0 refuses everything; absence is the way to say "no limit"
		const zero: Cap = cap(0, "nobody publishes a zero")
		// At runtime it is still an object — `cap` is total on purpose — which is
		// exactly why the walk below has to exist as well.
		expect(zero.max).toBe(0)
	})
})

describe("every declared cap is a real, sourced number", () => {
	for (const [type, entry] of Object.entries(ADAPTER_MANIFEST)) {
		const caps = capsOf(entry.io)
		if (!caps.length) continue
		test(`${type}'s caps are positive integers with a source`, () => {
			for (const { path, cap: c } of caps) {
				expect(
					Number.isInteger(c.max),
					`${type}.io.${path} is ${c.max}, which is not a whole number of files or bytes.`
				).toBe(true)
				expect(
					c.max,
					`${type}.io.${path} is ${c.max}. A cap of zero or less refuses everything; omit the field to mean "no known limit".`
				).toBeGreaterThan(0)
				expect(
					c.source.trim(),
					`${type}.io.${path} has no source. Every number here has to be traceable to something a service published — a guessed cap refuses work the backend would have accepted.`
				).not.toBe("")
			}
		})
	}

	test("the walk actually found the declarations it is judging", () => {
		// A conformance walk over an empty list is a green check standing where a
		// guard used to be.
		const all = Object.values(ADAPTER_MANIFEST).flatMap((e) => capsOf(e.io))
		expect(all.length).toBeGreaterThan(0)
	})

	test("capsOf enumerates every place a cap can live", () => {
		// The list this walks is hand-written, so it is the thing that would
		// silently stop covering a field somebody adds. Every slot, filled at
		// once, and the paths compared as a set.
		const io: AdapterIo = {
			maxRequestBytes: cap(1, "t"),
			in: {
				image: { maxFiles: cap(2, "t"), maxBytesPerFile: cap(3, "t") }
			},
			out: { video: { maxFiles: cap(4, "t") } }
		}
		expect(
			capsOf(io)
				.map((c) => c.path)
				.sort()
		).toEqual([
			"in.image.maxBytesPerFile",
			"in.image.maxFiles",
			"maxRequestBytes",
			"out.video.maxFiles"
		])
	})
})

describe("declared formats name entries in the format table", () => {
	for (const [type, entry] of Object.entries(ADAPTER_MANIFEST)) {
		const io = entry.io
		if (!io?.in) continue
		test(`${type}'s accepted formats are known and of the right kind`, () => {
			for (const kind of MEDIA_KINDS) {
				const limits = io.in?.[kind]
				if (!limits) continue
				for (const mime of limits.accepts ?? []) {
					const format = formatByMime(mime)
					expect(
						format,
						`${type} accepts "${mime}" for ${kind}, which the format table does not name. Declarations name table entries — see $lib/shared/media/formats.`
					).toBeDefined()
					expect(
						format!.kind,
						`${type} lists "${mime}" under ${kind}, but the table files it as ${format!.kind}.`
					).toBe(kind)
				}
				for (const mime of limits.prefers ?? []) {
					expect(
						limits.accepts ?? [],
						`${type} prefers "${mime}" for ${kind} without accepting it. A preference is a conversion TARGET; converting into a format the backend refuses is worse than not converting at all.`
					).toContain(mime)
				}
			}
		})
	}
})

describe("a limits block only describes kinds the entry can carry", () => {
	/**
	 * Which media kinds an entry's declared transforms actually move, read off
	 * the transform ids rather than from a second list. `text` and `embedding`
	 * are `IoKind`s but not `MediaKind`s, so they drop out of the comparison on
	 * their own.
	 */
	const kindsOf = (type: string, side: "in" | "out"): Set<string> => {
		const supports = ADAPTER_MANIFEST[type]?.capabilities.supports ?? {}
		const out = new Set<string>()
		for (const id of Object.keys(supports)) {
			if (!isTransformId(id)) continue
			for (const kind of parseTransform(id)[side]) out.add(kind)
		}
		return out
	}

	for (const type of Object.keys(ADAPTER_MANIFEST)) {
		const io = ADAPTER_MANIFEST[type]!.io
		if (!io) continue
		test(`${type} declares limits only for kinds it moves`, () => {
			const problems: string[] = []
			for (const kind of MEDIA_KINDS) {
				if (io.in?.[kind] && !kindsOf(type, "in").has(kind))
					problems.push(
						`${type}: io.in.${kind} is declared, but no transform in its \`supports\` takes ${kind} in. Those limits can never be read.`
					)
				if (io.out?.[kind] && !kindsOf(type, "out").has(kind))
					problems.push(
						`${type}: io.out.${kind} is declared, but no transform in its \`supports\` emits ${kind}.`
					)
			}
			expect(problems).toEqual([])
		})
	}
})

describe("what the router is offered", () => {
	test("preferences come first, then the rest of accepts in declared order", () => {
		const io: AdapterIo = {
			in: {
				image: {
					accepts: [
						"image/jpeg",
						"image/png",
						"image/gif",
						"image/webp"
					],
					prefers: ["image/webp", "image/png"]
				}
			}
		}
		// The preferred two, then the accepted-but-unpreferred two in the order
		// they were declared — never a list with the preferences dropped, which
		// would refuse a format the backend takes.
		expect(offeredMimes(io, "image")).toEqual([
			"image/webp",
			"image/png",
			"image/jpeg",
			"image/gif"
		])
	})

	test("a preference the entry does not accept is dropped, not promoted", () => {
		// Belt to the conformance test's braces: that one fails the build, this
		// one keeps the runtime honest in the meantime rather than offering a
		// target the backend would reject.
		const io: AdapterIo = {
			in: {
				image: {
					accepts: ["image/png"],
					prefers: ["image/webp", "image/png"]
				}
			}
		}
		expect(offeredMimes(io, "image")).toEqual(["image/png"])
	})

	test("declared mimes are normalised on the way out", () => {
		// So the engine's "is the source already acceptable" comparison is
		// like-for-like without every caller remembering to normalise.
		const io: AdapterIo = { in: { image: { accepts: ["image/jpeg"] } } }
		expect(offeredMimes(io, "image")).toEqual(["image/jpeg"])
	})
})

describe("the one entry that declares anything", () => {
	// Pinned by value, so a well-meaning edit to a sourced number is a failed
	// test that names it rather than a silent change in what gets refused.
	const io = adapterIo(CONNECTION_TYPE.ANTHROPIC)

	test("Anthropic's image limits are the published ones", () => {
		const image = inputLimits(io, "image")
		expect(image?.maxFiles?.max).toBe(100)
		expect(image?.maxBytesPerFile?.max).toBe(mib(10))
		expect(io?.maxRequestBytes?.max).toBe(mib(32))
		expect(image?.accepts).toEqual([
			"image/jpeg",
			"image/png",
			"image/gif",
			"image/webp"
		])
	})

	test("WebP is the conversion target and GIF is last", () => {
		// GIF is accepted, so a GIF passes through — but nothing is ever
		// converted INTO it, because every encoder in this build writes a single
		// frame and GIF loses colour depth for nothing.
		const offered = offeredMimes(io, "image")!
		expect(offered[0]).toBe("image/webp")
		expect(offered[offered.length - 1]).toBe("image/gif")
	})

	test("PDFs are capped by size and not by count", () => {
		const doc = inputLimits(io, "document")
		expect(doc?.accepts).toEqual(["application/pdf"])
		expect(doc?.maxBytesPerFile?.max).toBe(mib(32))
		// The published PDF limit is 100 PAGES, which is not a file count and
		// cannot be checked without a document engine. Undeclared rather than
		// approximated.
		expect(doc?.maxFiles).toBeUndefined()
	})

	test("no output caps anywhere, and that is deliberate", () => {
		// Anthropic renders nothing, and no image backend publishes a count —
		// KoboldCPP's single image is REPORTED after the fact by A1111Adapter
		// rather than declared, because the same adapter serves AUTOMATIC1111,
		// which honours a batch.
		for (const [type, entry] of Object.entries(ADAPTER_MANIFEST))
			expect(
				entry.io?.out,
				`${type} declares an output cap`
			).toBeUndefined()
	})
})
