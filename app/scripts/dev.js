/**
 * WebArcade Dev Server
 *
 * Watches for file changes and triggers rebuilds + browser refresh.
 *
 * Watches:
 * - src/           → rebuild frontend → refresh
 * - plugins/       → rebuild plugin → refresh
 * - app/plugins/   → just refresh (already built)
 */

import * as esbuild from 'esbuild';
import { transformAsync } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const WEBARCADE_PKG = resolve(ROOT, 'node_modules/webarcade/src');
const SRC = resolve(WEBARCADE_PKG, 'app');
const DIST = resolve(ROOT, 'app/dist');
const PLUGINS_SRC = resolve(ROOT, 'plugins');
const PLUGINS_BUILT = resolve(ROOT, 'app/plugins');
const CONFIG_FILE = resolve(ROOT, 'webarcade.config.json');

// Colors for console output
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// ============================================================================
// WebSocket Server for live reload
// ============================================================================

const WS_PORT = 3002;
let wsServer;
let clients = new Set();

function startWebSocketServer() {
    wsServer = new WebSocketServer({ port: WS_PORT });

    wsServer.on('connection', (ws) => {
        clients.add(ws);
        ws.on('close', () => clients.delete(ws));
    });

    console.log(`${green('✓')} Live reload server on ws://localhost:${WS_PORT}`);
}

function triggerReload() {
    const msg = JSON.stringify({ type: 'reload' });
    for (const client of clients) {
        if (client.readyState === 1) { // OPEN
            client.send(msg);
        }
    }
}

// ============================================================================
// esbuild setup (same as build.js but with watch hooks)
// ============================================================================

function createSolidPlugin() {
    return {
        name: 'solid',
        setup(build) {
            build.onLoad({ filter: /\.(jsx|tsx)$/ }, async (args) => {
                const source = readFileSync(args.path, 'utf8');
                const result = await transformAsync(source, {
                    filename: args.path,
                    presets: [[solidPreset, { generate: 'dom', hydratable: false }]],
                });
                return { contents: result.code, loader: 'js' };
            });
        },
    };
}

function createCssPlugin() {
    return {
        name: 'css',
        setup(build) {
            const cssFiles = new Map();

            build.onLoad({ filter: /\.css$/ }, async (args) => {
                const source = readFileSync(args.path, 'utf8');
                const result = await postcss([
                    tailwindcss(),
                    { postcssPlugin: 'remove-comments', Once(root) { root.walkComments(c => c.remove()); } }
                ]).process(source, { from: args.path });
                cssFiles.set(args.path, result.css);
                return { contents: `/* CSS: ${basename(args.path)} */`, loader: 'js' };
            });

            build.onEnd(async () => {
                if (cssFiles.size > 0) {
                    const combinedCss = Array.from(cssFiles.values()).join('\n');
                    mkdirSync(resolve(DIST, 'assets'), { recursive: true });
                    writeFileSync(resolve(DIST, 'assets/styles.css'), combinedCss);
                }
            });
        },
    };
}

let isBuilding = false;
let pendingBuild = false;

async function buildFrontend() {
    if (isBuilding) {
        pendingBuild = true;
        return;
    }

    isBuilding = true;
    const startTime = Date.now();

    try {
        // Clean dist
        mkdirSync(resolve(DIST, 'assets'), { recursive: true });

        const result = await esbuild.build({
            entryPoints: [resolve(SRC, 'entry-client.jsx')],
            bundle: true,
            outfile: resolve(DIST, 'assets', 'app.js'),
            format: 'esm',
            minify: false,
            sourcemap: false,
            metafile: true,
            target: ['es2020'],
            define: {
                'process.env.NODE_ENV': '"development"',
                'import.meta.env.DEV': 'true',
                'import.meta.env.PROD': 'false',
                '__DEV__': 'true',
            },
            alias: { '@': WEBARCADE_PKG },
            plugins: [createSolidPlugin(), createCssPlugin()],
            loader: {
                '.js': 'js', '.json': 'json',
                '.png': 'file', '.jpg': 'file', '.svg': 'file',
            },
            logLevel: 'warning',
        });

        // Process CSS
        const cssEntries = [resolve(SRC, 'index.css'), resolve(SRC, 'base.css')].filter(existsSync);
        if (cssEntries.length > 0) {
            let combinedCss = '';
            for (const cssFile of cssEntries) {
                const source = readFileSync(cssFile, 'utf8');
                const processed = await postcss([tailwindcss()]).process(source, { from: cssFile });
                combinedCss += processed.css + '\n';
            }
            writeFileSync(resolve(DIST, 'assets/styles.css'), combinedCss);
        }

        // Generate HTML with live reload script and cache busting
        const outputs = Object.keys(result.metafile.outputs)
            .filter(f => f.endsWith('.js'))
            .map(f => relative(DIST, f).replace(/\\/g, '/'));
        const entryFile = outputs.find(f => f.includes('app')) || outputs[0];
        const cacheBuster = Date.now();

        const liveReloadScript = `
    <script>
      (function() {
        const ws = new WebSocket('ws://localhost:${WS_PORT}');
        ws.onmessage = () => location.reload();
        ws.onclose = () => setTimeout(() => location.reload(), 1000);
      })();
    </script>`;

        const template = readFileSync(resolve(SRC, 'index.html'), 'utf8');
        const html = template
            .replace('<!--app-head-->', `<link rel="stylesheet" href="/assets/styles.css?v=${cacheBuster}">`)
            .replace('<!--app-html-->', '')
            .replace('</body>', `${liveReloadScript}\n    <script type="module" src="/${entryFile}?v=${cacheBuster}"></script>\n  </body>`);
        writeFileSync(resolve(DIST, 'index.html'), html);

        const elapsed = Date.now() - startTime;
        console.log(`${green('✓')} Frontend rebuilt ${dim(`(${elapsed}ms)`)}`);

    } catch (err) {
        console.error(`${yellow('✗')} Build error:`, err.message);
    } finally {
        isBuilding = false;
        if (pendingBuild) {
            pendingBuild = false;
            buildFrontend();
        }
    }
}

// ============================================================================
// Plugin builder
// ============================================================================

async function buildPlugin(pluginId) {
    console.log(`${cyan('→')} Building plugin: ${pluginId}`);

    return new Promise((resolve) => {
        const proc = spawn('webarcade', ['build', pluginId], {
            cwd: ROOT,
            shell: true,
            stdio: 'inherit'
        });

        proc.on('close', (code) => {
            if (code === 0) {
                console.log(`${green('✓')} Plugin built: ${pluginId}`);
            } else {
                console.log(`${yellow('✗')} Plugin build failed: ${pluginId}`);
            }
            resolve();
        });
    });
}

// ============================================================================
// File watchers with batched builds
// ============================================================================

function startWatchers() {
    // Batch all changes together, then build everything at once
    let pendingChanges = {
        frontendFiles: new Set(),
        pluginIds: new Set(),
        builtPluginFiles: new Set()
    };
    let batchTimer = null;
    const BATCH_DELAY = 400; // Wait 400ms for all related changes to come in

    const knownPlugins = new Set(
        existsSync(PLUGINS_SRC)
            ? readdirSync(PLUGINS_SRC).filter(f => {
                const stat = require('fs').statSync(resolve(PLUGINS_SRC, f));
                return stat.isDirectory();
            })
            : []
    );

    const knownBuiltPlugins = new Set(
        existsSync(PLUGINS_BUILT)
            ? readdirSync(PLUGINS_BUILT).filter(f => f.endsWith('.js'))
            : []
    );

    const rescanPlugins = async () => {
        try {
            console.log(`${cyan('→')} Rescanning plugins...`);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            await fetch('http://localhost:3001/api/plugins/rescan', { signal: controller.signal });
            clearTimeout(timeout);
            console.log(`${green('✓')} Plugins rescanned`);
        } catch (e) {
            console.log(`${dim('  (rescan skipped)')}`);
        }
    };

    const processBatch = async () => {
        const { frontendFiles, pluginIds, builtPluginFiles } = pendingChanges;

        // Reset pending changes
        pendingChanges = {
            frontendFiles: new Set(),
            pluginIds: new Set(),
            builtPluginFiles: new Set()
        };

        let needsReload = false;
        let needsRescan = false;

        // Build all changed plugins first
        for (const pluginId of pluginIds) {
            const isNewPlugin = !knownPlugins.has(pluginId);
            console.log(`${cyan('→')} Plugin source changed: ${pluginId}${isNewPlugin ? ' (new)' : ''}`);
            await buildPlugin(pluginId);

            if (isNewPlugin) {
                knownPlugins.add(pluginId);
                needsRescan = true;
            }
            needsReload = true;
        }

        // Check for new built plugins
        for (const filename of builtPluginFiles) {
            if (!knownBuiltPlugins.has(filename)) {
                console.log(`${cyan('→')} New built plugin detected: ${filename}`);
                knownBuiltPlugins.add(filename);
                needsRescan = true;
            }
            needsReload = true;
        }

        // Rescan if needed (before frontend build so layout can reference new plugins)
        if (needsRescan) {
            await rescanPlugins();
        }

        // Rebuild frontend if any src files changed
        if (frontendFiles.size > 0) {
            for (const path of frontendFiles) {
                console.log(`${cyan('→')} Changed: ${relative(ROOT, path)}`);
            }
            await buildFrontend();
            needsReload = true;
        }

        // Single reload after all builds complete
        if (needsReload) {
            triggerReload();
        }
    };

    const scheduleBatch = () => {
        clearTimeout(batchTimer);
        batchTimer = setTimeout(processBatch, BATCH_DELAY);
    };

    // Note: No src/ watcher needed - framework code is in node_modules/webarcade
    // To modify the framework, update the package and reinstall

    // Watch plugins/ source - rebuild plugin
    const pluginsSrcWatcher = chokidar.watch(PLUGINS_SRC, {
        ignored: /node_modules/,
        persistent: true,
        ignoreInitial: true,
        depth: 2,
    });

    pluginsSrcWatcher.on('change', (path) => {
        const relPath = relative(PLUGINS_SRC, path);
        const pluginId = relPath.split(/[/\\]/)[0];
        pendingChanges.pluginIds.add(pluginId);
        scheduleBatch();
    });
    pluginsSrcWatcher.on('add', (path) => {
        const relPath = relative(PLUGINS_SRC, path);
        const pluginId = relPath.split(/[/\\]/)[0];
        pendingChanges.pluginIds.add(pluginId);
        scheduleBatch();
    });
    console.log(`${green('✓')} Watching plugins/`);

    // Watch app/plugins/ - rescan on new files, refresh on changes
    const pluginsBuiltWatcher = chokidar.watch(PLUGINS_BUILT, {
        ignored: /\.dll$/,
        persistent: true,
        ignoreInitial: true,
    });

    pluginsBuiltWatcher.on('change', (path) => {
        const filename = basename(path);
        if (filename.endsWith('.js')) {
            console.log(`${cyan('→')} Built plugin changed: ${filename}`);
            pendingChanges.builtPluginFiles.add(filename);
            scheduleBatch();
        }
    });
    pluginsBuiltWatcher.on('add', (path) => {
        const filename = basename(path);
        if (filename.endsWith('.js')) {
            pendingChanges.builtPluginFiles.add(filename);
            scheduleBatch();
        }
    });
    console.log(`${green('✓')} Watching app/plugins/`);

    // Watch webarcade.config.json - rescan plugins on change
    if (existsSync(CONFIG_FILE)) {
        const configWatcher = chokidar.watch(CONFIG_FILE, {
            persistent: true,
            ignoreInitial: true,
        });

        configWatcher.on('change', async () => {
            console.log(`${cyan('→')} Config changed: webarcade.config.json`);
            await rescanPlugins();
            triggerReload();
        });
        console.log(`${green('✓')} Watching webarcade.config.json`);
    }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    console.log();
    console.log(cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(cyan('  WebArcade Dev Server'));
    console.log(cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log();

    // Initial build
    console.log(`${cyan('→')} Initial build...`);
    await buildFrontend();
    console.log();

    // Start servers and watchers
    startWebSocketServer();
    startWatchers();

    console.log();
    console.log(`${green('✓')} Dev server ready - watching for changes`);
    console.log(dim('  Press Ctrl+C to stop'));
    console.log();
}

main().catch(console.error);
