#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const buildFile = 'build/index.js';

if (!fs.existsSync(buildFile)) {
    console.log('Build file not found:', buildFile);
    process.exit(1);
}

console.log('🔧 Customizing server build output...');

let content = fs.readFileSync(buildFile, 'utf8');

// Debug: Check what patterns exist in the file
console.log('Looking for patterns in the file...');
console.log('Contains "Listening on file descriptor":', content.includes('Listening on file descriptor'));
console.log('Contains "Listening on ${path":', content.includes('Listening on ${path'));

// Replace console.log messages
let replacements = 0;

const originalListeningFd = content;
content = content.replace(
    /console\.log\(`Listening on file descriptor/g,
    'console.log(`🚀 Serene Pub listening on file descriptor'
);
if (content !== originalListeningFd) {
    replacements++;
    console.log('✅ Replaced file descriptor listening message');
}

const originalListeningPath = content;
content = content.replace(
    /console\.log\(`Listening on \$\{path/g,
    'console.log(`🚀 Serene Pub listening on ${path'
);
if (content !== originalListeningPath) {
    replacements++;
    console.log('✅ Replaced path listening message');
}

console.log(`Applied ${replacements} basic replacements`);

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
			if (process.env.SERENE_AUTO_OPEN !== 'false') {
				setTimeout(() => {
					import('open').then(({ default: open }) => {
						open(\`http://localhost:\${port}\`);
						console.log(\`🚀 Opening Serene Pub in your default browser...\`);
					}).catch(() => {
						// Silently fail if 'open' package is not available
					});
				}, 1000);
			}
		}`
);

// Add shutdown message - fix the function call pattern
content = content.replace(
    /function graceful_shutdown\(reason\) \{/g,
    'function graceful_shutdown(reason) {\n\tconsole.log(`👋 Serene Pub shutting down (${reason})`);'
);

fs.writeFileSync(buildFile, content);
console.log('✅ Server build output customized successfully!');
