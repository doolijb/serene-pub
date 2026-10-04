// @ts-nocheck
// A hand-written stand-in for the built component module: the Tally panel's
// component, which places the package's document (`ui/tally.html`) as an
// `sp-frame`. See README.md — the SDK fixture's `components/tally.ts`.
export default (root, ctx) => {
	const frame = document.createElement("sp-frame")
	frame.setAttribute("src", "ui/tally.html")
	frame.setAttribute("title", "Tally")
	root.append(frame)
	const draw = () => frame.setAttribute("props", JSON.stringify({ messages: (ctx.channels.main ?? []).length }))
	draw()
	return ctx.subscribe(draw)
}
