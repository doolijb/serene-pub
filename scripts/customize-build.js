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

/**
 * Patch the build, or fail the build trying.
 *
 * Every rewrite here targets code this repo doesn't own — @sveltejs/adapter-node's
 * generated index.js — so an upstream release that rewords a line turns the
 * matching regex into a silent no-op. That is exactly how browser auto-launch
 * (and the startup banner) stopped shipping: adapter-node changed
 *   console.log(`Listening on ${path || `http://${host}:${port}`}`)
 * to
 *   console.log(`Listening on ${format_listening_address(path, host, port, ...)}`)
 * in a semver-minor release, package.json floats on ^5.2.12 with no lockfile,
 * and nothing here checked whether the replace had actually matched. A
 * zero-match replace is indistinguishable from a successful one unless you
 * look, so look — and fail the build, loudly, rather than quietly shipping a
 * server that's missing the feature.
 */
function replaceOrFail(pattern, replacement, label) {
	// Counted against a global clone: a non-global pattern's .match() returns
	// capture groups, not occurrences, which would report a bogus count.
	const matches = [
		...content.matchAll(
			new RegExp(pattern.source, pattern.flags.replace("g", "") + "g")
		)
	]
	if (matches.length === 0) {
		console.error(`❌ ${label}: no match for ${pattern}`)
		console.error(
			"   The generated server no longer contains the code this patch targets —"
		)
		console.error(
			"   most likely @sveltejs/adapter-node changed its output. Update the"
		)
		console.error("   pattern in scripts/customize-build.js to match.")
		process.exit(1)
	}
	content = content.replace(pattern, replacement)
	console.log(
		`✅ ${label} (${matches.length} match${matches.length > 1 ? "es" : ""})`
	)
}

replaceOrFail(
	/console\.log\(`Listening on file descriptor/g,
	"console.log(`🚀 Serene Pub listening on file descriptor",
	"Branded the file-descriptor listening message"
)

// Brand the network listening message AND hang the banner + auto-open off it,
// in one pass. These used to be two chained replaces, the second matching the
// first's output — which meant one upstream reword silently disabled both.
//
// Matching the whole statement by its stable prefix (`Listening on ${`) and
// its line ending, rather than by the interpolation's exact contents, is what
// makes this survive adapter-node rewording the address expression. The
// socket-activation branch's message reads `Listening on file descriptor ${…}`
// — literal text before the interpolation — so it can't collide with this.
replaceOrFail(
	/^([ \t]*)console\.log\(`Listening on (\$\{.*\})`\);$/m,
	`$1console.log(\`🚀 Serene Pub listening on $2\`);
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
		}`,
	"Branded the listening message and injected the startup banner + browser auto-open"
)

replaceOrFail(
	/function graceful_shutdown\(reason\) \{/g,
	"function graceful_shutdown(reason) {\n\tconsole.log(`👋 Serene Pub shutting down (${reason})`);",
	"Added the shutdown message"
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
