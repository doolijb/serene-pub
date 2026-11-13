/**
 * 🚧 M2d: the host's sentence for a frame that reported a `fatal` error. One
 * constant, read by `PluginFrame` (in its own chrome) and by `AppletLoading`
 * (when a launching applet's frame gives up before `ready`) — the frame's own
 * words never reach the app's UI, only this.
 */
export const FRAME_FATAL_SENTENCE =
	"This surface stopped and can't show anything. Reload the page to try it again — the extension's own message is in the browser console."
