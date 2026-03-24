import * as esbuild from 'esbuild';
import { transformAsync } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import cssnano from 'cssnano';
import swc from '@swc/core';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, rmSync } from 'fs';
import { resolve, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const APP = resolve(ROOT, 'app');
const isProduction = process.env.NODE_ENV === 'production';

// ============================================================================
// ICON GENERATION - converts PNG to ICO for Windows executable
// ============================================================================
async function generateIcon() {
  const pngPath = resolve(APP, 'icon.png');
  const icoPath = resolve(APP, 'icon.ico');

  // Skip if no PNG source
  if (!existsSync(pngPath)) {
    console.log('   ⚠️  No icon.png found in app/ - skipping icon generation');
    return;
  }

  // Skip if ICO already exists and is newer than PNG
  if (existsSync(icoPath)) {
    const pngStat = Bun.file(pngPath);
    const icoStat = Bun.file(icoPath);
    const pngTime = (await pngStat.stat()).mtime;
    const icoTime = (await icoStat.stat()).mtime;
    if (icoTime > pngTime) {
      console.log('   ✓ icon.ico is up to date');
      return;
    }
  }

  console.log('   🎨 Generating icon.ico from icon.png...');
  const pngBuffer = readFileSync(pngPath);
  const icoBuffer = await pngToIco(pngBuffer);
  writeFileSync(icoPath, icoBuffer);
  console.log('   ✅ icon.ico generated');
}

// Custom plugin for SolidJS JSX transformation
function createSolidPlugin() {
  return {
    name: 'solid',
    setup(build) {
      build.onLoad({ filter: /\.(jsx|tsx)$/ }, async (args) => {
        const source = readFileSync(args.path, 'utf8');
        const result = await transformAsync(source, {
          filename: args.path,
          presets: [
            [solidPreset, {
              generate: 'dom',
              hydratable: false,
            }]
          ],
        });
        return { contents: result.code, loader: 'js' };
      });
    },
  };
}

// Custom plugin for CSS with PostCSS/Tailwind
function createCssPlugin(distDir) {
  return {
    name: 'css',
    setup(build) {
      const cssFiles = new Map();

      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const source = readFileSync(args.path, 'utf8');
        const result = await postcss([
          tailwindcss(),
          {
            postcssPlugin: 'remove-comments',
            Once(root) {
              root.walkComments(comment => comment.remove());
            }
          }
        ]).process(source, { from: args.path });

        cssFiles.set(args.path, result.css);
        return { contents: `/* CSS: ${basename(args.path)} */`, loader: 'js' };
      });

      build.onEnd(async () => {
        if (cssFiles.size > 0) {
          const combinedCss = Array.from(cssFiles.values()).join('\n');
          const cssPath = resolve(distDir, 'assets/styles.css');
          mkdirSync(dirname(cssPath), { recursive: true });
          writeFileSync(cssPath, combinedCss);
        }
      });
    },
  };
}

// ============================================================================
// APP BUILD - builds the main WebArcade application
// ============================================================================
async function buildApp() {
  const WEBARCADE_PKG = resolve(ROOT, 'node_modules/webarcade/src');
  const SRC = resolve(WEBARCADE_PKG, 'app');
  const DIST = resolve(ROOT, 'app/dist');
  const PUBLIC = resolve(ROOT, 'public');

  const startTime = Date.now();
  console.log(`\n📦 Building WebArcade (${isProduction ? 'production' : 'development'})...\n`);

  // Clean and prepare
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(resolve(DIST, 'assets'), { recursive: true });

  // Build with esbuild (no minification - SWC handles that)
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
      'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
      'import.meta.env.DEV': JSON.stringify(!isProduction),
      'import.meta.env.PROD': JSON.stringify(isProduction),
      'import.meta.env.MODE': JSON.stringify(isProduction ? 'production' : 'development'),
      '__DEV__': JSON.stringify(!isProduction),
      'import.meta.hot': 'undefined',
    },
    drop: isProduction ? ['console', 'debugger'] : [],
    alias: { '@': WEBARCADE_PKG },
    plugins: [createSolidPlugin(), createCssPlugin(DIST)],
    loader: {
      '.js': 'js', '.json': 'json',
      '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.gif': 'file', '.svg': 'file',
      '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.eot': 'file',
    },
    logLevel: 'warning',
  });

  // Minify JS with SWC in production
  if (isProduction) {
    for (const [filePath, info] of Object.entries(result.metafile.outputs)) {
      if (filePath.endsWith('.js')) {
        const fullPath = resolve(filePath);
        const code = readFileSync(fullPath, 'utf8');
        const minified = await swc.minify(code, {
          compress: {
            dead_code: true,
            drop_console: true,
            drop_debugger: true,
            unused: true,
            collapse_vars: true,
            reduce_vars: true,
            join_vars: true,
            passes: 2,
          },
          mangle: { toplevel: true },
          module: true,
        });
        writeFileSync(fullPath, minified.code);
      }
    }
  }

  // Process CSS with cssnano in production
  const cssEntries = [resolve(SRC, 'index.css'), resolve(SRC, 'base.css')].filter(existsSync);
  let cssOutput = null;

  if (cssEntries.length > 0) {
    let combinedCss = '';
    for (const cssFile of cssEntries) {
      const source = readFileSync(cssFile, 'utf8');
      const plugins = [tailwindcss()];
      if (isProduction) {
        plugins.push(cssnano({ preset: ['default', { discardComments: { removeAll: true } }] }));
      }
      const processed = await postcss(plugins).process(source, { from: cssFile });
      combinedCss += processed.css + '\n';
    }
    const cssFilename = isProduction ? `styles-${Date.now().toString(36)}.css` : 'styles.css';
    writeFileSync(resolve(DIST, 'assets', cssFilename), combinedCss);
    cssOutput = `assets/${cssFilename}`;
  }

  // Generate HTML
  const outputs = Object.keys(result.metafile.outputs)
    .filter(f => f.endsWith('.js'))
    .map(f => relative(DIST, f).replace(/\\/g, '/'));
  const entryFile = outputs.find(f => f.includes('app')) || outputs[0];

  const template = readFileSync(resolve(SRC, 'index.html'), 'utf8');
  const html = template
    .replace('<!--app-head-->', cssOutput ? `<link rel="stylesheet" href="/${cssOutput}">` : '')
    .replace('<!--app-html-->', '')
    .replace('</body>', `    <script type="module" src="/${entryFile}"></script>\n  </body>`);
  writeFileSync(resolve(DIST, 'index.html'), html);

  // Copy public folder
  if (existsSync(PUBLIC)) {
    for (const file of readdirSync(PUBLIC)) {
      if (!file.startsWith('.')) cpSync(resolve(PUBLIC, file), resolve(DIST, file), { recursive: true });
    }
  }

  // Calculate final sizes
  let totalJs = 0;
  for (const [filePath] of Object.entries(result.metafile.outputs)) {
    if (filePath.endsWith('.js')) {
      const size = readFileSync(resolve(filePath)).length;
      totalJs += size;
      console.log(`   ${relative(DIST, filePath)}: ${(size / 1024).toFixed(1)} KB`);
    }
  }

  // Generate icon for Windows executable
  await generateIcon();

  const elapsed = Date.now() - startTime;
  console.log(`\n✅ Build complete in ${elapsed}ms`);
  console.log(`   Output: ${DIST}`);
  console.log(`   Total JS: ${(totalJs / 1024).toFixed(1)} KB\n`);
}

// ============================================================================
// PLUGIN BUILD - builds a single plugin for the CLI
// ============================================================================

// Extract export names from a JS/JSX file by parsing export statements
function extractExportsFromFile(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8');
  const exports = new Set();

  // Match: export { foo, bar, baz }
  const reExportBraces = /export\s*\{([^}]+)\}/g;
  let match;
  while ((match = reExportBraces.exec(content)) !== null) {
    match[1].split(',').forEach(e => {
      const name = e.trim().split(/\s+as\s+/).pop().trim();
      if (name && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) exports.add(name);
    });
  }

  // Match: export function foo, export const foo, export class foo
  const reExportDecl = /export\s+(?:const|let|var|function|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = reExportDecl.exec(content)) !== null) {
    exports.add(match[1]);
  }

  // Match: export * from './file' - recursively get those exports
  const reExportStar = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
  while ((match = reExportStar.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.')) {
      const dir = dirname(filePath);
      let resolved = resolve(dir, importPath);
      // Try common extensions
      for (const ext of ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx']) {
        if (existsSync(resolved + ext)) {
          resolved = resolved + ext;
          break;
        }
      }
      if (existsSync(resolved)) {
        extractExportsFromFile(resolved).forEach(e => exports.add(e));
      }
    }
  }

  return [...exports];
}

// Plugin to rewrite external imports to window globals (ESM style)
function createExternalsPlugin() {
  // Auto-discover exports from packages
  const discoverExports = (pkgName, entryFile) => {
    const pkgPath = resolve(ROOT, 'node_modules', pkgName, entryFile);
    return existsSync(pkgPath) ? extractExportsFromFile(pkgPath) : [];
  };

  // Cache discovered exports
  const exportCache = {
    'webarcade': discoverExports('webarcade', 'src/index.js'),
    'solid-js': discoverExports('solid-js', 'dist/solid.js'),
    'solid-js/web': discoverExports('solid-js', 'web/dist/web.js'),
    'solid-js/store': discoverExports('solid-js', 'store/dist/store.js'),
  };

  return {
    name: 'externals-to-globals',
    setup(build) {
      // Map external modules to their window global names
      const externals = {
        'solid-js': 'SolidJS',
        'solid-js/web': 'SolidJSWeb',
        'solid-js/store': 'SolidJSStore',
        'webarcade': 'WebArcadeAPI',
        'webarcade/plugin': 'WebArcadeAPI',
        'webarcade/layout': 'WebArcadeAPI',
        'webarcade/hooks': 'WebArcadeAPI',
        'webarcade/ui': 'WebArcadeAPI',
      };

      // Handle each external module
      for (const [moduleName, globalName] of Object.entries(externals)) {
        const filter = new RegExp(`^${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
        build.onResolve({ filter }, args => ({
          path: args.path,
          namespace: 'external-global',
          pluginData: { globalName, moduleName }
        }));
      }

      // Return ESM that re-exports from window global
      build.onLoad({ filter: /.*/, namespace: 'external-global' }, args => {
        const g = args.pluginData.globalName;
        const m = args.pluginData.moduleName;

        // Get exports - use webarcade exports for all webarcade/* subpaths
        let knownExports;
        if (m.startsWith('webarcade')) {
          knownExports = exportCache['webarcade'];
        } else {
          knownExports = exportCache[m] || [];
        }

        const exportStatements = knownExports.map(e => `export var ${e} = m.${e};`).join(' ');

        return {
          contents: `var m = window.${g}; export default m; ${exportStatements}`,
          loader: 'js'
        };
      });
    }
  };
}

async function buildPlugin(pluginDir, outputDir) {
  const pluginName = basename(pluginDir);
  const indexPath = existsSync(resolve(pluginDir, 'index.jsx'))
    ? resolve(pluginDir, 'index.jsx')
    : resolve(pluginDir, 'index.js');

  if (!existsSync(indexPath)) {
    console.log(`No frontend files found for ${pluginName}`);
    return;
  }

  console.log(`   📦 Bundling frontend for ${pluginName}...`);
  mkdirSync(outputDir, { recursive: true });

  // Generate Tailwind CSS for plugin (utilities only, minified)
  // Skip base/preflight since host app already has it
  const cssContent = `@import "tailwindcss";
@source "${pluginDir.replace(/\\/g, '/')}/**/*.{js,jsx,ts,tsx}";
`;
  const cssResult = await postcss([
    tailwindcss(),
    cssnano({ preset: ['default', { discardComments: { removeAll: true } }] })
  ]).process(cssContent, { from: resolve(ROOT, 'package.json') });
  const processedCss = cssResult.css;

  // Build plugin with esbuild
  await esbuild.build({
    entryPoints: [indexPath],
    bundle: true,
    outfile: resolve(outputDir, 'plugin.js'),
    format: 'esm',
    sourcemap: false,
    treeShaking: true,
    minify: true,
    target: ['es2020'],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.DEV': JSON.stringify(false),
      'import.meta.env.PROD': JSON.stringify(true),
      'import.meta.env.MODE': JSON.stringify('production'),
      '__DEV__': JSON.stringify(false),
    },
    // drop: ['console', 'debugger'], // TEMPORARILY DISABLED FOR DEBUGGING
    alias: { '@': resolve(ROOT, 'src') },
    plugins: [createSolidPlugin(), createExternalsPlugin()],
    logLevel: 'warning',
  });

  // Minify with SWC for better compression
  const pluginJsPath = resolve(outputDir, 'plugin.js');
  let code = readFileSync(pluginJsPath, 'utf8');
  const minified = await swc.minify(code, {
    compress: {
      dead_code: true,
      drop_console: false, // TEMPORARILY DISABLED FOR DEBUGGING
      drop_debugger: true,
      unused: true,
      collapse_vars: true,
      reduce_vars: true,
      join_vars: true,
      passes: 2,
    },
    mangle: { toplevel: true },
    module: true,
  });
  code = minified.code;
  const cssInjection = `if(typeof document!=='undefined'){const s=document.createElement('style');s.setAttribute('data-plugin','${pluginName}');s.textContent=${JSON.stringify(processedCss)};document.head.appendChild(s);}\n`;
  writeFileSync(pluginJsPath, cssInjection + code);

  console.log(`   ✅ Frontend bundled for ${pluginName}`);
}

// ============================================================================
// MAIN
// ============================================================================
const args = process.argv.slice(2);

if (args.length >= 2) {
  // Plugin build mode: node build.js <plugin-dir> <output-dir>
  buildPlugin(args[0], args[1]).catch(err => {
    console.error('Plugin build failed:', err);
    process.exit(1);
  });
} else {
  // App build mode: node build.js
  buildApp().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
