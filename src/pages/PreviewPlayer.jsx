import { createSignal, createEffect, onMount, onCleanup, Show, For } from 'solid-js';
import { fetchJson } from '../api.jsx';

async function proxyGet(path) {
    return fetchJson('/api/proxy', { method: 'POST', body: JSON.stringify({ path, method: 'GET' }) });
}

function proxyCdn(url) {
    if (!url) return url;
    if (url.includes('assets.renzora.com/')) return url.replace('https://assets.renzora.com/', '/api/cdn?url=');
    return url;
}

export default function PreviewPlayer(props) {
    const [items, setItems] = createSignal([]);
    const [activeIdx, setActiveIdx] = createSignal(0);
    const [loading, setLoading] = createSignal(true);
    const [previewMode, setPreviewMode] = createSignal(null);

    onMount(async () => {
        if (!props.assetId) { setLoading(false); return; }

        try {
            const [asset, media] = await Promise.all([
                proxyGet(`marketplace/detail/${props.slug}`),
                proxyGet(`marketplace/${props.assetId}/media`).then(r => Array.isArray(r) ? r : []).catch(() => []),
            ]);

            if (!asset) { setLoading(false); return; }

            const gallery = [];
            const audioFiles = media.filter(m => m.media_type === 'audio');
            const otherFiles = media.filter(m => m.media_type !== 'audio');
            const cover = proxyCdn(asset.thumbnail_url) || proxyCdn(otherFiles.find(m => m.media_type === 'image')?.url) || '';

            if (audioFiles.length > 0 && cover) {
                audioFiles.forEach(m => gallery.push({ type: 'audio', url: proxyCdn(m.url), cover }));
                otherFiles.forEach(m => gallery.push({ type: m.media_type, url: proxyCdn(m.url), thumb: proxyCdn(m.thumbnail_url) }));
            } else {
                if (asset.thumbnail_url) gallery.push({ type: 'image', url: proxyCdn(asset.thumbnail_url) });
                media.forEach(m => gallery.push({ type: m.media_type, url: proxyCdn(m.url), thumb: proxyCdn(m.thumbnail_url) }));
            }
            if (!gallery.length) gallery.push({ type: 'placeholder' });

            setItems(gallery);

            const cat = (asset.category || '').toLowerCase();
            const previewable = ['3d models', 'animations', 'materials & shaders', 'textures & hdris', 'particle effects'];
            if (previewable.some(c => cat.includes(c.split(' ')[0]))) {
                let mode = 'shader';
                if (cat.includes('3d') || cat.includes('model')) mode = 'model';
                else if (cat.includes('anim')) mode = 'animation';
                else if (cat.includes('texture') || cat.includes('hdri')) mode = 'texture';
                else if (cat.includes('particle')) mode = 'particle';
                setPreviewMode({ mode, fileUrl: `/api/proxy`, fileBody: JSON.stringify({ path: `marketplace/${asset.id}/preview-file`, method: 'GET' }), category: cat });
            }
        } catch (e) {
            console.warn('[PreviewPlayer]', e);
        }
        setLoading(false);
    });

    return (
        <div class="w-full bg-base-300/30 rounded-xl overflow-hidden">
            <Show when={loading()}>
                <div class="aspect-video flex items-center justify-center">
                    <span class="loading loading-spinner loading-md text-primary" />
                </div>
            </Show>

            <Show when={!loading() && previewMode()}>
                <WasmPreview config={previewMode()} />
            </Show>

            <Show when={!loading() && !previewMode() && items().length > 0}>
                <MediaPreview items={items} activeIdx={activeIdx} setActiveIdx={setActiveIdx} />
            </Show>
        </div>
    );
}

function MediaPreview(props) {
    const currentItem = () => props.items()[props.activeIdx()];

    return (
        <div>
            <div class="relative aspect-video bg-base-300 overflow-hidden">
                <Show when={currentItem()?.type === 'audio'}><AudioPlayer item={currentItem()} /></Show>
                <Show when={currentItem()?.type === 'video'}><VideoPlayer item={currentItem()} /></Show>
                <Show when={currentItem()?.type === 'image'}><img src={currentItem().url} class="w-full h-full object-contain" /></Show>
                <Show when={currentItem()?.type === 'placeholder'}><div class="w-full h-full flex items-center justify-center text-base-content/20 text-5xl">📦</div></Show>
            </div>

            <Show when={props.items().length > 1}>
                <div class="flex gap-2 p-2 overflow-x-auto">
                    <For each={props.items()}>
                        {(item, i) => (
                            <button class={`shrink-0 w-16 h-11 rounded-lg border-2 overflow-hidden transition-all ${i() === props.activeIdx() ? 'border-primary' : 'border-white/[0.06] hover:border-white/[0.12]'}`} onClick={() => props.setActiveIdx(i())}>
                                <Show when={item.type === 'audio'}><div class="w-full h-full bg-base-300 flex items-center justify-center text-primary text-sm">♫</div></Show>
                                <Show when={item.type === 'video'}><div class="w-full h-full bg-base-300 flex items-center justify-center text-base-content/40 text-sm">▶</div></Show>
                                <Show when={item.type === 'image'}><img src={item.thumb || item.url} class="w-full h-full object-cover" /></Show>
                                <Show when={item.type === 'placeholder'}><div class="w-full h-full bg-base-300 flex items-center justify-center text-base-content/20">?</div></Show>
                            </button>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
}

function AudioPlayer(props) {
    let containerRef;
    let audioCtx = null, analyser = null, animFrameId = null, analyserReady = false;

    function fmtTime(sec) { if (!sec || isNaN(sec)) return '0:00'; const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return m + ':' + (s < 10 ? '0' : '') + s; }

    function drawCanvas() {
        const c = containerRef?.querySelector('#pp-waveform');
        if (!c) return null;
        const ctx = c.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = c.offsetWidth; const h = c.offsetHeight;
        c.width = w * dpr; c.height = h * dpr;
        ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
        return { ctx, w, h };
    }

    function drawIdleWaveform() {
        const c = drawCanvas(); if (!c) return;
        const { ctx, w, h } = c;
        const barW = 2, gap = 1.5, step = barW + gap;
        const bars = Math.floor(w / step); const mid = h / 2;
        for (let i = 0; i < bars; i++) {
            const barH = 3 + Math.sin(i * 0.12) * 2;
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(i * step, mid - barH / 2, barW, barH);
        }
    }

    function connectAnalyser() {
        if (analyserReady) return true;
        const audio = containerRef?.querySelector('#pp-audio');
        if (!audio) return false;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6;
            analyser.minDecibels = -70; analyser.maxDecibels = -5;
            const src = audioCtx.createMediaElementSource(audio);
            src.connect(analyser); analyser.connect(audioCtx.destination);
            analyserReady = true; return true;
        } catch { return false; }
    }

    function drawWaveformFrame() {
        const audio = containerRef?.querySelector('#pp-audio');
        if (!audio || audio.paused || audio.ended) return;
        const c = drawCanvas(); if (!c) return;
        const { ctx, w, h } = c;
        const barW = 2, gap = 1.5, step = barW + gap;
        const bars = Math.floor(w / step); const mid = h / 2;
        if (analyserReady && analyser) {
            const bufLen = analyser.frequencyBinCount;
            const freqData = new Uint8Array(bufLen);
            analyser.getByteFrequencyData(freqData);
            for (let i = 0; i < bars; i++) {
                const freqIdx = Math.min(Math.floor(Math.pow(i / bars, 1.4) * bufLen), bufLen - 1);
                const val = freqData[freqIdx] / 255;
                const barH = Math.max(2, val * h * 0.9);
                let r, g, b;
                if (val < 0.3) { const t = val / 0.3; r = Math.round(59 + 40 * t); g = Math.round(130 - 28 * t); b = Math.round(246 - 5 * t); }
                else if (val < 0.6) { const t = (val - 0.3) / 0.3; r = Math.round(99 + 121 * t); g = Math.round(102 - 42 * t); b = Math.round(241 - 41 * t); }
                else { const t = (val - 0.6) / 0.4; r = Math.round(220 + 35 * t); g = Math.round(60 - 10 * t); b = Math.round(200 - 120 * t); }
                ctx.fillStyle = `rgba(${r},${g},${b},${0.15 + val * 0.85})`;
                ctx.fillRect(i * step, mid - barH / 2, barW, barH);
            }
        } else {
            const t = audio.currentTime; const vol = audio.volume;
            for (let i = 0; i < bars; i++) {
                const wave = Math.sin(i * 0.08 + t * 3.5) * 0.3 + Math.sin(i * 0.05 + t * 5.5) * 0.25 + Math.sin(i * 0.15 + t * 2) * 0.25 + Math.sin(i * 0.22 + t * 7) * 0.2;
                const amp = Math.max(0, Math.min(1, (wave + 1) / 2)) * vol;
                const barH = Math.max(2, amp * h * 0.8);
                ctx.fillStyle = `rgba(99,102,241,${0.15 + amp * 0.85})`;
                ctx.fillRect(i * step, mid - barH / 2, barW, barH);
            }
        }
        if (audio.duration) { const px = (audio.currentTime / audio.duration) * w; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(px - 0.5, 0, 1, h); }
        animFrameId = requestAnimationFrame(drawWaveformFrame);
    }

    onMount(() => {
        if (!containerRef) return;
        const audio = containerRef.querySelector('#pp-audio');
        if (!audio) return;

        audio.addEventListener('loadedmetadata', () => {
            const d = containerRef.querySelector('#pp-duration');
            if (d && audio.duration && isFinite(audio.duration)) d.textContent = fmtTime(audio.duration);
        });
        audio.addEventListener('timeupdate', () => {
            const c = containerRef.querySelector('#pp-current');
            const s = containerRef.querySelector('#pp-seek-slider');
            if (c) c.textContent = fmtTime(audio.currentTime);
            if (s && audio.duration && !s._isSeeking) s.value = Math.floor((audio.currentTime / audio.duration) * 1000);
        });
        audio.addEventListener('ended', () => {
            containerRef.querySelector('#pp-icon-play')?.classList.remove('hidden');
            containerRef.querySelector('#pp-icon-pause')?.classList.add('hidden');
            cancelAnimationFrame(animFrameId);
            drawIdleWaveform();
        });

        const seekSlider = containerRef.querySelector('#pp-seek-slider');
        if (seekSlider) {
            seekSlider.addEventListener('mousedown', function() { this._isSeeking = true; });
            seekSlider.addEventListener('mouseup', function() { this._isSeeking = false; });
            seekSlider.addEventListener('input', function() { if (audio?.duration) audio.currentTime = (this.value / 1000) * audio.duration; });
        }

        const playBtn = containerRef.querySelector('#pp-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', function() {
                if (!analyserReady) connectAnalyser();
                if (audioCtx?.state === 'suspended') audioCtx.resume();
                if (audio.paused) {
                    audio.play().then(() => { containerRef.querySelector('#pp-icon-play')?.classList.add('hidden'); containerRef.querySelector('#pp-icon-pause')?.classList.remove('hidden'); drawWaveformFrame(); }).catch(() => {});
                } else {
                    audio.pause(); containerRef.querySelector('#pp-icon-play')?.classList.remove('hidden'); containerRef.querySelector('#pp-icon-pause')?.classList.add('hidden'); cancelAnimationFrame(animFrameId);
                }
            });
        }

        const volBtn = containerRef.querySelector('#pp-vol-btn');
        if (volBtn) volBtn.addEventListener('click', function() { audio.muted = !audio.muted; containerRef.querySelector('#pp-vol-on')?.classList.toggle('hidden', audio.muted); containerRef.querySelector('#pp-vol-off')?.classList.toggle('hidden', !audio.muted); });
        const volSlider = containerRef.querySelector('#pp-vol-slider');
        if (volSlider) volSlider.addEventListener('input', function() { audio.volume = this.value / 100; audio.muted = this.value == 0; containerRef.querySelector('#pp-vol-on')?.classList.toggle('hidden', audio.muted); containerRef.querySelector('#pp-vol-off')?.classList.toggle('hidden', !audio.muted); });

        const waveform = containerRef.querySelector('#pp-waveform');
        if (waveform) waveform.addEventListener('click', function(e) {
            if (!audio?.duration) return;
            const rect = this.getBoundingClientRect();
            audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
            if (audio.paused) { if (!analyserReady) connectAnalyser(); if (audioCtx?.state === 'suspended') audioCtx.resume(); audio.play().then(() => { containerRef.querySelector('#pp-icon-play')?.classList.add('hidden'); containerRef.querySelector('#pp-icon-pause')?.classList.remove('hidden'); drawWaveformFrame(); }).catch(() => {}); }
        });

        drawIdleWaveform();
    });

    onCleanup(() => { cancelAnimationFrame(animFrameId); containerRef?.querySelector('#pp-audio')?.pause(); });

    const cover = props.item?.cover;
    const coverBg = cover
        ? `<div class="absolute inset-0 bg-cover bg-center" style="background-image:url('${cover}')"></div><div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>`
        : `<div class="absolute inset-0 bg-gradient-to-b from-zinc-900 to-[#0a0a0b]"></div>`;

    return (
        <div ref={containerRef} class="w-full h-full relative overflow-hidden aspect-video" innerHTML={`
            <div class="w-full h-full flex flex-col items-end justify-end relative overflow-hidden">
                ${coverBg}
                ${cover ? `<img src="${cover}" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[55%] max-w-[55%] max-h-[55%] object-contain rounded-lg shadow-2xl" />` : ''}
                <audio id="pp-audio" src="${props.item?.url || ''}" preload="auto" crossorigin="anonymous" class="hidden"></audio>
                <div class="absolute inset-0 z-[5] flex items-center justify-center"><canvas id="pp-waveform" class="w-[85%] h-24 opacity-80 cursor-pointer"></canvas></div>
                <div class="relative z-10 w-full px-5 pb-4">
                    <div class="flex items-center gap-3 w-full bg-black/40 backdrop-blur-md rounded-xl px-4 py-2.5">
                        <button id="pp-play-btn" class="w-10 h-10 rounded-full bg-primary hover:brightness-110 text-white flex items-center justify-center transition-colors shrink-0 shadow-lg">
                            <svg id="pp-icon-play" class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"></polygon></svg>
                            <svg id="pp-icon-pause" class="w-5 h-5 hidden" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"></rect><rect x="15" y="3" width="4" height="18"></rect></svg>
                        </button>
                        <div class="flex-1 min-w-0">
                            <input type="range" min="0" max="1000" value="0" id="pp-seek-slider" class="w-full h-2 accent-primary bg-white/10 rounded-full appearance-none cursor-pointer" />
                            <div class="flex justify-between mt-1.5"><span id="pp-current" class="text-[11px] text-white/60 tabular-nums">0:00</span><span id="pp-duration" class="text-[11px] text-white/60 tabular-nums">0:00</span></div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            <button id="pp-vol-btn" class="text-white/40 hover:text-white/80 transition-colors">
                                <svg id="pp-vol-on" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor"></polygon><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"></path></svg>
                                <svg id="pp-vol-off" class="w-4 h-4 hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                            </button>
                            <input type="range" min="0" max="100" value="100" id="pp-vol-slider" class="w-16 h-1 accent-primary bg-white/10 rounded-full appearance-none cursor-pointer" />
                        </div>
                    </div>
                </div>
            </div>
        `} />
    );
}

function VideoPlayer(props) {
    let videoRef;
    const [playing, setPlaying] = createSignal(false);
    const [currentTime, setCurrentTime] = createSignal(0);
    const [duration, setDuration] = createSignal(0);

    function fmt(s) { if (!s || isNaN(s)) return '0:00'; return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
    function togglePlay() { if (!videoRef) return; if (videoRef.paused) { videoRef.play(); setPlaying(true); } else { videoRef.pause(); setPlaying(false); } }
    function seek(e) { if (!videoRef?.duration) return; const rect = e.currentTarget.getBoundingClientRect(); videoRef.currentTime = ((e.clientX - rect.left) / rect.width) * videoRef.duration; }
    const progress = () => duration() > 0 ? (currentTime() / duration()) * 100 : 0;

    onCleanup(() => { if (videoRef) videoRef.pause(); });

    return (
        <div class="w-full h-full relative bg-black group">
            <video ref={videoRef} src={props.item?.url} poster={props.item?.thumb} preload="metadata" class="w-full h-full object-contain" onClick={togglePlay} onLoadedMetadata={() => setDuration(videoRef.duration)} onTimeUpdate={() => setCurrentTime(videoRef.currentTime)} onEnded={() => setPlaying(false)} />
            <Show when={!playing()}>
                <div class="absolute inset-0 flex items-center justify-center cursor-pointer" onClick={togglePlay}>
                    <div class="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center hover:bg-primary/80 transition-colors">
                        <svg class="w-7 h-7 text-white ml-1" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21" /></svg>
                    </div>
                </div>
            </Show>
            <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent pt-10 pb-3 px-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <div class="relative w-full h-1 bg-white/10 rounded-full cursor-pointer mb-3" onClick={seek}>
                    <div class="absolute left-0 top-0 h-full bg-primary rounded-full" style={{ width: progress() + '%' }} />
                </div>
                <div class="flex items-center gap-3">
                    <button class="text-white/80 hover:text-white" onClick={togglePlay}>
                        <Show when={!playing()} fallback={<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18" /><rect x="15" y="3" width="4" height="18" /></svg>}>
                            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21" /></svg>
                        </Show>
                    </button>
                    <span class="text-[11px] text-white/60 tabular-nums">{fmt(currentTime())} / {fmt(duration())}</span>
                </div>
            </div>
        </div>
    );
}

function getOrCreatePreviewCanvas() {
    let canvas = document.getElementById('preview-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'preview-canvas';
        canvas.className = 'w-full h-full';
        canvas.style.display = 'none';
        document.body.appendChild(canvas);
    }
    return canvas;
}

function WasmPreview(props) {
    let containerRef;
    const [loadingWasm, setLoadingWasm] = createSignal(true);
    const [error, setError] = createSignal(false);
    const [activeMesh, setActiveMesh] = createSignal('cube');
    const [params, setParams] = createSignal({});
    const [wasmRef, setWasmRef] = createSignal(null);
    const meshes = ['sphere', 'cube', 'plane', 'torus'];

    const showMeshControls = () => {
        const m = props.config?.mode;
        return m === 'shader' || m === 'material';
    };

    function setMesh(shape) {
        setActiveMesh(shape);
        if (wasmRef()) wasmRef().preview_set_mesh(shape);
    }

    function setParam(name, jsonValue) {
        if (wasmRef()) wasmRef().preview_set_param(name, jsonValue);
    }

    function setColorParam(name, hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        if (wasmRef()) wasmRef().preview_set_param(name, JSON.stringify({ type: 'Color', value: [r, g, b, 1.0] }));
    }

    onMount(async () => {
        const canvas = getOrCreatePreviewCanvas();
        canvas.style.display = '';
        containerRef.appendChild(canvas);

        try {
            let w;
            if (window.__previewWasm) {
                w = window.__previewWasm;
            } else {
                const wasmModuleUrl = '/wasm/renzora_preview.js';
                w = await import(/* @vite-ignore */ wasmModuleUrl);
                await w.default();
                w.preview_init();
                await new Promise(r => setTimeout(r, 500));
                window.__previewWasm = w;
            }

            const { mode, fileUrl, fileBody, category } = props.config;
            if (mode === 'shader' && fileUrl) {
                const res = await fetch(fileUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: fileBody });
                if (res.ok) {
                    const source = await res.text();
                    w.preview_load_shader(source, 'Fragment');
                    try {
                        const extracted = JSON.parse(w.preview_extract_params(source) || '{}');
                        setParams(extracted);
                    } catch {}
                }
            } else if (mode === 'model') {
                const res = await fetch(fileUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: fileBody });
                if (res.ok) w.preview_load_model(URL.createObjectURL(await res.blob()));
            } else if (mode === 'animation') {
                const res = await fetch(fileUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: fileBody });
                if (res.ok) w.preview_load_animation(URL.createObjectURL(await res.blob()));
            } else if (mode === 'particle') {
                const res = await fetch(fileUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: fileBody });
                if (res.ok) w.preview_load_particle(await res.text());
            } else if (mode === 'texture') {
                const res = await fetch(fileUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: fileBody });
                if (res.ok) w.preview_load_texture(URL.createObjectURL(await res.blob()), category.includes('hdri') ? 'hdri' : 'texture');
            }

            setWasmRef(w);
            setLoadingWasm(false);
        } catch (e) {
            console.warn('[WasmPreview]', e);
            setError(true);
            setLoadingWasm(false);
        }
    });

    onCleanup(() => {
        const canvas = document.getElementById('preview-canvas');
        if (canvas) { canvas.style.display = 'none'; document.body.appendChild(canvas); }
    });

    return (
        <div class="flex flex-col bg-[#0f0f13]">
            <div class="flex items-center justify-between px-3 py-2">
                <div class="flex items-center gap-2">
                    <svg class="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21" /></svg>
                    <span class="text-sm font-medium text-base-content/70">Live Preview</span>
                    <span class="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-[10px] text-primary font-medium">BETA</span>
                </div>
                <Show when={showMeshControls()}>
                    <div class="flex items-center gap-1.5">
                        <span class="text-[11px] text-base-content/30 mr-1">Mesh:</span>
                        <For each={meshes}>
                            {(shape) => (
                                <button class={`px-2 py-0.5 rounded text-[11px] transition-colors ${activeMesh() === shape ? 'bg-primary/20 text-primary' : 'text-base-content/40 hover:text-base-content/70'}`} onClick={() => setMesh(shape)}>
                                    {shape[0].toUpperCase() + shape.slice(1)}
                                </button>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
            <div ref={containerRef} class="flex-1 min-h-0 overflow-hidden relative aspect-video">
                <Show when={loadingWasm()}>
                    <div class="absolute inset-0 flex items-center justify-center bg-[#0f0f13] z-10">
                        <div class="text-center">
                            <span class="loading loading-spinner loading-md text-primary" />
                            <p class="text-xs text-base-content/30 mt-2">Loading preview engine...</p>
                        </div>
                    </div>
                </Show>
                <Show when={error()}>
                    <div class="absolute inset-0 flex items-center justify-center z-10">
                        <p class="text-sm text-base-content/30">Preview not available</p>
                    </div>
                </Show>
            </div>
            <Show when={Object.keys(params()).length > 0}>
                <div class="grid grid-cols-2 gap-2 p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl mx-2 mt-2 mb-2">
                    <For each={Object.entries(params())}>
                        {([name, p]) => (
                            p.param_type === 'Float' ? (
                                <div class="flex items-center gap-2">
                                    <label class="text-[11px] text-base-content/40 w-20 shrink-0 truncate">{name}</label>
                                    <input type="range" min={p.min ?? 0} max={p.max ?? 10} step="0.01" ref={(el) => { el.value = p.default_value?.Float ?? 0; }} onInput={(e) => setParam(name, JSON.stringify({ type: 'Float', value: parseFloat(e.target.value) }))} class="flex-1 h-1 accent-primary" />
                                </div>
                            ) : p.param_type === 'Color' ? (
                                <div class="flex items-center gap-2">
                                    <label class="text-[11px] text-base-content/40 w-20 shrink-0">{name}</label>
                                    <input type="color" ref={(el) => { el.value = '#' + (p.default_value?.Color ?? [1, 1, 1, 1]).slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''); }} onInput={(e) => setColorParam(name, e.target.value)} class="w-6 h-6 border-0 bg-transparent cursor-pointer" />
                                </div>
                            ) : null
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
}
