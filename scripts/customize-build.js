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

// Load .env before @sveltejs/adapter-node reads its own configuration.
//
// The adapter reads ORIGIN, PROTOCOL_HEADER, HOST_HEADER, ADDRESS_HEADER,
// XFF_DEPTH and PORT at the module scope of ./handler.js, which index.js
// imports — so anything that must influence them has to run first. ESM
// evaluates imports depth-first in source order, so a side-effect import on
// line 1 runs to completion before handler.js's body does.
//
// Without this, .env reached the app only via a dotenv.config() buried in a
// module that one API route imported, i.e. after the first request — far too
// late for any of the above. Desktop launchers worked around it by exporting
// every key before spawning node; Docker and bare `node build/index.js` had no
// workaround at all and silently ignored those variables.
const preloadSource = "src/lib/server/config/preloadEnv.js"
const preloadTarget = "build/preloadEnv.js"
if (fs.existsSync(preloadSource)) {
	fs.copyFileSync(preloadSource, preloadTarget)
	if (!content.startsWith("import './preloadEnv.js';")) {
		content = `import './preloadEnv.js';\n${content}`
	}
	console.log("🔐 Env preload wired into build/index.js")
} else {
	console.warn(
		`⚠️  ${preloadSource} not found — .env will not be applied before the server framework reads its configuration.`
	)
}

fs.writeFileSync(buildFile, content)
console.log("✅ Server build output customized successfully!")
