/** The numeric precision a file name or id says. Pure; shared by the list parser and the package scan. */

const PRECISION_AT_END = /(?:^|[-_.])(q\d(?:_\d|_k(?:_[sml])?)?|bf16|f16|fp16|f32|orig)$/i
const PRECISION_ANYWHERE = /(?:^|[-_.])(q\d(?:_\d|_k(?:_[sml])?)?|bf16|f16|fp16|f32|orig)(?=[-_.]|$)/i

/**
 * The precision a file name or id says: the trailing token, else the first
 * precision-looking token (`…-q8_0_v2.gguf` -> `q8_0`). Lower-cased; undefined
 * when there is none.
 */
export function derivePrecision(...names: string[]): string | undefined {
	for (const raw of names) {
		const stem = (raw.split("/").pop() ?? raw).replace(/\.gguf$/i, "")
		const m = stem.match(PRECISION_AT_END)
		if (m) return m[1].toLowerCase()
	}
	for (const raw of names) {
		const stem = (raw.split("/").pop() ?? raw).replace(/\.gguf$/i, "")
		const m = stem.match(PRECISION_ANYWHERE)
		if (m) return m[1].toLowerCase()
	}
	return undefined
}
