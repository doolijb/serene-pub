#!/usr/bin/env node
import fs from "fs"
import path from "path"

const buildFile = "build/index.js"

if (!fs.existsSync(buildFile)) {
	console.log("Build file not found:", buildFile)
	process.exit(1)
}

console.log("🔧 Customizing server build output...")

let content = fs.readFileSync(buildFile, "utf8")

// Replace console.log messages
let replacements = 0

const originalListeningFd = content
content = content.replace(
	/console\.log\(`Listening on file descriptor/g,
	"console.log(`🚀 Serene Pub listening on file descriptor"
)
if (content !== originalListeningFd) {
	replacements++
	console.log("✅ Replaced file descriptor listening message")
}

const originalListeningPath = content
content = content.replace(
	/console\.log\(`Listening on \$\{path/g,
	"console.log(`🚀 Serene Pub listening on ${path"
)
if (content !== originalListeningPath) {
	replacements++
	console.log("✅ Replaced path listening message")
}

console.log(`Applied ${replacements} basic replacements`)

// Add launch message after the listening message
content = content.replace(
	/console\.log\(`🚀 Serene Pub listening on \$\{path \|\| `http:\/\/\$\{host\}:\$\{port\}`\}`\);/g,
	`console.log(\`🚀 Serene Pub listening on \${path || \`http://\${host}:\${port}\`}\`);
		if (!path) {
			console.log(\`\`);
			console.log(\`                                                  \`);
			console.log(\`                                                  \`);
			console.log(\`                                           @=@    \`);
			console.log(\`               @@               @@@       ++==    \`);
			console.log(\`              @@@@             @@--     @++--=@   \`);
			console.log(\`              @@@@@          @@@@--@    ##=====   \`);
			console.log(\`              @#@@@@@      @**@@---@    @#*+=#@   \`);
			console.log(\`              @##@@@@*####+**@@-@--@     #@#@     \`);
			console.log(\`              @##@######*****@-----     @%*@#     \`);
			console.log(\`               #######******--@@+-#      #%@      \`);
			console.log(\`               ######***********:-      %@%       \`);
			console.log(\`              #####+************@       #%@       \`);
			console.log(\`              @@###+*@+***********#     @%        \`);
			console.log(\`             @##@#*+*****#*****+##***@ @%@        \`);
			console.log(\`     --       %#%#**+@@**:--------@    #%@        \`);
			console.log(\`    ---        @#*****---------@@      %%         \`);
			console.log(\`    ---       @#****------:-@+**@@@@@@@%@         \`);
			console.log(\`      --     @%@**-----@@--:****@@@@%%#%@         \`);
			console.log(\`       ----   @@--:-@@@@---*****@%%%%%%%%@        \`);
			console.log(\`       =-       %@@@@@@----***@%%%%%%@%@@%@       \`);
			console.log(\`        =     @%%%@@@------:@%%%%@@%@#%@@@        \`);
			console.log(\`     @@@@@@@+@  @%%@%-----@%%%@%%%%%%%%@@         \`);
			console.log(\`   @%@==-----@ @@@@%%@=@@%@@%%%%%%%%@%@%@         \`);
			console.log(\`   @%%==-----  @@%%@%**+@@%%%%%%%%%%%#@%%         \`);
			console.log(\`  %@%%@@=---  @@%%%@%%@@%@%%@%%%%%%%%%%%%@        \`);
			console.log(\`   @@@@@@@   @%%%@@%%%%%@%%@@%%@%%%@%@%%%%@       \`);
			console.log(\`     %%%@    %%@@%%%@%%%%%%%%@@%%%@%@@%%%%%       \`);
			console.log(\`      @%%@ %%@@@@%%%%@%%%%%%%%%@@%@%%@%%%%%@      \`);
			console.log(\`       @%%%@@@%@@@%%%%@%%%%%%%%@@@@%@%%%%%%%@     \`);
			console.log(\`       @%%%%@%%%@@@%%%%%%%%%%%@@@@%%@@%%%%@%%     \`);
			console.log(\`       @@%%%@%%@%@@@@%%%%%%%%@@@@@%%@%%@%%%%@@    \`);
			console.log(\`      @@@%%%@@%%@@@@%@@@@@@@@%%@@@@@@@%%%@%%%@@   \`);
			console.log(\`      %@@@@@@@%%@@@@%@%%%%%%@%@@@%%%%%%%%%@@%%@   \`);
			console.log(\`     @%@@@@@@@%%@@@@@@%%%%@@@@@@%%%@%%%%%%%@#%@   \`);
			console.log(\`    @@@----=----@@@+@@%%%%%%%@%%%%%%@@%%%%%@@@    \`);
			console.log(\`    @@@@---=--@====-@@@%%%%%%%%@@@@@@@@%%%%@@     \`);
			console.log(\`  @@@@@@##@@=+@@@@@-@%@@@%     @@@@@@@@%%@@@      \`);
			console.log(\`          @@@ %@@@@##@                           \`);
			console.log(\`\`);
			console.log(\`╔═══════════════════════════════════════════════════════════╗\`);
			console.log(\`║   ____                              ____        _         ║\`);
			console.log(\`║  / ___|  ___ _ __ ___ _ __   ___   |  _ \\\\ _   _| |__      ║\`);
			console.log(\`║  \\\\___ \\\\ / _ \\\\ '__/ _ \\\\ '_ \\\\ / _ \\\\  | |_) | | | | '_ \\\\     ║\`);
			console.log(\`║   ___) |  __/ | |  __/ | | |  __/  |  __/| |_| | |_) |    ║\`);
			console.log(\`║  |____/ \\\\___|_|  \\\\___|_| |_|\\\\___|  |_|    \\\\__,_|_.__/     ║\`);
			console.log(\`║                                                           ║\`);
			console.log(\`╚═══════════════════════════════════════════════════════════╝\`);
			console.log(\`🌐 Launch Serene Pub in your browser at http://localhost:\${port} or http://127.0.0.1:\${port}\`);
			console.log(\`\`);
			
			// Auto-open browser if SERENE_AUTO_OPEN is not disabled
			if (process.env.SERENE_AUTO_OPEN !== '1' && process.env.SERENE_AUTO_OPEN !== 'true') {
				setTimeout(() => {
					import('open').then(({ default: open }) => {
						open(\`http://localhost:\${port}\`);
						console.log(\`🚀 Opening Serene Pub in your default browser...\`);
					}).catch((err) => {
						console.warn(\`⚠️  Could not auto-open browser: \${err.message}\`);
						console.log(\`💡 You can manually open http://localhost:\${port} in your browser\`);
					});
				}, 1000);
			} else {
				console.log(\`ℹ️  Auto-open browser disabled (SERENE_AUTO_OPEN=\${process.env.SERENE_AUTO_OPEN})\`);
			}
		}`
)

// Add shutdown message - fix the function call pattern
content = content.replace(
	/function graceful_shutdown\(reason\) \{/g,
	"function graceful_shutdown(reason) {\n\tconsole.log(`👋 Serene Pub shutting down (${reason})`);"
)

// ── Socket.IO shares the app's HTTP server ──────────────────────────────────
//
// adapter-node's entry owns the http.Server and never hands it to app code, so
// the customised adapter entry moves to build/adapter-entry.js and build/index.js
// becomes a thin wrapper that imports it and publishes the underlying server on
// globalThis. src/hooks.server.ts picks it up on the first request and attaches
// Socket.IO there — inside the SSR bundle, which is the only place $lib
// resolves. vite.config.ts does the same job for dev.
//
// build/index.js keeps its name deliberately: it is the entry named by
// package.json ("bin" and "start"), the Dockerfile CMD, and Android's
// NodeService.kt. Renaming it would be a breaking change for no benefit.
const adapterEntryFile = "build/adapter-entry.js"
fs.writeFileSync(adapterEntryFile, content)

fs.writeFileSync(
	buildFile,
	`// Generated by scripts/customize-build.js — do not edit.
//
// adapter-node's real entry lives in ./adapter-entry.js and starts listening as
// a side effect of being imported. It exports polka's wrapper as \`server\`;
// \`server.server\` is the underlying node http.Server that Socket.IO attaches
// to (see src/hooks.server.ts).
import { server, host, path, port } from "./adapter-entry.js"

globalThis.__SERENE_PUB_HTTP_SERVER__ = server.server

export { server, host, path, port }
`
)
console.log("✅ Server build output customized successfully!")
console.log("✅ Wrote build/index.js wrapper (Socket.IO shares the app server)")
