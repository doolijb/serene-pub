/**
 * Writes a run makes outside `host.call` / `host.commit`, told to the host's
 * `session_cast` memo. A write routed through `castWrite` forces every cast
 * read in its window, and every one begun before it, to the database: the
 * memo is bypassed while any such write is in flight and an entry stored
 * before the window is dropped after it. Leaf module: no imports.
 */
let inFlight = 0
let epoch = 0

export function castWritesInFlight(): number {
	return inFlight
}

/** Bumps on every start and end of a `castWrite`; a memo entry is valid only for the epoch it was stored in. */
export function castWriteEpoch(): number {
	return epoch
}

export async function castWrite<T>(write: () => Promise<T>): Promise<T> {
	inFlight++
	epoch++
	try {
		return await write()
	} finally {
		inFlight--
		epoch++
	}
}
