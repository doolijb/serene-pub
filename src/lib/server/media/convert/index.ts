/**
 * The KIND-FOR-KIND conversion router: image → image, document → document.
 *
 * **Not the pipeline's job.** Turning a prompt into a picture is a CROSS-kind
 * generation, and it belongs to an image provider. This module does the other
 * thing entirely — the receiving end takes PNG and JPEG, the file in hand is a
 * GIF, so re-encode it — and the two must not be confused, because the failure
 * modes are opposite. A generation that cannot run is a disabled button; a
 * conversion that cannot run and pretends otherwise is a silently degraded
 * file, which nothing downstream can detect.
 *
 * ## Three rules, and each one is a bug this shape prevents
 *
 * **1. A refusal is a VALUE, never a throw and never a passthrough.** Every
 * entry point returns `ConversionResult`, so "we cannot do this" arrives in the
 * same channel as "here are your bytes" and a caller cannot forget to look. The
 * alternative — returning the source unchanged when the pair is unreachable —
 * reads as success at every call site and fails at the backend, in a message
 * about the backend.
 *
 * **2. Nothing is substituted quietly.** A pair with no converter is refused
 * with the pair named. In particular a source that is ALREADY an accepted
 * format is passed through untouched (`passthrough: true`) rather than
 * re-encoded: a JPEG → JPEG round trip would lose a generation of quality for
 * no reason at all, and nobody would ever see it happen.
 *
 * **3. Order is load-bearing in a batch.** `attachments` is a list precisely
 * because interleaving is ordered — a single ref could not express "these
 * three, in this order" — so `convertMediaBatch` guarantees `result[i]`
 * corresponds to `input[i]`. A reordering bug here would not look like a
 * converter fault: it would look like the MODEL misreading the images.
 *
 * ## What is reachable, and why so little
 *
 * The still-image pairs among png/jpeg/gif/webp, and nothing else. The codec
 * stack is fixed and deliberately native-dependency-free (see `codecs.ts`), so:
 * HEIC stays refused with the advice `sniff.ts` gives at the door, audio and
 * video need ffmpeg, documents need a document engine, and an ANIMATION cannot
 * be written at all — every encoder in this build is single-frame, which is why
 * `animation-would-be-lost` exists as its own refusal rather than being handled
 * by flattening.
 *
 * The format table in `$lib/shared/media/formats` is the vocabulary this reads;
 * it declares what formats EXIST separately from what this build can decode and
 * encode, and `convert.test.ts` pins the registry against it in both directions.
 */
import {
	formatByMime,
	normalizeMime,
	type MediaFormat
} from "$lib/shared/media/formats"
import {
	decodeImage,
	encodeRaster,
	readMotion,
	type EncodeOptions
} from "./codecs"

export type { EncodeOptions } from "./codecs"

/** Bytes to convert, and what they are. A mime rather than a `kind`, because
 *  the pair is what a converter is keyed on. */
export interface ConvertInput {
	bytes: Buffer | Uint8Array
	/** The source's mime. Aliases and `; charset=` parameters are normalised. */
	mime: string
}

/** A conversion that happened, or a source that already needed none. */
export interface ConvertedMedia {
	ok: true
	/** What these bytes ACTUALLY are — the negotiated answer to "which format
	 *  did you pick". Never a promise about what was asked for. */
	mime: string
	/** The extension a file of this format is named with, from the format
	 *  table, so a caller never derives one from a mime's subtype. */
	ext: string
	bytes: Buffer
	/** Null when the format was passed through and its dimensions were never
	 *  read — a conversion always knows them, a passthrough need not decode. */
	width: number | null
	height: number | null
	/** True when the source was already acceptable and NOTHING was re-encoded.
	 *  The bytes are a copy of the input's, byte-identical — copied rather than
	 *  aliased so a caller trimming or padding the result cannot reach back into
	 *  the buffer it handed in. */
	passthrough: boolean
}

/**
 * Why a conversion did not happen. Each code is a distinct decision, not a
 * severity, because callers act differently on them: a `kind-mismatch` is a
 * wiring mistake, an `animation-would-be-lost` is a correct refusal to serve,
 * and a `decode-failed` is a broken file.
 */
export type ConversionRefusalCode =
	/** The source mime is not in the format vocabulary at all. */
	| "unknown-source-format"
	/** Every requested target is outside the format vocabulary. */
	| "unknown-target-format"
	/** Source and target are different kinds. This router converts within a
	 *  kind; producing one kind from another is a GENERATION and belongs to a
	 *  provider. */
	| "kind-mismatch"
	/** Both formats are known, same kind, and no converter joins them. */
	| "no-converter"
	/** The source carries frames and every encoder in this build writes one. */
	| "animation-would-be-lost"
	| "decode-failed"
	| "encode-failed"

export interface ConversionRefused {
	ok: false
	code: ConversionRefusalCode
	/** Normalised, so a refusal names the same spelling the registry uses. */
	sourceMime: string
	/** The target this refusal is about. Null when negotiation never got as far
	 *  as choosing one. */
	targetMime: string | null
	/** Every target that was offered, in the order it was offered. A direct
	 *  `convertMedia` call offers exactly one. */
	considered: readonly string[]
	/** Names the pair and why, in words a user can act on — including a
	 *  format's own `note` when it has one, so the HEIC advice here matches the
	 *  advice the upload gives. */
	reason: string
}

export type ConversionResult = ConvertedMedia | ConversionRefused

/**
 * A conversion was refused because it would have thrown away a dimension the
 * source has.
 *
 * The rule is DIMENSIONS PRESERVED, not kind labels: animated GIF → animated
 * WebP would be fine (both carry time), animated GIF → still WebP discards time
 * and is a downgrade. Reported rather than performed, for the same reason
 * `MediaRef.text` exists — a consumer that cannot take the real thing is told
 * so, instead of being handed something lesser that looks correct.
 *
 * The ERROR still exists alongside `ConversionRefused` because a caller in the
 * middle of a transaction has to be able to raise one, and because
 * `ensureVariant` tells "declined" from "failed" apart in its log line.
 * `refusalToError` is the single place a refusal becomes a throw.
 */
export class MediaDowngradeError extends Error {
	constructor(
		/** What the source has that the target cannot carry, in words a user
		 *  can act on. */
		readonly lost: string,
		message?: string
	) {
		super(message ?? `Refusing a conversion that would lose ${lost}.`)
		this.name = "MediaDowngradeError"
	}
}

/**
 * Turn a refusal into something throwable, keeping the distinction the log
 * lines rely on: a downgrade is a DECISION (`MediaDowngradeError`), anything
 * else is a fault (a plain `Error`).
 */
export function refusalToError(refusal: ConversionRefused): Error {
	return refusal.code === "animation-would-be-lost"
		? new MediaDowngradeError("animation", refusal.reason)
		: new Error(refusal.reason)
}

/**
 * Which half of a converter failed.
 *
 * Tagged by the converter rather than worked out afterwards, because the
 * obvious alternative — re-running the decode to see whether it was the
 * decode — pays for a second full decode on the error path of a 50MB upload.
 */
class ConverterStepError extends Error {
	constructor(
		readonly step: "decode" | "encode",
		readonly why: string
	) {
		super(why)
		this.name = "ConverterStepError"
	}
}

/** Decode the source, re-encode it as `target`. Every reachable pair in this
 *  build is this one operation; the registry below is what says which pairs
 *  those are. */
type Converter = (
	bytes: Buffer | Uint8Array,
	sourceMime: string,
	opts: EncodeOptions
) => Promise<{ bytes: Buffer; width: number; height: number }>

const rasterRoundTrip =
	(target: string): Converter =>
	async (bytes, sourceMime, opts) => {
		const raster = await decodeImage(bytes, sourceMime).catch((err) => {
			throw new ConverterStepError(
				"decode",
				err instanceof Error ? err.message : String(err)
			)
		})
		const encoded = await encodeRaster(raster, target, opts).catch(
			(err) => {
				throw new ConverterStepError(
					"encode",
					err instanceof Error ? err.message : String(err)
				)
			}
		)
		return { bytes: encoded, width: raster.width, height: raster.height }
	}

/**
 * The still-image formats this build can BOTH read and write.
 *
 * Written out rather than filtered off the format table on purpose: the table
 * states what the CODECS can do, this states what the router is willing to
 * route, and the test comparing them is only meaningful while they are two
 * separate statements. Deriving one from the other would make that test
 * tautological.
 */
const STILL_IMAGE_MIMES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp"
] as const

export interface ConverterEntry {
	source: string
	target: string
	convert: Converter
}

/**
 * THE REGISTRY, keyed by (source mime → target mime).
 *
 * Every ordered pair of the still-image formats, the identity pairs included:
 * `image/webp → image/webp` is a genuine operation, and it is the one
 * `deriveDisplay` asks for when it wants a LOSSLESS re-encode of a lossy
 * source. Negotiation never reaches an identity pair by accident — a source
 * that is already acceptable is passed through — so registering them cannot
 * cause a quiet re-encode; only an explicit `convertMedia` with that target
 * gets one, which is the caller saying "encode it again" in as many words.
 */
export const CONVERTERS: readonly ConverterEntry[] = STILL_IMAGE_MIMES.flatMap(
	(source) =>
		STILL_IMAGE_MIMES.map((target) => ({
			source,
			target,
			convert: rasterRoundTrip(target)
		}))
)

const pairKey = (source: string, target: string) => `${source} -> ${target}`

const BY_PAIR: ReadonlyMap<string, ConverterEntry> = new Map(
	CONVERTERS.map((e) => [pairKey(e.source, e.target), e])
)

/** Whether the registry joins this pair. Mimes are normalised first, so
 *  `image/jpg` answers for `image/jpeg`. */
export function converterExists(
	sourceMime: string,
	targetMime: string
): boolean {
	return BY_PAIR.has(
		pairKey(normalizeMime(sourceMime), normalizeMime(targetMime))
	)
}

/** Every format this source can actually reach, in registry order. The list a
 *  picker greys the rest of its options against. */
export function reachableTargets(sourceMime: string): readonly string[] {
	const source = normalizeMime(sourceMime)
	return CONVERTERS.filter((e) => e.source === source).map((e) => e.target)
}

function refuse(
	code: ConversionRefusalCode,
	sourceMime: string,
	targetMime: string | null,
	considered: readonly string[],
	reason: string
): ConversionRefused {
	return { ok: false, code, sourceMime, targetMime, considered, reason }
}

/** A format's own note, appended to a refusal so the reason carries the advice
 *  the vocabulary already holds rather than restating it here. */
function withNote(
	reason: string,
	...formats: (MediaFormat | undefined)[]
): string {
	const notes = formats
		.map((f) => f?.note)
		.filter((n): n is string => !!n)
		.filter((n, i, all) => all.indexOf(n) === i)
	return notes.length ? `${reason} ${notes.join(" ")}` : reason
}

/**
 * Source-level checks, run once before any target is considered.
 *
 * Separate because these answers do not change with the target: an unknown or
 * undecodable source is refused for every candidate, so walking the accepted
 * list would produce N identical refusals and report whichever came last.
 */
function checkSource(
	source: string,
	considered: readonly string[]
):
	| { ok: true; format: MediaFormat }
	| { ok: false; refusal: ConversionRefused } {
	const format = formatByMime(source)
	if (!format) {
		return {
			ok: false,
			refusal: refuse(
				"unknown-source-format",
				source,
				null,
				considered,
				`${source || "(no mime)"} is not a format this build has a vocabulary entry for, so nothing can be converted from it.`
			)
		}
	}
	if (!format.decode) {
		return {
			ok: false,
			refusal: refuse(
				"no-converter",
				source,
				null,
				considered,
				withNote(
					`${source} cannot be decoded by this build, so nothing can be converted from it.`,
					format
				)
			)
		}
	}
	return { ok: true, format }
}

/**
 * Whether the bytes carry a time dimension this build would have to discard.
 *
 * Every encoder here is single-frame, so ANY motion refuses ANY target —
 * `image/gif → image/gif` included, where the format could carry the animation
 * and the encoder still cannot.
 *
 * Keyed on `MotionInfo.animated`, never on a frame count or a duration. This
 * check WAS `frames <= 1`, and a WebP container can declare itself animated
 * without stating either number: an animated WebP counted as 1 frame and was
 * sent to the converter, where only the decoder's own refusal to read it kept
 * the frames — reported as `decode-failed`, which tells a user their file is
 * broken. Both animating formats are probed now (`readMotion`), and `animated`
 * is the field that says so; the numbers are only for the message.
 */
async function motionBlocker(
	input: ConvertInput,
	source: string,
	target: string,
	considered: readonly string[]
): Promise<ConversionRefused | null> {
	const motion = await readMotion(input.bytes, source)
	if (!motion?.animated) return null
	// Omitted rather than guessed when the container does not state it: a
	// refusal that invents "(1 frames)" would undermine the reason it gives.
	const count =
		motion.frames === null
			? ""
			: ` (${motion.frames} frame${motion.frames === 1 ? "" : "s"})`
	return refuse(
		"animation-would-be-lost",
		source,
		target,
		considered,
		`This image is animated${count} and every image encoder in this build writes a single frame, so converting ${source} to ${target} would keep only the first. Serving the original instead.`
	)
}

/**
 * Convert to ONE named target format.
 *
 * Always encodes, even when the target equals the source — that is exactly what
 * `deriveDisplay` wants when it asks for a lossless WebP of a WebP original. A
 * caller that means "leave it alone if it is already acceptable" wants
 * `convertMediaTo`, which negotiates and passes through.
 */
export async function convertMedia(
	input: ConvertInput,
	targetMime: string,
	opts: EncodeOptions = {}
): Promise<ConversionResult> {
	const source = normalizeMime(input.mime)
	const target = normalizeMime(targetMime)
	const considered = [target]

	const checked = checkSource(source, considered)
	if (!checked.ok) return { ...checked.refusal, targetMime: target }

	const targetFormat = formatByMime(target)
	if (!targetFormat) {
		return refuse(
			"unknown-target-format",
			source,
			target,
			considered,
			`${target || "(no mime)"} is not a format this build has a vocabulary entry for, so nothing can be converted to it.`
		)
	}
	if (checked.format.kind !== targetFormat.kind) {
		return refuse(
			"kind-mismatch",
			source,
			target,
			considered,
			`${source} is ${checked.format.kind} and ${target} is ${targetFormat.kind}. This router converts within a kind; producing one kind from another is a generation, not a conversion.`
		)
	}

	const entry = BY_PAIR.get(pairKey(source, target))
	if (!entry) {
		return refuse(
			"no-converter",
			source,
			target,
			considered,
			withNote(
				`No converter for ${source} → ${target}.`,
				checked.format,
				targetFormat
			)
		)
	}

	const motion = await motionBlocker(input, source, target, considered)
	if (motion) return motion

	return runConverter(entry, input, source, target, considered, opts)
}

/**
 * Convert to the FIRST of `accepted` this build can actually reach, and say
 * which that was (`result.mime`).
 *
 * This is the function a provider's "I accept these formats" list calls. The
 * order of `accepted` is the caller's preference and is honoured strictly — a
 * backend listing WebP before PNG gets WebP when both are reachable.
 *
 * A source already in `accepted` short-circuits to a PASSTHROUGH before any
 * preference is applied. Deliberate: re-encoding a JPEG into a "preferred" WebP
 * would silently spend a generation of quality to satisfy an ordering that only
 * exists to break ties.
 */
export async function convertMediaTo(
	input: ConvertInput,
	accepted: readonly string[],
	opts: EncodeOptions = {}
): Promise<ConversionResult> {
	const source = normalizeMime(input.mime)
	const considered = accepted.map(normalizeMime)

	const checked = checkSource(source, considered)
	if (!checked.ok) return checked.refusal

	if (!considered.length) {
		return refuse(
			"no-converter",
			source,
			null,
			considered,
			`No target formats were offered for ${source}, so there is nothing to convert to.`
		)
	}

	// Already acceptable. The bytes are handed back as they are — no decode, no
	// re-encode, nothing to lose.
	if (considered.includes(source)) {
		return {
			ok: true,
			mime: source,
			ext: checked.format.extensions[0]!,
			bytes: Buffer.from(input.bytes),
			width: null,
			height: null,
			passthrough: true
		}
	}

	const target = considered.find((t) => BY_PAIR.has(pairKey(source, t)))
	if (!target) {
		const known = considered
			.map((t) => formatByMime(t))
			.filter((f): f is MediaFormat => !!f)
		const code: ConversionRefusalCode = !known.length
			? "unknown-target-format"
			: known.every((f) => f.kind !== checked.format.kind)
				? "kind-mismatch"
				: "no-converter"
		return refuse(
			code,
			source,
			null,
			considered,
			withNote(
				`None of ${considered.join(", ")} can be reached from ${source}. This build converts it to ${reachableTargets(source).join(", ") || "nothing at all"}.`,
				checked.format,
				...known
			)
		)
	}

	const motion = await motionBlocker(input, source, target, considered)
	if (motion) return motion

	return runConverter(
		BY_PAIR.get(pairKey(source, target))!,
		input,
		source,
		target,
		considered,
		opts
	)
}

/**
 * Run one registered converter, turning a codec failure into a refusal.
 *
 * Decode and encode failures are told apart because they mean different things:
 * a decode failure is a broken or mislabelled file the user can replace, an
 * encode failure is ours. Neither may escape as a throw — a batch of ten
 * attachments must not lose nine because one was truncated.
 */
async function runConverter(
	entry: ConverterEntry,
	input: ConvertInput,
	source: string,
	target: string,
	considered: readonly string[],
	opts: EncodeOptions
): Promise<ConversionResult> {
	try {
		const out = await entry.convert(input.bytes, source, opts)
		return {
			ok: true,
			mime: target,
			ext: formatByMime(target)!.extensions[0]!,
			bytes: out.bytes,
			width: out.width,
			height: out.height,
			passthrough: false
		}
	} catch (err) {
		const step = err instanceof ConverterStepError ? err.step : "encode"
		const why = err instanceof Error ? err.message : String(err)
		return refuse(
			step === "decode" ? "decode-failed" : "encode-failed",
			source,
			target,
			considered,
			step === "decode"
				? `These bytes could not be read as ${source}: ${why}`
				: `Encoding ${target} from ${source} failed: ${why}`
		)
	}
}

/**
 * Convert N files, preserving ORDER and isolating FAILURE.
 *
 * `result[i]` corresponds to `input[i]`, always. `Promise.all` resolves to an
 * array indexed by position in the array it was handed, NOT by completion
 * order, which is the whole reason it is used here instead of a concurrent loop
 * pushing into a shared array — the loop is the version that reorders, and it
 * reorders only when the conversions differ in cost, i.e. not in a test with
 * three identical fixtures.
 *
 * One file failing takes its own slot and nothing else's: every path inside
 * `convertMediaTo` already returns a refusal rather than throwing, and the
 * `catch` here is the backstop for a converter that finds a way to throw past
 * that guard.
 */
export async function convertMediaBatch(
	inputs: readonly ConvertInput[],
	accepted: readonly string[],
	opts: EncodeOptions = {}
): Promise<ConversionResult[]> {
	return Promise.all(
		inputs.map(async (input) => {
			try {
				return await convertMediaTo(input, accepted, opts)
			} catch (err) {
				const why = err instanceof Error ? err.message : String(err)
				return refuse(
					"encode-failed",
					normalizeMime(input.mime),
					null,
					accepted.map(normalizeMime),
					`Converting this file threw instead of refusing, which is a bug in the converter: ${why}`
				)
			}
		})
	)
}
