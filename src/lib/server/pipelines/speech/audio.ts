/**
 * 🚧 Joining the audio of a spoken line (seam S3; design §11.4).
 *
 * `speak@1` makes one call per group of cues, so a line spoken by two voices
 * is two files. This joins them: parse each WAV, lay `gapMs` of silence
 * between groups (none inside one), write one canonical WAV, and report where
 * each group sits so the cue map can say where each cue is.
 *
 * ## The non-WAV rule (decided here, reported to the lead)
 *  - ONE audio part, any format: passed through untouched. Its duration is the
 *    service's own `durationMs` when it gave one.
 *  - SEVERAL, all WAV with the same format: joined sample-exact, `source:
 *    'concatenated'`.
 *  - SEVERAL, all MP3: the frames are byte-joined (MP3 is frame-based and
 *    plays gaplessly) with NO gap, and the cue map is `none` — a byte offset is
 *    not a time without decoding.
 *  - WAVs that disagree on rate / channels / depth are converted to the FIRST
 *    part's format (linear interpolation) and the result says so (`resampled`).
 *  - Anything else (mixed formats, Opus/AAC/FLAC, a depth not handled): not joinable here. `joinAudio` returns `null` and the caller
 *    decides (the speak effect keeps the first group and says so on the receipt).
 * The speak effect asks for `wav` whenever the model's speech facts list it, so
 * the first row is the one that happens.
 */

export interface WavFormat {
	/** 1 = integer PCM, 3 = IEEE float. */
	audioFormat: number
	channels: number
	sampleRate: number
	bitsPerSample: number
	blockAlign: number
}

export interface ParsedWav {
	format: WavFormat
	/** The sample bytes (a whole number of frames). */
	data: Buffer
	durationMs: number
}

export interface AudioPart {
	bytes: Buffer
	mime: string
}

/** One group's place in the joined audio. */
export interface GroupSpan {
	startMs: number
	endMs: number
}

export interface JoinedAudio {
	bytes: Buffer
	mime: string
	durationMs: number | null
	/** One per input part, in order (empty when the join cannot say — MP3). */
	spans: GroupSpan[]
	/** `concatenated` when the spans are sample-exact, `none` otherwise. */
	source: "concatenated" | "none"
	/** Set when parts in another rate / channel count / depth were converted to the first part's. */
	resampled?: { parts: number; toRate: number }
}

const tag = (b: Buffer, o: number) => b.toString("latin1", o, o + 4)

/** Whether the bytes begin like a RIFF/WAVE file. */
export const looksLikeWav = (b: Buffer): boolean =>
	b.length >= 12 && tag(b, 0) === "RIFF" && tag(b, 8) === "WAVE"

/**
 * Parse a WAV. A streamed header (data size 0 or 0xffffffff, as Ollama and some
 * KoboldCPP builds write) reads to the end of the buffer. Null when the bytes
 * are not a WAV this can join (no `fmt `/`data`, or a compressed codec).
 */
export function parseWav(bytes: Buffer): ParsedWav | null {
	if (!looksLikeWav(bytes)) return null
	let off = 12
	let format: WavFormat | null = null
	while (off + 8 <= bytes.length) {
		const id = tag(bytes, off)
		const size = bytes.readUInt32LE(off + 4)
		const body = off + 8
		if (id === "fmt " && body + 16 <= bytes.length) {
			let audioFormat = bytes.readUInt16LE(body)
			const channels = bytes.readUInt16LE(body + 2)
			const sampleRate = bytes.readUInt32LE(body + 4)
			const blockAlign = bytes.readUInt16LE(body + 12)
			const bitsPerSample = bytes.readUInt16LE(body + 14)
			// WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID.
			if (audioFormat === 0xfffe && size >= 26 && body + 26 <= bytes.length)
				audioFormat = bytes.readUInt16LE(body + 24)
			if ((audioFormat !== 1 && audioFormat !== 3) || !channels || !sampleRate || !blockAlign)
				return null
			format = { audioFormat, channels, sampleRate, bitsPerSample, blockAlign }
		} else if (id === "data") {
			if (!format) return null
			const available = bytes.length - body
			let len = size === 0 || size === 0xffffffff || size > available ? available : size
			len -= len % format.blockAlign
			const data = bytes.subarray(body, body + len)
			const durationMs = Math.round((data.length / (format.sampleRate * format.blockAlign)) * 1000)
			return { format, data, durationMs }
		}
		if (size === 0xffffffff) return null
		off = body + size + (size % 2)
	}
	return null
}

/** A canonical 44-byte-header WAV around sample data. */
export function writeWav(format: WavFormat, data: Buffer): Buffer {
	const header = Buffer.alloc(44)
	header.write("RIFF", 0, "latin1")
	header.writeUInt32LE(36 + data.length, 4)
	header.write("WAVE", 8, "latin1")
	header.write("fmt ", 12, "latin1")
	header.writeUInt32LE(16, 16)
	header.writeUInt16LE(format.audioFormat, 20)
	header.writeUInt16LE(format.channels, 22)
	header.writeUInt32LE(format.sampleRate, 24)
	header.writeUInt32LE(format.sampleRate * format.blockAlign, 28)
	header.writeUInt16LE(format.blockAlign, 32)
	header.writeUInt16LE(format.bitsPerSample, 34)
	header.write("data", 36, "latin1")
	header.writeUInt32LE(data.length, 40)
	return Buffer.concat([header, data])
}

const sameFormat = (a: WavFormat, b: WavFormat) =>
	a.audioFormat === b.audioFormat &&
	a.channels === b.channels &&
	a.sampleRate === b.sampleRate &&
	a.bitsPerSample === b.bitsPerSample &&
	a.blockAlign === b.blockAlign

/** `gapMs` of silence in `format` (8-bit PCM is unsigned, so its silence is 0x80). */
export function silence(format: WavFormat, gapMs: number): Buffer {
	const frames = Math.max(0, Math.round((gapMs / 1000) * format.sampleRate))
	const buf = Buffer.alloc(frames * format.blockAlign)
	if (format.audioFormat === 1 && format.bitsPerSample === 8) buf.fill(0x80)
	return buf
}

/** Decode PCM / float WAV data to per-channel floats in -1..1; null for a depth not handled. */
function decodeChannels(w: ParsedWav): Float32Array[] | null {
	const { audioFormat, channels, bitsPerSample, blockAlign } = w.format
	const frames = Math.floor(w.data.length / blockAlign)
	const bytes = bitsPerSample / 8
	const out = Array.from({ length: channels }, () => new Float32Array(frames))
	for (let f = 0; f < frames; f++)
		for (let c = 0; c < channels; c++) {
			const o = f * blockAlign + c * bytes
			let v: number
			if (audioFormat === 3 && bitsPerSample === 32) v = w.data.readFloatLE(o)
			else if (audioFormat === 3 && bitsPerSample === 64) v = w.data.readDoubleLE(o)
			else if (audioFormat === 1 && bitsPerSample === 16) v = w.data.readInt16LE(o) / 32768
			else if (audioFormat === 1 && bitsPerSample === 24) v = w.data.readIntLE(o, 3) / 8388608
			else if (audioFormat === 1 && bitsPerSample === 32) v = w.data.readInt32LE(o) / 2147483648
			else if (audioFormat === 1 && bitsPerSample === 8) v = (w.data[o]! - 128) / 128
			else return null
			out[c]![f] = v
		}
	return out
}

function encodeChannels(format: WavFormat, chans: Float32Array[]): Buffer {
	const frames = chans[0]?.length ?? 0
	const buf = Buffer.alloc(frames * format.blockAlign)
	const bytes = format.bitsPerSample / 8
	const clamp = (v: number) => (v > 1 ? 1 : v < -1 ? -1 : v)
	for (let f = 0; f < frames; f++)
		for (let c = 0; c < format.channels; c++) {
			const o = f * format.blockAlign + c * bytes
			const v = chans[c]![f]!
			if (format.audioFormat === 3 && format.bitsPerSample === 32) buf.writeFloatLE(v, o)
			else if (format.audioFormat === 3) buf.writeDoubleLE(v, o)
			else if (format.bitsPerSample === 16) buf.writeInt16LE(Math.round(clamp(v) * 32767), o)
			else if (format.bitsPerSample === 24) buf.writeIntLE(Math.round(clamp(v) * 8388607), o, 3)
			else if (format.bitsPerSample === 32) buf.writeInt32LE(Math.round(clamp(v) * 2147483647), o)
			else buf[o] = Math.round(clamp(v) * 127) + 128
		}
	return buf
}

/** Convert a parsed WAV to `target`'s rate, channel count and depth (linear interpolation; mix by average / duplicate). Null when a depth is not handled. */
export function convertWav(w: ParsedWav, target: WavFormat): Buffer | null {
	const src = decodeChannels(w)
	if (!src) return null
	if (![8, 16, 24, 32, 64].includes(target.bitsPerSample)) return null
	// Channels: down to mono by average, up by duplicating; stereo <-> N keeps the first channels.
	const frames = src[0]?.length ?? 0
	let mixed: Float32Array[]
	if (src.length === target.channels) mixed = src
	else if (target.channels === 1) {
		const m = new Float32Array(frames)
		for (let f = 0; f < frames; f++) {
			let sum = 0
			for (const ch of src) sum += ch[f]!
			m[f] = sum / src.length
		}
		mixed = [m]
	} else mixed = Array.from({ length: target.channels }, (_, c) => src[Math.min(c, src.length - 1)]!)
	// Rate: linear interpolation.
	let out = mixed
	if (w.format.sampleRate !== target.sampleRate && frames > 0) {
		const n = Math.max(1, Math.round((frames * target.sampleRate) / w.format.sampleRate))
		const ratio = w.format.sampleRate / target.sampleRate
		out = mixed.map((ch) => {
			const r = new Float32Array(n)
			for (let i = 0; i < n; i++) {
				const pos = i * ratio
				const i0 = Math.min(frames - 1, Math.floor(pos))
				const i1 = Math.min(frames - 1, i0 + 1)
				const t = pos - i0
				r[i] = ch[i0]! * (1 - t) + ch[i1]! * t
			}
			return r
		})
	}
	return encodeChannels(target, out)
}

const isMp3 = (mime: string) => /^audio\/(mpeg|mp3)\b/i.test(mime)

/**
 * Join the groups' audio into one. `gaps[i]` is the silence BEFORE part `i`
 * (ignored for the first); a caller that wants no gap inside one group passes
 * 0 there. Null when the parts cannot be joined (see the header).
 */
export function joinAudio(parts: readonly AudioPart[], gaps: readonly number[]): JoinedAudio | null {
	if (parts.length === 0) return null
	if (parts.length === 1) {
		const only = parts[0]!
		const wav = parseWav(only.bytes)
		return {
			bytes: only.bytes,
			mime: only.mime,
			durationMs: wav?.durationMs ?? null,
			spans: wav ? [{ startMs: 0, endMs: wav.durationMs }] : [],
			source: wav ? "concatenated" : "none"
		}
	}
	const wavs = parts.map((p) => parseWav(p.bytes))
	if (wavs.every((w): w is ParsedWav => w !== null)) {
		const format = wavs[0]!.format
		let resampledParts = 0
		const converted: ParsedWav[] = wavs.map((w) => {
			if (sameFormat(w.format, format)) return w
			const data = convertWav(w, format)
			if (!data) return w
			resampledParts++
			return { format, data, durationMs: Math.round((data.length / (format.sampleRate * format.blockAlign)) * 1000) }
		})
		if (converted.every((w) => sameFormat(w.format, format))) {
			const wavs = converted
			const chunks: Buffer[] = []
			const spans: GroupSpan[] = []
			let total = 0
			let ms = 0
			wavs.forEach((w, i) => {
				const gap = i === 0 ? 0 : Math.max(0, gaps[i] ?? 0)
				if (gap > 0) {
					const s = silence(format, gap)
					chunks.push(s)
					total += s.length
				}
				const startMs = Math.round((total / (format.sampleRate * format.blockAlign)) * 1000)
				chunks.push(w.data)
				total += w.data.length
				const endMs = Math.round((total / (format.sampleRate * format.blockAlign)) * 1000)
				spans.push({ startMs, endMs })
				ms = endMs
			})
			return {
				bytes: writeWav(format, Buffer.concat(chunks)),
				mime: "audio/wav",
				durationMs: ms,
				spans,
				source: "concatenated",
				...(resampledParts ? { resampled: { parts: resampledParts, toRate: format.sampleRate } } : {})
			}
		}
		return null
	}
	if (parts.every((p) => isMp3(p.mime) && !looksLikeWav(p.bytes)))
		return {
			bytes: Buffer.concat(parts.map((p) => p.bytes)),
			mime: "audio/mpeg",
			durationMs: null,
			spans: [],
			source: "none"
		}
	return null
}

/**
 * Split text to at most `limit` characters per piece, at a sentence end when it
 * can, else at a space, else hard. Used for services that refuse long input
 * (Ollama: 4096). Pieces are trimmed and non-empty; joined with a space they
 * read as the original.
 */
export function splitForLimit(text: string, limit: number): string[] {
	const t = text.trim()
	if (!t) return []
	if (!Number.isFinite(limit) || limit <= 0 || t.length <= limit) return [t]
	const out: string[] = []
	let rest = t
	while (rest.length > limit) {
		const window = rest.slice(0, limit)
		let cut = -1
		const sentence = /[.!?…。！？]["'”’)」』]*\s/g
		for (let m = sentence.exec(window); m; m = sentence.exec(window)) cut = m.index + m[0].length
		if (cut < limit * 0.4) cut = window.lastIndexOf(" ")
		if (cut <= 0) cut = limit
		out.push(rest.slice(0, cut).trim())
		rest = rest.slice(cut).trim()
	}
	if (rest) out.push(rest)
	return out.filter(Boolean)
}

/**
 * The longest a piece of text could reasonably take to say: a generous
 * per-word allowance plus a lead-in, times a slack factor, so only a run-on
 * (a one-word fragment that turns into seconds of noise) is ever cut.
 */
export function speechBudgetMs(text: string): number {
	const words = text.trim().split(/\s+/).filter(Boolean).length
	return Math.round((1500 + words * 600) * 2.5)
}

/** The WAV cut at `maxMs` (null when it is not a WAV this parser reads or is already within the budget). */
export function trimWav(bytes: Buffer, maxMs: number): { bytes: Buffer; durationMs: number } | null {
	const wav = parseWav(bytes)
	if (!wav || wav.durationMs <= maxMs) return null
	const bytesPerMs = (wav.format.sampleRate * wav.format.blockAlign) / 1000
	const keep = Math.floor((maxMs * bytesPerMs) / wav.format.blockAlign) * wav.format.blockAlign
	const data = wav.data.subarray(0, keep)
	return { bytes: writeWav(wav.format, data), durationMs: Math.round(data.length / bytesPerMs) }
}
