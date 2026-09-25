import { io } from "socket.io-client"
const s = io("http://localhost:5233", { transports: ["websocket"] })
s.on("connect", () => {
	s.emit("interest:sync", { keys: ["pipelines:run"] })
	setTimeout(() => s.emit("pipelines:run", { runId: process.argv[2] }), 300)
})
s.on("pipelines:run", (r) => {
	const txt = JSON.stringify(r)
	for (const k of ["\"cause\"", "\"auto\"", "\"lineage\"", "turnOrder"]) {
		let i = -1, n = 0
		while ((i = txt.indexOf(k, i + 1)) >= 0 && n++ < 3) console.log(k, txt.slice(i, i + 220))
	}
	s.close()
})
setTimeout(() => process.exit(0), 15000)
