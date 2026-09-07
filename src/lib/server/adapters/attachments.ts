/**
 * The enforcement half of multi-file support: counts, formats and bytes, checked
 * once for every adapter.
 *
 * `$lib/shared/connectionAdapters/io` is what an entry DECLARES. This is what
 * happens to a request in the light of it, and it lives here — reachable from
 * both base classes, carrying the codecs — rather than in the shared module,
 * which a browser imports.
 *
 * ## ⚠ CONVERT FIRST, THEN CHECK BYTES
 *
 * The ordering is load-bearing and it is the thing to get right, because it is
 * wrong in both directions if reversed:
 *
 *   - Checking BEFORE conversion refuses requests that would have fit. A 12MB
 *     PNG re-encoded to WebP is comfortably under a 10MB cap; a size check on
 *     the source rejects it with an authoritative-sounding message about a limit
 *     the request was never going to hit.
 *   - Checking ONLY before conversion accepts requests that will not fit. A
 *     conversion can GROW a file — a lossy JPEG re-encoded as lossless PNG
 *     routinely doubles — so the source passing says nothing about the payload.
 *
 * The check therefore runs on the bytes ACTUALLY BEING SENT, which means after
 * negotiation, for every file, every time. `attachments.test.ts` holds it with a
 * case where the conversion is what moves the file from one side of the cap to
 * the other, asserting both the source is over and the result is under.
 *
 * ## ⚠ EVERY byte check is on the WIRE, not on the file
 *
 * Both byte caps — per file and per request — are measured on what the transport
 * actually sends, which the caller names with `transport`. On a `"raw"`
 * transport that is the file itself and nothing changes; on a `"base64"` one
 * every file is four characters per three bytes, so a 9MB image is an 11.9MB
 * payload and a 24MB set of files is a 32MB request.
 *
 * This is not a guess about how services word things. Anthropic's vision
 * documentation states the per-image limit as "10 MB (base64-encoded)" in as
 * many words, and the request limit is about an HTTP body that is base64 all the
 * way through. So a 10MB cap on a base64 transport is an effective ceiling of
 * 7.5MB on the FILE, and checking the file against it would accept, encode and
 * send something the service then rejects — with an error the user cannot act
 * on, about a request this app had already declared fine.
 *
 * ⚠ Declare the number AS PUBLISHED and let `transport` do the arithmetic. If a
 * service ever publishes a per-file limit about the file itself while inlining
 * base64, the fix is to declare three quarters of it with a `source` that says
 * why — not a second knob here. One rule, applied everywhere, is the only
 * version of this that survives the fourth adapter.
 *
 * ## Order is preserved end to end
 *
 * `files[i]` is `inputs[i]`. Always, including when one file converts and its
 * neighbour passes through, and including when the conversions differ wildly in
 * cost. `attachments` is a list precisely because interleaving is ordered — "the
 * page, then the photo, then the question" — and a reordering bug here does not
 * present as a plumbing fault: it presents as the MODEL apparently misreading
 * the images, which is the most expensive failure mode available in this area.
 *
 * That is why the conversion below is one `Promise.all` over `inputs.map(...)`
 * and nothing else. `Promise.all` resolves to an array indexed by position in
 * the array it was handed, NOT by completion order — the same construction
 * `convertMediaBatch` uses and for the same reason. There is deliberately no
 * grouping by kind, no filtering of the convertible ones, and no concurrent loop
 * pushing into a shared array: each of those reorders, and each of them reorders
 * only when the conversions differ in cost, i.e. not in a test with three
 * identical fixtures.
 *
 * `convertMediaBatch` itself is not used because the accepted list is per KIND —
 * a request carrying a photo and a PDF negotiates each against a different list
 * — and regrouping into per-kind batches to use it would be the reshuffle this
 * paragraph exists to forbid.
 *
 * ## A refusal is a VALUE, and over-supply is never a quiet slice
 *
 * Every entry point returns a plan, so "this cannot be sent" arrives in the same
 * channel as "here is the payload" and a caller cannot forget to look — the rule
 * the conversion router already follows.
 *
 * And thirty images handed to a backend that takes twenty is REFUSED, naming
 * both numbers and where the number came from. Never sliced. A quiet truncation
 * looks exactly like the model ignoring an instruction: the request succeeds, the
 * answer is subtly wrong, and there is nothing anywhere to suggest that ten of
 * the attachments were dropped by this app.
 *
 * The one place a count is clamped rather than refused is OUTPUT — see
 * `capOutputCount`, which reports the clamp through the `applied`/`ignored`
 * channel image generation already has.
 */

import {
	convertMediaTo,
	type ConversionRefused,
	type EncodeOptions
} from "$lib/server/media/convert"
import {
	formatByMime,
	normalizeMime,
	type MediaKind
} from "$lib/shared/media/formats"
import {
	inputLimits,
	offeredMimes,
	outputLimits,
	withinCap,
	type AdapterIo,
	type Cap
} from "$lib/shared/connectionAdapters/io"

// ── In and out ──────────────────────────────────────────────────────────────

/**
 * One file on its way to a backend, with its bytes in hand.
 *
 * BYTES, not a `MediaRef`, and that is the seam: a ref names stored media and
 * loading it needs the media module, which needs the database. Taking the bytes
 * keeps this — and therefore both base classes — free of that graph, and leaves
 * the loading with the caller that already had to fetch them.
 *
 * There is no `kind` field. The kind is READ FROM THE FORMAT TABLE via the mime,
 * so there is one answer to "what is this" rather than a declared kind that can
 * disagree with the bytes' own mime.
 */
export interface AttachmentInput {
	bytes: Buffer | Uint8Array
	/** What these bytes are. Aliases and `; charset=` parameters are normalised. */
	mime: string
	/** Display only, so a refusal can name the file a person recognises. */
	filename?: string
}

/** One file as it will actually be sent. */
export interface PreparedAttachment {
	kind: MediaKind
	/** What these bytes ARE — the negotiated answer, never what was asked for. */
	mime: string
	/** The extension a file of this format is named with, from the format table. */
	ext: string
	bytes: Buffer
	/** True when these bytes were re-encoded; false for a straight forward. */
	converted: boolean
	/** Known only for a conversion — a forward never decodes, so never measures. */
	width: number | null
	height: number | null
	filename?: string
}

/**
 * Why a request cannot be sent as it stands. Each code is a distinct decision
 * with a distinct fix, not a severity:
 */
export type AttachmentRefusalCode =
	/** The mime is not in the format vocabulary at all, so nothing can be said
	 *  about it — including which kind's limits would apply. */
	| "unknown-format"
	/** More files of one kind than the entry says the backend takes. */
	| "too-many-files"
	/** One file, after negotiation, is over the per-file cap. */
	| "file-too-large"
	/** The files together, after negotiation, are over the request cap. */
	| "request-too-large"
	/** The backend's accepted formats cannot be reached from this file's. */
	| "unconvertible"

export interface AttachmentsRefused {
	ok: false
	code: AttachmentRefusalCode
	/** Which input this is about, indexed into the list handed in. Null for a
	 *  refusal about the request as a whole. */
	index: number | null
	/** What went wrong and what the limit was, in words a user can act on —
	 *  including the cap's own `source`, so the claim is checkable. */
	reason: string
	/** The router's own refusal, when a conversion is what stopped it. Carried
	 *  rather than flattened: its `code` tells a broken file from a missing
	 *  converter, and callers already act differently on those. */
	conversion?: ConversionRefused
}

export interface AttachmentsPrepared {
	ok: true
	/** `files[i]` is `inputs[i]`. */
	files: PreparedAttachment[]
	/** What the request WEIGHS: every file as its `transport` carries it, plus
	 *  whatever overhead the caller declared — the number the request cap was
	 *  checked against. Equal to the sum of `files[].bytes.length` plus the
	 *  overhead on a raw transport, and about a third larger on a base64 one. */
	bytes: number
}

export type AttachmentPlan = AttachmentsPrepared | AttachmentsRefused

/**
 * How a file's bytes reach the backend.
 *
 * `"raw"` — a multipart upload, a body that is the file: one byte on the wire
 * per byte of file, which is what the default assumes.
 *
 * `"base64"` — inlined into a JSON body, which is what nearly every hosted
 * multimodal API does (Anthropic's `source.data`, OpenAI's data URLs, Gemini's
 * `inlineData`). Four characters per three bytes, so a 24MB payload of files is
 * a 32MB request, and the service's published request cap is about the REQUEST.
 *
 * Named rather than passed as a number because the arithmetic is a property of
 * the wire format, not a quantity a caller measures — and because the next
 * adapter to inline base64 should be able to say so instead of re-deriving 4/3.
 */
export type AttachmentTransport = "raw" | "base64"

export interface PrepareOptions {
	/**
	 * Bytes the request carries besides the files — the serialised prompt, the
	 * JSON envelope — for the whole-request cap to include.
	 *
	 * The caller's to supply because only the caller knows its own payload. Zero
	 * by default, which under-counts rather than over-counts: an unstated
	 * overhead can let a borderline request through to the service, where a
	 * guessed one would refuse a request that fits.
	 *
	 * ⚠ Not the place for a transport's own inflation. That depends on the
	 * NEGOTIATED byte counts, which the caller does not know until this function
	 * has run — see `transport`, which is how it is declared instead.
	 */
	overheadBytes?: number
	/**
	 * How the files travel. Defaults to `"raw"`, which is the identity.
	 *
	 * ⚠ Applied to BOTH byte caps — per file and per request — because a
	 * service's published numbers are about what it receives. Anthropic's are
	 * explicit: "10 MB (base64-encoded)" per image. See the header; the one place
	 * this must not silently differ is between the two caps.
	 */
	transport?: AttachmentTransport
	/** Passed to the encoder when a conversion actually happens. */
	encode?: EncodeOptions
}

// ── Preparing ───────────────────────────────────────────────────────────────

const refuse = (
	code: AttachmentRefusalCode,
	index: number | null,
	reason: string,
	conversion?: ConversionRefused
): AttachmentsRefused => ({ ok: false, code, index, reason, conversion })

/** How a file is named in a refusal: what the user called it, or its position. */
const nameOf = (input: AttachmentInput, index: number): string =>
	input.filename
		? `${input.filename} (attachment ${index + 1})`
		: `attachment ${index + 1}`

/** `100 (Anthropic's vision docs …)` — a limit and its receipt, in one phrase. */
const citing = (limit: Cap): string => `${limit.max} (${limit.source})`

/**
 * What one file of `n` bytes weighs on the wire.
 *
 * Base64 is 4 characters per 3 bytes, padded up to a multiple of 4 — exact, not
 * an estimate, and no JSON escaping to add on top because the base64 alphabet
 * contains nothing a JSON string escapes. The surrounding `{"type":"image",…}`
 * scaffolding is the CALLER's envelope (`overheadBytes`), where it belongs:
 * only the caller knows how its own blocks are spelled.
 */
const wireBytes = (
	n: number,
	transport: AttachmentTransport = "raw"
): number => (transport === "base64" ? 4 * Math.ceil(n / 3) : n)

interface Classified {
	input: AttachmentInput
	index: number
	kind: MediaKind
	/** Normalised, so every comparison below is like-for-like. */
	mime: string
	ext: string
}

/**
 * Negotiate formats, then check sizes, then hand back a payload in the order it
 * arrived — or say why not.
 *
 * `io` is passed IN rather than looked up here, so the whole rule is testable
 * against a literal declaration. The base classes are the ones that resolve it
 * from the connection's type.
 */
export async function prepareAttachments(
	io: AdapterIo | undefined,
	inputs: readonly AttachmentInput[],
	opts: PrepareOptions = {}
): Promise<AttachmentPlan> {
	// 1. What each file is. The format table is the only classifier — a mime it
	//    does not know cannot be filed under a kind, so no limit applies to it
	//    and forwarding it would be sending an unknown thing on the strength of
	//    nothing.
	const classified: Classified[] = []
	for (const [index, input] of inputs.entries()) {
		const mime = normalizeMime(input.mime)
		const format = formatByMime(mime)
		if (!format)
			return refuse(
				"unknown-format",
				index,
				`${nameOf(input, index)} is ${mime || "(no mime)"}, which is not a format this build has a vocabulary entry for. ` +
					`Nothing can be said about how many of these a backend takes, or how big one may be, so it is not sent.`
			)
		classified.push({
			input,
			index,
			kind: format.kind,
			mime,
			ext: format.extensions[0]!
		})
	}

	// 2. Counts, per kind, BEFORE any conversion — a count does not depend on the
	//    bytes, and refusing here avoids paying for N conversions that are about
	//    to be thrown away. Insertion-ordered, so a request breaking two caps
	//    reports the kind that appears first rather than whichever the runtime
	//    happened to enumerate.
	const counts = new Map<MediaKind, number>()
	for (const item of classified)
		counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
	for (const [kind, count] of counts) {
		const limit = inputLimits(io, kind)?.maxFiles
		if (withinCap(count, limit)) continue
		return refuse(
			"too-many-files",
			null,
			`This request carries ${count} ${kind} files and this backend takes at most ${citing(limit!)}. ` +
				`Remove ${count - limit!.max} of them and send again. The extras are not dropped for you: a request that ` +
				`quietly lost its last few attachments is indistinguishable from a model ignoring them.`
		)
	}

	// 3. Negotiate formats. ONE map over the ORIGINAL list — see the header on
	//    why this is not grouped, filtered or batched per kind.
	const results = await Promise.all(
		classified.map(
			async (item): Promise<PreparedAttachment | AttachmentsRefused> => {
				const offered = offeredMimes(io, item.kind)

				// Nothing declared, or already acceptable: forward the bytes
				// untouched. The copy is so a caller trimming or padding the
				// payload cannot reach back into the buffer it handed in, which
				// is the same guarantee the router's own passthrough gives.
				//
				// ⚠ The acceptable case is short-circuited HERE rather than left
				// to `convertMediaTo`, and the reason is no longer that the
				// router would refuse it. It used to: the router checked the
				// source was DECODABLE before checking whether a conversion was
				// needed at all, so an undecodable-but-acceptable file (a PDF,
				// `decode: false` in the format table) came back `no-converter`.
				// That ordering bug is fixed — the router now asks the
				// passthrough question first and would forward this itself.
				//
				// The short-circuit stays for two reasons that survive the fix.
				// It handles `offered === undefined` ("nothing declared"), which
				// the router cannot express — it takes a target list, and an
				// absent list is not an empty one. And it avoids a router call
				// on the common path, where the answer is already known here.
				// Do not delete it as redundant; it is load-bearing for the
				// undeclared case.
				if (!offered || offered.includes(item.mime))
					return {
						kind: item.kind,
						mime: item.mime,
						ext: item.ext,
						bytes: Buffer.from(item.input.bytes),
						converted: false,
						width: null,
						height: null,
						...(item.input.filename
							? { filename: item.input.filename }
							: {})
					}

				const converted = await convertMediaTo(
					{ bytes: item.input.bytes, mime: item.mime },
					offered,
					opts.encode
				)
				if (!converted.ok)
					return refuse(
						"unconvertible",
						item.index,
						`${nameOf(item.input, item.index)} cannot be sent: ${converted.reason}`,
						converted
					)
				return {
					kind: item.kind,
					mime: converted.mime,
					ext: converted.ext,
					bytes: converted.bytes,
					converted: !converted.passthrough,
					width: converted.width,
					height: converted.height,
					...(item.input.filename
						? { filename: item.input.filename }
						: {})
				}
			}
		)
	)

	// The first failure in INPUT order, so which file is reported does not depend
	// on which conversion finished first.
	const failed = results.find((r): r is AttachmentsRefused => "ok" in r)
	if (failed) return failed
	const files = results as PreparedAttachment[]

	// 4. ⚠ NOW the bytes — on what is being sent, in both senses: after
	//    negotiation, because a conversion can shrink a file under a cap or grow
	//    it past one, and as the TRANSPORT carries it, because the published
	//    per-file numbers are about what the service receives (Anthropic:
	//    "10 MB (base64-encoded)"). See the header.
	for (const [index, file] of files.entries()) {
		const limit = inputLimits(io, file.kind)?.maxBytesPerFile
		const sent = wireBytes(file.bytes.length, opts.transport)
		if (withinCap(sent, limit)) continue
		const item = classified[index]!
		const shape = file.converted
			? `is ${file.bytes.length} bytes as ${file.mime} (converted from ${item.mime})`
			: `is ${file.bytes.length} bytes`
		// The encoded number is what the limit is measured on, so a refusal that
		// named only the file's size would look like arithmetic nobody can check
		// — "9437184 is over 10485760" reads as a bug in this app.
		const encoded =
			sent > file.bytes.length
				? ` — ${sent} bytes once base64-encoded, which is what this backend's limit is measured on —`
				: ""
		return refuse(
			"file-too-large",
			index,
			`${nameOf(item.input, index)} ${shape}${encoded ? encoded : ","} and this backend takes at most ` +
				`${citing(limit!)} bytes per ${file.kind}.`
		)
	}

	// 5. And the request as a whole, on the WIRE — every file as the transport
	//    carries it, plus the caller's own envelope. A base64 API's published
	//    request cap is about the encoded body, so measuring the files raw here
	//    would accept a payload a third over it and let the service refuse a
	//    request this app had already declared fine.
	const fileBytes = files.reduce((sum, f) => sum + f.bytes.length, 0)
	const wire = files.reduce(
		(sum, f) => sum + wireBytes(f.bytes.length, opts.transport),
		0
	)
	const bytes = wire + (opts.overheadBytes ?? 0)
	if (!withinCap(bytes, io?.maxRequestBytes))
		return refuse(
			"request-too-large",
			null,
			`These ${files.length} file${files.length === 1 ? "" : "s"} come to ${bytes} bytes` +
				// The inflation is named, because "32MB of files is over a 32MB
				// limit" reads as a bug in this app rather than as arithmetic.
				(wire > fileBytes
					? ` once encoded for this backend (${fileBytes} bytes as files, inflated by base64)`
					: "") +
				` and this backend takes at most ${citing(io!.maxRequestBytes!)} bytes per request. ` +
				`Each file is within its own limit; together they are not.`
		)

	return { ok: true, files, bytes }
}

// ── Output counts ───────────────────────────────────────────────────────────

/**
 * The half of `Translation` an output cap needs.
 *
 * Structural rather than the concrete class, so this module and
 * `BaseImageAdapter` — where `Translation` lives — do not have to import each
 * other.
 */
export interface IgnoreReporter {
	ignore(key: string): void
}

/**
 * Clamp a REQUESTED output count to what the entry declares, and say so.
 *
 * The one place a count is reduced rather than refused, and it is reduced on the
 * way OUT rather than on the way in: asking a backend for thirty images when the
 * entry says it returns at most four is a request that cannot be honoured, and
 * the useful behaviour is to ask for four and report that the count did not
 * survive — which is exactly what `applied`/`ignored` already exists to say.
 * KoboldCPP returning one image whatever `n_iter` says is reported through the
 * same channel today; this is the same fact known in advance instead of
 * discovered afterwards, so it travels the same way rather than growing a second
 * vocabulary beside it.
 *
 * ⚠ Never used to trim what came BACK. A returned list is what the backend
 * actually produced, and dropping items from it would throw away work already
 * paid for and misreport the run.
 *
 * Absent cap: the request passes through untouched and nothing is reported. That
 * is the whole reason `withinCap` is the comparison here too.
 */
export function capOutputCount(
	io: AdapterIo | undefined,
	kind: MediaKind,
	requested: number,
	/** The request key to report as ignored — `"batch"`, for image generation. */
	key: string,
	report: IgnoreReporter
): number {
	const limit = outputLimits(io, kind)?.maxFiles
	if (withinCap(requested, limit)) return requested
	report.ignore(key)
	return limit!.max
}
