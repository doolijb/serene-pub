/**
 * The largest file each import reads, checked on BOTH sides (lorebooks plan
 * S4): the page refuses before it uploads, and the server refuses before it
 * parses — a hand-rolled emit meets the same ceiling the dialog does.
 *
 * All three sit under Socket.IO's `maxHttpBufferSize` (1e8, which a base64
 * card file can use only three quarters of). That transport ceiling was the
 * only one before; it bounds a message, not what parsing the message costs.
 */

export const MIB = 1024 * 1024

export const IMPORT_FILE_CAPS = {
	/** A card file — PNG, APNG, JPEG, WebP, JSON or CHARX — as its bytes. */
	cardBytes: 64 * MIB,
	/**
	 * The JSON a card carries, wherever it sits: a JSON card, a CHARX's
	 * card.json, the text chunk of a PNG card. The same 16 MiB the CHARX
	 * reader already held card.json to.
	 */
	cardJsonBytes: 16 * MIB,
	/** A lorebook file's text (lorebooks are text only; nothing embeds images). */
	lorebookBytes: 32 * MIB
} as const

/** "40 MB" — rounded up, so a file one byte over reads as over. */
export function megabytes(bytes: number): string {
	return `${Math.max(1, Math.ceil(bytes / MIB)).toLocaleString("en")} MB`
}

/** The sentence refusing a card file of `bytes`, or null when it fits. */
export function cardFileTooLarge(bytes: number): string | null {
	return bytes > IMPORT_FILE_CAPS.cardBytes
		? `This card file is ${megabytes(bytes)}, larger than the ${megabytes(IMPORT_FILE_CAPS.cardBytes)} Serene Pub will read.`
		: null
}

/** The sentence refusing a lorebook file of `bytes`, or null when it fits. */
export function lorebookFileTooLarge(bytes: number): string | null {
	return bytes > IMPORT_FILE_CAPS.lorebookBytes
		? `This lorebook file is ${megabytes(bytes)}, larger than the ${megabytes(IMPORT_FILE_CAPS.lorebookBytes)} Serene Pub will read.`
		: null
}
