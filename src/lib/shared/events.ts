export type Handler<P = any, A = any> = {
	event: string
	handler: (
		socket: any,
		params: P,
		emitToUser: (event: string, data: any) => void
	) => Promise<A>
}
