// this file is generated — do not edit it

/// <reference types="@sveltejs/kit" />

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are limited to _private_ access.
 *
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 *
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 *
 * **_Private_ access:**
 *
 * - This module cannot be imported into client-side code
 * - This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 *
 * For example, given the following build time environment:
 *
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 *
 * With the default `publicPrefix` and `privatePrefix`:
 *
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/private';
 *
 * console.log(ENVIRONMENT); // => "production"
 * console.log(PUBLIC_BASE_URL); // => throws error during build
 * ```
 *
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module "$env/static/private" {
	export const GJS_DEBUG_TOPICS: string
	export const LESSOPEN: string
	export const VSCODE_CWD: string
	export const VSCODE_ESM_ENTRYPOINT: string
	export const AI_AGENT: string
	export const USER: string
	export const CLAUDE_CODE_ENTRYPOINT: string
	export const VSCODE_NLS_CONFIG: string
	export const npm_config_user_agent: string
	export const GIT_EDITOR: string
	export const VSCODE_HANDLES_UNCAUGHT_ERRORS: string
	export const XDG_SESSION_TYPE: string
	export const npm_node_execpath: string
	export const CLAUDE_AGENT_SDK_VERSION: string
	export const CLUTTER_DISABLE_MIPMAPPED_TEXT: string
	export const SHLVL: string
	export const npm_config_noproxy: string
	export const HOME: string
	export const CHROME_DESKTOP: string
	export const DESKTOP_SESSION: string
	export const NVM_BIN: string
	export const npm_package_json: string
	export const NVM_INC: string
	export const VSCODE_IPC_HOOK: string
	export const GIO_LAUNCHED_DESKTOP_FILE: string
	export const npm_package_engines_node: string
	export const GNOME_SHELL_SESSION_MODE: string
	export const GTK_MODULES: string
	export const CLAUDE_CODE_CHILD_SESSION: string
	export const COPILOT_OTEL_FILE_EXPORTER_PATH: string
	export const MANAGERPID: string
	export const npm_config_userconfig: string
	export const npm_config_local_prefix: string
	export const SYSTEMD_EXEC_PID: string
	export const GSM_SKIP_SSH_AGENT_WORKAROUND: string
	export const DBUS_SESSION_BUS_ADDRESS: string
	export const npm_config_engine_strict: string
	export const GIO_LAUNCHED_DESKTOP_FILE_PID: string
	export const COLOR: string
	export const NVM_DIR: string
	export const VSCODE_CRASH_REPORTER_PROCESS_TYPE: string
	export const VSCODE_L10N_BUNDLE_LOCATION: string
	export const APPLICATION_INSIGHTS_NO_STATSBEAT: string
	export const LOGNAME: string
	export const JOURNAL_STREAM: string
	export const _: string
	export const npm_config_prefix: string
	export const npm_config_npm_version: string
	export const MEMORY_PRESSURE_WATCH: string
	export const XDG_SESSION_CLASS: string
	export const USERNAME: string
	export const npm_config_cache: string
	export const GNOME_DESKTOP_SESSION_ID: string
	export const FC_FONTATIONS: string
	export const WINDOWPATH: string
	export const MCP_CONNECTION_NONBLOCKING: string
	export const npm_config_node_gyp: string
	export const PATH: string
	export const SESSION_MANAGER: string
	export const INVOCATION_ID: string
	export const GTK3_MODULES: string
	export const NODE: string
	export const npm_package_name: string
	export const COREPACK_ENABLE_AUTO_PIN: string
	export const XDG_MENU_PREFIX: string
	export const XDG_RUNTIME_DIR: string
	export const GDK_BACKEND: string
	export const CLAUDE_EFFORT: string
	export const DISPLAY: string
	export const NoDefaultCurrentDirectoryInExePath: string
	export const LANG: string
	export const XDG_CURRENT_DESKTOP: string
	export const XMODIFIERS: string
	export const XDG_SESSION_DESKTOP: string
	export const XAUTHORITY: string
	export const npm_lifecycle_script: string
	export const SSH_AUTH_SOCK: string
	export const SHELL: string
	export const MXC_BIN_DIR: string
	export const npm_package_version: string
	export const npm_lifecycle_event: string
	export const QT_ACCESSIBILITY: string
	export const ELECTRON_RUN_AS_NODE: string
	export const GDMSESSION: string
	export const CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: string
	export const CLAUDE_CODE_SESSION_ID: string
	export const LESSCLOSE: string
	export const CLAUDECODE: string
	export const GPG_AGENT_INFO: string
	export const GJS_DEBUG_OUTPUT: string
	export const QT_IM_MODULE: string
	export const npm_config_globalconfig: string
	export const npm_config_init_module: string
	export const PWD: string
	export const npm_execpath: string
	export const XDG_CONFIG_DIRS: string
	export const VSCODE_CODE_CACHE_PATH: string
	export const ANDROID_HOME: string
	export const XDG_DATA_DIRS: string
	export const CLAUDE_CODE_EXECPATH: string
	export const npm_config_global_prefix: string
	export const npm_command: string
	export const CLAUDE_CODE_ENABLE_TASKS: string
	export const COPILOT_CLI_ENABLED_FEATURE_FLAGS: string
	export const MEMORY_PRESSURE_WRITE: string
	export const VSCODE_PID: string
	export const INIT_CWD: string
	export const EDITOR: string
	export const TEST: string
	export const VITEST: string
	export const NODE_ENV: string
	export const PROD: string
	export const DEV: string
	export const BASE_URL: string
	export const MODE: string
}

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are _publicly_ accessible.
 *
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 *
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 *
 * **_Public_ access:**
 *
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 *
 * For example, given the following build time environment:
 *
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 *
 * With the default `publicPrefix` and `privatePrefix`:
 *
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/public';
 *
 * console.log(ENVIRONMENT); // => throws error during build
 * console.log(PUBLIC_BASE_URL); // => "http://site.com"
 * ```
 *
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module "$env/static/public" {}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are limited to _private_ access.
 *
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 *
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 *
 * **_Private_ access:**
 *
 * - This module cannot be imported into client-side code
 * - This module includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 *
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 *
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 *
 * For example, given the following runtime environment:
 *
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 *
 * With the default `publicPrefix` and `privatePrefix`:
 *
 * ```ts
 * import { env } from '$env/dynamic/private';
 *
 * console.log(env.ENVIRONMENT); // => "production"
 * console.log(env.PUBLIC_BASE_URL); // => undefined
 * ```
 */
declare module "$env/dynamic/private" {
	export const env: {
		GJS_DEBUG_TOPICS: string
		LESSOPEN: string
		VSCODE_CWD: string
		VSCODE_ESM_ENTRYPOINT: string
		AI_AGENT: string
		USER: string
		CLAUDE_CODE_ENTRYPOINT: string
		VSCODE_NLS_CONFIG: string
		npm_config_user_agent: string
		GIT_EDITOR: string
		VSCODE_HANDLES_UNCAUGHT_ERRORS: string
		XDG_SESSION_TYPE: string
		npm_node_execpath: string
		CLAUDE_AGENT_SDK_VERSION: string
		CLUTTER_DISABLE_MIPMAPPED_TEXT: string
		SHLVL: string
		npm_config_noproxy: string
		HOME: string
		CHROME_DESKTOP: string
		DESKTOP_SESSION: string
		NVM_BIN: string
		npm_package_json: string
		NVM_INC: string
		VSCODE_IPC_HOOK: string
		GIO_LAUNCHED_DESKTOP_FILE: string
		npm_package_engines_node: string
		GNOME_SHELL_SESSION_MODE: string
		GTK_MODULES: string
		CLAUDE_CODE_CHILD_SESSION: string
		COPILOT_OTEL_FILE_EXPORTER_PATH: string
		MANAGERPID: string
		npm_config_userconfig: string
		npm_config_local_prefix: string
		SYSTEMD_EXEC_PID: string
		GSM_SKIP_SSH_AGENT_WORKAROUND: string
		DBUS_SESSION_BUS_ADDRESS: string
		npm_config_engine_strict: string
		GIO_LAUNCHED_DESKTOP_FILE_PID: string
		COLOR: string
		NVM_DIR: string
		VSCODE_CRASH_REPORTER_PROCESS_TYPE: string
		VSCODE_L10N_BUNDLE_LOCATION: string
		APPLICATION_INSIGHTS_NO_STATSBEAT: string
		LOGNAME: string
		JOURNAL_STREAM: string
		_: string
		npm_config_prefix: string
		npm_config_npm_version: string
		MEMORY_PRESSURE_WATCH: string
		XDG_SESSION_CLASS: string
		USERNAME: string
		npm_config_cache: string
		GNOME_DESKTOP_SESSION_ID: string
		FC_FONTATIONS: string
		WINDOWPATH: string
		MCP_CONNECTION_NONBLOCKING: string
		npm_config_node_gyp: string
		PATH: string
		SESSION_MANAGER: string
		INVOCATION_ID: string
		GTK3_MODULES: string
		NODE: string
		npm_package_name: string
		COREPACK_ENABLE_AUTO_PIN: string
		XDG_MENU_PREFIX: string
		XDG_RUNTIME_DIR: string
		GDK_BACKEND: string
		CLAUDE_EFFORT: string
		DISPLAY: string
		NoDefaultCurrentDirectoryInExePath: string
		LANG: string
		XDG_CURRENT_DESKTOP: string
		XMODIFIERS: string
		XDG_SESSION_DESKTOP: string
		XAUTHORITY: string
		npm_lifecycle_script: string
		SSH_AUTH_SOCK: string
		SHELL: string
		MXC_BIN_DIR: string
		npm_package_version: string
		npm_lifecycle_event: string
		QT_ACCESSIBILITY: string
		ELECTRON_RUN_AS_NODE: string
		GDMSESSION: string
		CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: string
		CLAUDE_CODE_SESSION_ID: string
		LESSCLOSE: string
		CLAUDECODE: string
		GPG_AGENT_INFO: string
		GJS_DEBUG_OUTPUT: string
		QT_IM_MODULE: string
		npm_config_globalconfig: string
		npm_config_init_module: string
		PWD: string
		npm_execpath: string
		XDG_CONFIG_DIRS: string
		VSCODE_CODE_CACHE_PATH: string
		ANDROID_HOME: string
		XDG_DATA_DIRS: string
		CLAUDE_CODE_EXECPATH: string
		npm_config_global_prefix: string
		npm_command: string
		CLAUDE_CODE_ENABLE_TASKS: string
		COPILOT_CLI_ENABLED_FEATURE_FLAGS: string
		MEMORY_PRESSURE_WRITE: string
		VSCODE_PID: string
		INIT_CWD: string
		EDITOR: string
		TEST: string
		VITEST: string
		NODE_ENV: string
		PROD: string
		DEV: string
		BASE_URL: string
		MODE: string
		[key: `PUBLIC_${string}`]: undefined
		[key: `${string}`]: string | undefined
	}
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are _publicly_ accessible.
 *
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 *
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 *
 * **_Public_ access:**
 *
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 *
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 *
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 *
 * For example, given the following runtime environment:
 *
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://example.com
 * ```
 *
 * With the default `publicPrefix` and `privatePrefix`:
 *
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.ENVIRONMENT); // => undefined, not public
 * console.log(env.PUBLIC_BASE_URL); // => "http://example.com"
 * ```
 *
 * ```
 *
 * ```
 */
declare module "$env/dynamic/public" {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined
	}
}
