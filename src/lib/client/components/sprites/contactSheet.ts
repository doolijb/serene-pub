/** 🚧 One sprite label's place on a fill's contact sheet (I5). */
export interface ContactTile {
	label: string
	/**
	 * `waiting` — not drawn yet; `drawn` — drawn, not filed yet;
	 * `attached` — filed as a sprite; `missing` — the run brought none.
	 */
	state: "waiting" | "drawn" | "attached" | "missing"
	/** The picture, once there is one. */
	src?: string | null
	/** The sprite row it was filed as. */
	spriteId?: number
	/** The person pressed Keep. */
	kept?: boolean
}
