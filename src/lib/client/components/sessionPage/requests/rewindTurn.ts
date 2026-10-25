/**
 * 🚧 `rewind-turn` · `forward-turn` (core only; RF fix 5, owner ruling
 * 2026-10-23): **Back** and **Forward** on the session's history — the
 * page's `sessions:rewindTurn` / `sessions:forwardTurn`. They take no
 * params and refuse nothing here: the server's door says why a press was
 * refused (the toast's sentence), and the strip's state comes back on the
 * session (`session.rewind`, the dossier's `rewind`).
 */

import type { TypedSocket } from "$lib/client/sockets/typedSocket"

/** What these answers need of the page. */
export interface RewindTurnDeps {
	/** Back: the newest turn out of the history. */
	rewindTurn(): void
	/** Forward: the newest rewound turn back into it. */
	forwardTurn(): void
}

/** Answer one `rewind-turn`. */
export function answerRewindTurn(_params: unknown, deps: RewindTurnDeps): void {
	deps.rewindTurn()
}

/** Answer one `forward-turn`. */
export function answerForwardTurn(_params: unknown, deps: RewindTurnDeps): void {
	deps.forwardTurn()
}

/** 🚧 The page's ONE Back and ONE Forward emit (audit R4): the header's presses and a widget's `rewind-turn` / `forward-turn` both call these. A press before the route has a session id sends nothing. */
export function rewindPresses(socket: Pick<TypedSocket, "emit">, sessionId: () => number | null | undefined): RewindTurnDeps {
	return {
		rewindTurn() { const id = sessionId(); if (id != null) socket.emit("sessions:rewindTurn", { sessionId: id }) },
		forwardTurn() { const id = sessionId(); if (id != null) socket.emit("sessions:forwardTurn", { sessionId: id }) }
	}
}
