/**
 * `omggif` ships no types, and it is not worth an `any` cast at the call site.
 *
 * It is already in the tree as a transitive dependency of `@jimp/js-gif` (and
 * declared directly in package.json since 0182, so an unrelated jimp bump
 * cannot take it away). Pure JS, no native build — which is the whole reason
 * this project can probe an animated GIF at all: see the codec-stack note in
 * thumbnail.ts.
 *
 * Only the members something here actually calls are declared. Adding more is
 * fine; inventing signatures for the ones nobody calls is not.
 */
declare module "omggif" {
	export class GifReader {
		constructor(buffer: Uint8Array)
		width: number
		height: number
		numFrames(): number
		/** `delay` is in CENTIseconds, which is why files.duration_ms is ms. */
		frameInfo(frame: number): {
			x: number
			y: number
			width: number
			height: number
			/** Hundredths of a second. */
			delay: number
			disposal: number
			transparent_index: number | null
		}
	}

	/**
	 * Declared for the CONVERSION TESTS, which need a genuinely animated GIF to
	 * assert that the router refuses to flatten one — nothing in this build
	 * writes an animation at runtime, and a hand-rolled byte fixture would be
	 * asserting against the encoder that produced it rather than against a real
	 * multi-frame file.
	 */
	export class GifWriter {
		constructor(
			buffer: Uint8Array,
			width: number,
			height: number,
			opts?: { loop?: number; palette?: number[] }
		)
		addFrame(
			x: number,
			y: number,
			width: number,
			height: number,
			indexedPixels: number[],
			opts?: {
				/** Hundredths of a second. */
				delay?: number
				palette?: number[]
				disposal?: number
				transparent?: number
			}
		): number
		/** Writes the trailer and returns the number of bytes used. */
		end(): number
	}
}
