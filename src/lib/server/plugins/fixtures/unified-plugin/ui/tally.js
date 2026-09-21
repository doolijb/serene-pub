// The smallest frame that proves a panel's own script is served beside it:
// core's CSP refuses an inline <script>, so a checked-in frame that inlined its
// logic would pass this fixture's test and fail in the app.
window.addEventListener("message", (e) => {
	if (e.data?.t !== "init") return
	const el = document.getElementById("count")
	if (el) el.textContent = "ready"
})
