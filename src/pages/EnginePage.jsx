import { createSignal, createResource, For, Show, onMount, onCleanup } from 'solid-js';
import { fetchJson, formatSize, formatDate } from '../api.jsx';
import { IconDownload, IconCheck, IconArrowRight, IconChevron } from '../icons.jsx';
import {
    IconBrandWindows, IconBrandApple, IconDeviceDesktop,
    IconDeviceMobile, IconDeviceTv,
    IconBrandAndroid, IconWorld, IconTerminal2, IconGitBranch,
    IconPlayerPlay, IconDotsVertical, IconTrash,
} from '@tabler/icons-solidjs';

const OS = (() => {
    const p = navigator.userAgent || '';
    if (p.includes('Win')) return 'windows';
    if (p.includes('Mac')) return 'macos';
    return 'linux';
})();

const OS_INFO = {
    windows: { name: 'Windows', icon: IconBrandWindows, match: /renzora\.exe$|renzora-windows/i, req: 'Windows 10+, 64-bit' },
    macos: { name: 'macOS', icon: IconBrandApple, match: /^renzora$|renzora-macos|renzora-darwin/i, req: 'macOS 12 Monterey+' },
    linux: { name: 'Linux', icon: IconDeviceDesktop, match: /renzora-linux/i, req: 'Ubuntu 22.04+, Fedora 38+' },
};

const CURRENT_OS = OS_INFO[OS];

const TEMPLATE_PLATFORMS = [
    { key: 'tpl-windows', name: 'Windows', icon: IconBrandWindows, match: /runtime.*windows/i },
    { key: 'tpl-macos', name: 'macOS', icon: IconBrandApple, match: /runtime.*macos/i },
    { key: 'tpl-linux', name: 'Linux', icon: IconDeviceDesktop, match: /runtime.*linux/i },
    { key: 'tpl-ios', name: 'iOS', icon: IconDeviceMobile, match: /runtime.*ios/i },
    { key: 'tpl-tvos', name: 'Apple TV', icon: IconDeviceTv, match: /runtime.*tvos/i },
    { key: 'tpl-android-arm', name: 'Android ARM', icon: IconBrandAndroid, match: /runtime.*android.*arm/i },
    { key: 'tpl-android-x86', name: 'Android x86', icon: IconBrandAndroid, match: /runtime.*android.*x86/i },
    { key: 'tpl-web', name: 'Web', icon: IconWorld, match: /runtime.*web|runtime.*wasm/i },
];

function injectEngineStyles() {
    if (typeof document === 'undefined') return;
    if (document.querySelector('[data-engine-styles]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-engine-styles', 'true');
    style.textContent = `
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseGlow { 0%, 100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.05); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .anim-fade-up { animation: fadeSlideUp 0.5s ease both; }
        .anim-delay-1 { animation-delay: 60ms; } .anim-delay-2 { animation-delay: 120ms; }
        .anim-delay-3 { animation-delay: 180ms; } .anim-delay-4 { animation-delay: 240ms; }
        .anim-delay-5 { animation-delay: 300ms; } .anim-delay-6 { animation-delay: 360ms; }
        .engine-hero-glow { animation: pulseGlow 4s ease-in-out infinite; }
        .engine-card { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .engine-card:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(139, 106, 174, 0.08); }
        .template-card { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
        .template-card:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(139, 106, 174, 0.06); }
        .option-card:hover .option-icon { transform: scale(1.15) rotate(3deg); }
        .option-icon { transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .hero-title {
            background: linear-gradient(135deg, #e8e8e8 0%, #8B6AAE 35%, #E8C78A 55%, #9E5B4A 70%, #e8e8e8 100%);
            background-size: 300% 300%; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
            animation: heroShimmer 6s ease-in-out infinite;
        }
        @keyframes heroShimmer { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        .launch-btn { position: relative; overflow: hidden; }
        .launch-btn::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%); background-size: 200% 100%; animation: shimmer 3s ease-in-out infinite; }
    `;
    document.head.appendChild(style);
}

function ParticleCanvas() {
    let canvasRef;

    onMount(() => {
        if (!canvasRef) return;
        const ctx = canvasRef.getContext('2d');
        let w, h, particles = [], mouse = { x: -1000, y: -1000 };
        let animId;

        function resize() { w = canvasRef.width = canvasRef.offsetWidth; h = canvasRef.height = canvasRef.offsetHeight; }
        resize();
        window.addEventListener('resize', resize);

        canvasRef.addEventListener('mousemove', e => { const rect = canvasRef.getBoundingClientRect(); mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top; });
        canvasRef.addEventListener('mouseleave', () => { mouse.x = -1000; mouse.y = -1000; });

        const count = Math.min(60, Math.floor(w * h / 12000));
        for (let i = 0; i < count; i++) {
            particles.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, r: Math.random() * 1.5 + 0.5 });
        }

        function draw() {
            ctx.clearRect(0, 0, w, h);
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                p.x += p.vx; p.y += p.vy;
                if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
                if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;

                const dx = p.x - mouse.x, dy = p.y - mouse.y, dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 100) { const force = (100 - dist) / 100 * 0.6; p.x += dx / dist * force; p.y += dy / dist * force; }

                ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(139, 106, 174, 0.5)'; ctx.fill();

                for (let j = i + 1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const d = (p.x - p2.x) ** 2 + (p.y - p2.y) ** 2;
                    if (d < 15000) {
                        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p2.x, p2.y);
                        ctx.strokeStyle = `rgba(139, 106, 174, ${(1 - d / 15000) * 0.12})`; ctx.lineWidth = 0.5; ctx.stroke();
                    }
                }
            }
            animId = requestAnimationFrame(draw);
        }
        draw();

        onCleanup(() => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); });
    });

    return <canvas ref={canvasRef} class="absolute inset-0 w-full h-full" />;
}

export default function EnginePage(props) {
    onMount(() => injectEngineStyles());
    const [showAllVersions, setShowAllVersions] = createSignal(false);

    const latestRelease = () => {
        const r = props.releases();
        return r && r.length > 0 ? r[0] : null;
    };

    const olderReleases = () => {
        const r = props.releases();
        return r && r.length > 1 ? r.slice(1) : [];
    };

    const installed = () => props.installed() || [];

    const isVersionInstalled = (version) => {
        const v = version?.replace(/^v/, '');
        return installed().some(i => i.version === v);
    };

    return (
        <div class="flex flex-col gap-0">
            <div class="relative pt-10 pb-8 px-6 overflow-hidden">
                <ParticleCanvas />
                <div class="absolute inset-0 pointer-events-none">
                    <div class="absolute top-[-40px] left-1/2 -translate-x-1/2 w-[500px] h-[400px] bg-primary/6 rounded-full blur-[120px] engine-hero-glow" />
                    <div class="absolute top-[20px] left-1/3 w-[200px] h-[200px] bg-accent/5 rounded-full blur-[80px] engine-hero-glow" style="animation-delay: 2s" />
                    <div class="absolute top-[60px] right-1/4 w-[150px] h-[150px] bg-secondary/5 rounded-full blur-[60px] engine-hero-glow" style="animation-delay: 3s" />
                </div>
                <div class="relative z-10 text-center max-w-xl mx-auto">
                    <Show when={latestRelease()} fallback={
                        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-base-300/50 text-base-content/40 text-xs font-medium mb-4 anim-fade-up">
                            <span class="loading loading-spinner loading-xs" /> Loading...
                        </div>
                    }>
                        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold mb-4 anim-fade-up">
                            <IconDownload size={12} /> {formatDate(latestRelease().published_at)}
                        </div>
                    </Show>
                    <h1 class="text-3xl font-extrabold tracking-tight anim-fade-up anim-delay-1">
                        <span class="hero-title">{latestRelease()?.name || 'Renzora Engine'}</span>
                    </h1>
                    <p class="text-sm text-base-content/40 mt-2.5 anim-fade-up anim-delay-2">Free, open source, and ready to build.</p>
                </div>
            </div>

            <UpdateBanner />

            <div class="px-6 pb-8">
                <Show when={latestRelease()}>
                    <div class="mb-10">
                        <h2 class="text-sm font-semibold mb-4 flex items-center gap-2">
                            <div class="w-6 h-6 rounded-lg bg-accent/10 flex items-center justify-center"><IconDownload size={13} class="text-accent" /></div>
                            Editor
                        </h2>
                        <EditorCard release={latestRelease()} isInstalled={() => isVersionInstalled(latestRelease().version)} refetchInstalled={props.refetchInstalled} class="anim-fade-up anim-delay-3" />
                    </div>

                    <div class="mb-10">
                        <h2 class="text-sm font-semibold mb-1 flex items-center gap-2">
                            <div class="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center"><IconWorld size={13} class="text-primary" /></div>
                            Export Templates
                        </h2>
                        <p class="text-[10px] text-base-content/30 mb-4 ml-8">Required for exporting your game to each platform.</p>
                        <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
                            <For each={TEMPLATE_PLATFORMS}>
                                {(platform, i) => <TemplateCard platform={platform} release={latestRelease()} installedVersions={installed} refetchInstalled={props.refetchInstalled} index={i()} />}
                            </For>
                        </div>
                    </div>
                </Show>

                <div class="mb-10">
                    <h2 class="text-sm font-semibold mb-4 flex items-center gap-2">
                        <div class="w-6 h-6 rounded-lg bg-success/10 flex items-center justify-center"><IconTerminal2 size={13} class="text-success" /></div>
                        Other Options
                    </h2>
                    <div class="grid grid-cols-2 gap-3">
                        <a href="https://github.com/renzora/engine" target="_blank" class="option-card group p-4 bg-base-200/20 border border-white/[0.04] rounded-xl hover:border-white/[0.08] hover:bg-base-200/30 transition-all flex items-center gap-3 anim-fade-up anim-delay-5">
                            <div class="option-icon w-9 h-9 rounded-xl bg-base-300/50 flex items-center justify-center shrink-0"><IconTerminal2 size={18} class="text-base-content/40" /></div>
                            <div class="flex-1 min-w-0"><div class="text-xs font-semibold mb-0.5 group-hover:text-accent transition-colors">Build from source</div><div class="text-[10px] text-base-content/30">Clone the repo and compile with Cargo.</div></div>
                            <IconArrowRight size={14} class="text-base-content/20 group-hover:text-accent transition-colors shrink-0" />
                        </a>
                        <a href="https://github.com/renzora/engine/releases" target="_blank" class="option-card group p-4 bg-base-200/20 border border-white/[0.04] rounded-xl hover:border-white/[0.08] hover:bg-base-200/30 transition-all flex items-center gap-3 anim-fade-up anim-delay-6">
                            <div class="option-icon w-9 h-9 rounded-xl bg-base-300/50 flex items-center justify-center shrink-0"><IconGitBranch size={18} class="text-base-content/40" /></div>
                            <div class="flex-1 min-w-0"><div class="text-xs font-semibold mb-0.5 group-hover:text-accent transition-colors">All releases</div><div class="text-[10px] text-base-content/30">Browse all versions on GitHub.</div></div>
                            <IconArrowRight size={14} class="text-base-content/20 group-hover:text-accent transition-colors shrink-0" />
                        </a>
                    </div>
                </div>

                <Show when={olderReleases().length > 0}>
                    <div>
                        <button class="flex items-center gap-2 text-xs font-medium text-base-content/40 hover:text-base-content/60 transition-colors mb-3" onClick={() => setShowAllVersions(!showAllVersions())}>
                            <IconChevron size={12} class={`transition-transform ${showAllVersions() ? 'rotate-180' : ''}`} />
                            {showAllVersions() ? 'Hide' : 'Show'} older versions ({olderReleases().length})
                        </button>
                        <Show when={showAllVersions()}>
                            <div class="space-y-2">
                                <For each={olderReleases()}>
                                    {(release) => <OlderVersionRow release={release} isInstalled={() => isVersionInstalled(release.version)} refetchInstalled={props.refetchInstalled} />}
                                </For>
                            </div>
                        </Show>
                    </div>
                </Show>
            </div>
        </div>
    );
}

function UpdateBanner() {
    const [updateInfo] = createResource(() => fetchJson('/api/updater/check').catch(() => null));
    const [updating, setUpdating] = createSignal(false);
    const [result, setResult] = createSignal(null);

    async function performUpdate() {
        setUpdating(true);
        const r = await fetchJson('/api/updater/update', { method: 'POST' });
        setResult(r);
        setUpdating(false);
    }

    return (
        <Show when={updateInfo()?.update_available}>
            <div class="mx-6 mb-6 px-4 py-2.5 rounded-xl bg-primary/8 border border-primary/15 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span class="text-xs font-medium">Launcher update: v{updateInfo().latest_version}</span>
                </div>
                <Show when={!result()} fallback={<span class="text-xs text-success font-medium">{result().message}</span>}>
                    <button class="btn btn-xs btn-primary rounded-lg" onClick={performUpdate} disabled={updating()}>
                        {updating() ? 'Updating...' : 'Update now'}
                    </button>
                </Show>
            </div>
        </Show>
    );
}

function EditorCard(props) {
    const asset = () => props.release.assets.find(a => CURRENT_OS.match.test(a.name) && a.kind === 'editor');
    const available = () => !!asset();
    const [installing, setInstalling] = createSignal(false);
    const [done, setDone] = createSignal(false);
    const isInstalled = () => props.isInstalled() || done();
    const [menuOpen, setMenuOpen] = createSignal(false);

    async function install() {
        if (!asset()) return;
        setInstalling(true);
        await fetchJson('/api/install', { method: 'POST', body: JSON.stringify({ version: props.release.version, assets: [asset().name] }) });
        setInstalling(false);
        setDone(true);
        props.refetchInstalled();
    }

    async function launch() {
        await fetchJson('/api/launch', { method: 'POST', body: JSON.stringify({ version: props.release.version }) });
    }

    async function uninstall() {
        setMenuOpen(false);
        await fetchJson('/api/uninstall', { method: 'POST', body: JSON.stringify({ version: props.release.version }) });
        setDone(false);
        props.refetchInstalled();
    }

    function toggleMenu(e) {
        e.stopPropagation();
        if (!menuOpen()) {
            setMenuOpen(true);
            const close = () => { setMenuOpen(false); window.removeEventListener('click', close); };
            setTimeout(() => window.addEventListener('click', close), 0);
        } else { setMenuOpen(false); }
    }

    return (
        <div class={`relative rounded-xl border engine-card anim-fade-up anim-delay-3 ${available() ? 'bg-base-200/20 border-white/[0.04] hover:border-accent/30' : 'bg-base-200/10 border-white/[0.02] opacity-40'}`}>
            <div class="flex items-center gap-4 p-5">
                <div class="w-14 h-14 rounded-2xl bg-base-300/30 border border-white/[0.04] flex items-center justify-center shrink-0">
                    <CURRENT_OS.icon size={28} class={available() ? 'text-base-content/70' : 'text-base-content/20'} />
                </div>
                <div class="flex-1">
                    <h3 class="text-lg font-semibold">{props.release.name || props.release.version}</h3>
                    <p class="text-[11px] text-base-content/30">{CURRENT_OS.name} · {CURRENT_OS.req}</p>
                    <Show when={available()}><p class="text-[10px] text-base-content/20 mt-0.5">{asset().name} · {formatSize(asset().size)}</p></Show>
                </div>
                <div class="shrink-0 flex items-center gap-1.5">
                    <Show when={available()} fallback={<span class="px-5 py-2.5 rounded-xl text-xs font-medium bg-base-300/30 text-base-content/20">Coming soon</span>}>
                        <Show when={isInstalled()} fallback={
                            <button class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-content hover:brightness-110 transition-all" onClick={install} disabled={installing()}>
                                <Show when={!installing()} fallback={<span class="loading loading-spinner loading-xs" />}><IconDownload size={16} /></Show>
                                {installing() ? 'Installing...' : 'Download'}
                            </button>
                        }>
                            <button class="launch-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-success text-success-content hover:brightness-110 transition-all" onClick={launch}>
                                <IconPlayerPlay size={16} /> Launch
                            </button>
                            <div class="relative">
                                <button class="p-2 rounded-lg text-base-content/30 hover:text-base-content/60 hover:bg-white/[0.04] transition-all" onClick={toggleMenu}><IconDotsVertical size={16} /></button>
                                <Show when={menuOpen()}>
                                    <div class="absolute right-0 top-full mt-1 z-50 w-40 py-1 rounded-xl bg-base-200 border border-white/[0.08] shadow-xl">
                                        <button class="w-full flex items-center gap-2 px-3 py-2 text-xs text-error/70 hover:text-error hover:bg-error/10 transition-colors" onClick={uninstall}><IconTrash size={14} /> Remove</button>
                                    </div>
                                </Show>
                            </div>
                        </Show>
                    </Show>
                </div>
            </div>
        </div>
    );
}

function TemplateCard(props) {
    const asset = () => props.release.assets.find(a => props.platform.match.test(a.name));
    const available = () => !!asset();
    const [installing, setInstalling] = createSignal(false);
    const [done, setDone] = createSignal(false);

    const isInstalled = () => {
        if (done()) return true;
        const version = props.release.version.replace(/^v/, '');
        const ver = (props.installedVersions() || []).find(i => i.version === version);
        return ver?.assets?.some(a => a.name === asset()?.name);
    };

    async function install() {
        if (!asset()) return;
        setInstalling(true);
        await fetchJson('/api/install', { method: 'POST', body: JSON.stringify({ version: props.release.version, assets: [asset().name] }) });
        setInstalling(false);
        setDone(true);
        props.refetchInstalled();
    }

    return (
        <div class={`p-3.5 rounded-xl border flex flex-col items-center gap-2 ${available() ? 'bg-base-200/20 border-white/[0.04] hover:border-primary/20 hover:bg-base-200/30' : 'bg-base-200/10 border-white/[0.02] opacity-40'}`}>
            <props.platform.icon size={20} class={available() ? 'text-base-content/50' : 'text-base-content/15'} />
            <span class="text-xs font-medium">{props.platform.name}</span>
            <Show when={available()} fallback={<span class="text-[10px] text-base-content/20">Coming soon</span>}>
                <Show when={isInstalled()} fallback={
                    <button class="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-primary-content hover:brightness-110 transition-colors" onClick={install} disabled={installing()}>
                        <Show when={!installing()} fallback={<span class="loading loading-spinner loading-xs" />}><IconDownload size={12} /></Show>
                        {installing() ? '...' : 'Download'}
                    </button>
                }>
                    <div class="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-success/15 text-success"><IconCheck size={12} /> Ready</div>
                </Show>
                <span class="text-[10px] text-base-content/20">{formatSize(asset().size)}</span>
            </Show>
        </div>
    );
}

function OlderVersionRow(props) {
    const [installing, setInstalling] = createSignal(false);
    const [done, setDone] = createSignal(false);
    const [menuOpen, setMenuOpen] = createSignal(false);
    const editorAsset = () => props.release.assets.find(a => CURRENT_OS.match.test(a.name) && a.kind === 'editor');
    const isInstalled = () => props.isInstalled() || done();

    async function install() {
        const a = editorAsset();
        if (!a) return;
        setInstalling(true);
        await fetchJson('/api/install', { method: 'POST', body: JSON.stringify({ version: props.release.version, assets: [a.name] }) });
        setInstalling(false);
        setDone(true);
        props.refetchInstalled();
    }

    async function launch() {
        await fetchJson('/api/launch', { method: 'POST', body: JSON.stringify({ version: props.release.version }) });
    }

    async function uninstall() {
        setMenuOpen(false);
        await fetchJson('/api/uninstall', { method: 'POST', body: JSON.stringify({ version: props.release.version }) });
        setDone(false);
        props.refetchInstalled();
    }

    function toggleMenu(e) {
        e.stopPropagation();
        if (!menuOpen()) {
            setMenuOpen(true);
            const close = () => { setMenuOpen(false); window.removeEventListener('click', close); };
            setTimeout(() => window.addEventListener('click', close), 0);
        } else { setMenuOpen(false); }
    }

    return (
        <div class="flex items-center justify-between px-4 py-3 rounded-xl border border-white/[0.04] bg-base-200/15 hover:border-white/[0.06] transition-colors">
            <div class="flex items-center gap-3">
                <div class={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${isInstalled() ? 'bg-primary/15 text-primary' : 'bg-base-300/30 text-base-content/25'}`}>
                    {props.release.version.replace(/^v/, '').split('.')[1] || '0'}
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-semibold">{props.release.name || props.release.version}</span>
                        <Show when={props.release.prerelease}><span class="text-[9px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-semibold">pre-release</span></Show>
                        <Show when={isInstalled()}><span class="text-[9px] px-1.5 py-0.5 rounded-full bg-success/15 text-success font-semibold">installed</span></Show>
                    </div>
                    <div class="text-[10px] text-base-content/30">{formatDate(props.release.published_at)}</div>
                </div>
            </div>
            <div class="flex items-center gap-1">
                <Show when={isInstalled()} fallback={
                    <Show when={editorAsset()}>
                        <button class="btn btn-ghost btn-xs rounded-lg border border-white/[0.06]" onClick={install} disabled={installing()}>
                            <Show when={!installing()} fallback={<span class="loading loading-spinner loading-xs" />}><IconDownload size={12} /></Show>
                            {installing() ? '...' : 'Install'}
                        </button>
                    </Show>
                }>
                    <button class="btn btn-primary btn-xs rounded-lg gap-1" onClick={launch}><IconPlayerPlay size={12} /> Launch</button>
                    <div class="relative">
                        <button class="p-1.5 rounded-lg text-base-content/25 hover:text-base-content/50 hover:bg-white/[0.04] transition-all" onClick={toggleMenu}><IconDotsVertical size={14} /></button>
                        <Show when={menuOpen()}>
                            <div class="absolute right-0 top-full mt-1 z-50 w-36 py-1 rounded-xl bg-base-200 border border-white/[0.08] shadow-xl">
                                <button class="w-full flex items-center gap-2 px-3 py-2 text-xs text-error/70 hover:text-error hover:bg-error/10 transition-colors" onClick={uninstall}><IconTrash size={13} /> Remove</button>
                            </div>
                        </Show>
                    </div>
                </Show>
            </div>
        </div>
    );
}
