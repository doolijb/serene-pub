export type Handler<P = any, A = any> = {
	event: string
	handler: (
		socket: any,
		params: P,
		/**
		 * Emit to the caller's own user room.
		 *
		 * A FUNCTION is a thunk: it is evaluated once, and only when a gated
		 * event has a socket that declared interest in it (see
		 * `$lib/shared/sockets/interest` and `sockets/index.ts`). That is how a
		 * cascade avoids paying for a query whose reply nobody is listening
		 * for. Anything else is the payload itself and is emitted as it always
		 * was.
		 *
		 * A thunk makes the call return a promise; plain data on an ungated
		 * event stays synchronous, as the ~874 call sites that do not await it
		 * expect. The type stays `void` because those call sites (and the fake
		 * emitters in the tests) return whatever they like — a handler that
		 * needs its cascade to LAND before it returns awaits it anyway, which
		 * is exactly what awaiting a maybe-promise does.
		 */
		emitToUser: (event: string, data: any) => void
	) => Promise<A>
}
