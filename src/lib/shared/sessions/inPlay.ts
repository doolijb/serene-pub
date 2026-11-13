/**
 * 🚧 **In play** — the one rule (owner 2026-11-10, benched seats): a seat is in
 * play when it is live (not removed) and not benched. Turns, which seat a
 * person speaks as, the prompt and the lore gate read it; sheets, access and
 * names keep reading `removedAt` alone.
 *
 * Pure, for both halves (the page reads seats too). The server's SQL form is
 * `seatInPlay` (`sessions/seats.ts`). Reads a row as any read carries it: the
 * bench is `isActive` on a table row and `enabled` on the read a pipeline or
 * widget takes (R5: one fact, two vocabularies). Absent reads as in play — a
 * row from a read that does not carry the bench.
 */
export const inPlay = (seat: {
	removedAt?: unknown
	isActive?: boolean | null
	enabled?: boolean | null
}): boolean => !seat.removedAt && seat.isActive !== false && seat.enabled !== false
