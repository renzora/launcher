import { createSignal, createResource, For, Show, onCleanup } from 'solid-js';
import { fetchJson } from '../api.jsx';

async function fetchCategories(type) {
    try {
        const path = type === 'game' ? 'games/categories' : 'marketplace/categories';
        const data = await fetchJson('/api/proxy', { method: 'POST', body: JSON.stringify({ path, method: 'GET' }) });
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

async function searchTags(query) {
    try {
        const data = await fetchJson('/api/proxy', { method: 'POST', body: JSON.stringify({ path: `marketplace/tags?q=${encodeURIComponent(query)}`, method: 'GET' }) });
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

async function submitNewTag(name) {
    try {
        const data = await fetchJson('/api/proxy', { method: 'POST', body: JSON.stringify({ path: 'marketplace/tags/submit', method: 'POST', body: { name } }) });
        return data;
    } catch { return null; }
}

export default function PublishPage(props) {
    const [step, setStep] = createSignal(1);
    const [contentType, setContentType] = createSignal(null);
    const [categorySlug, setCategorySlug] = createSignal('');
    const [categoryName, setCategoryName] = createSignal('');
    const [name, setName] = createSignal('');
    const [description, setDescription] = createSignal('');
    const [version, setVersion] = createSignal('1.0.0');
    const [price, setPrice] = createSignal(0);
    const [tags, setTags] = createSignal([]);
    const [tagInput, setTagInput] = createSignal('');
    const [tagResults, setTagResults] = createSignal([]);
    const [showTagDropdown, setShowTagDropdown] = createSignal(false);
    const [downloadFilename, setDownloadFilename] = createSignal('');
    const [licence, setLicence] = createSignal('standard');
    const [aiGenerated, setAiGenerated] = createSignal(false);
    const [creditName, setCreditName] = createSignal('');
    const [creditUrl, setCreditUrl] = createSignal('');
    const [filePath, setFilePath] = createSignal(null);
    const [filePaths, setFilePaths] = createSignal([]); // multi-file
    const [fileName, setFileName] = createSignal('');
    const [fileSize, setFileSize] = createSignal(0);
    const [zipAction, setZipAction] = createSignal('keep');
    const [thumbPath, setThumbPath] = createSignal(null);
    const [thumbName, setThumbName] = createSignal('');
    const [screenshotPaths, setScreenshotPaths] = createSignal([]);
    const [uploading, setUploading] = createSignal(false);
    const [error, setError] = createSignal('');
    const [success, setSuccess] = createSignal('');

    const [categories] = createResource(() => contentType(), (type) => type ? fetchCategories(type) : []);

    const totalSteps = 5;

    let tagSearchTimeout;

    function goToStep(s) { setError(''); setStep(s); }

    function nextStep() {
        const s = step();
        if (s === 2 && !name().trim()) { setError('Name is required'); return; }
        if (s === 2 && !description().trim()) { setError('Description is required'); return; }
        if (s === 3 && !filePath() && filePaths().length === 0) { setError('Please select a file'); return; }
        setError('');
        setStep(Math.min(s + 1, totalSteps));
    }

    function prevStep() { setError(''); setStep(Math.max(step() - 1, 1)); }

    // ── Content type selection ──
    function selectType(type) {
        setContentType(type);
        goToStep(2);
    }

    // ── Category selection from step 2 ──
    function selectCategory(slug, cname) {
        setCategorySlug(slug);
        setCategoryName(cname);
    }

    // ── Tag handling ──
    function addTag(t) {
        const clean = t.trim().toLowerCase();
        if (!clean || tags().length >= 5 || tags().includes(clean)) return;
        setTags([...tags(), clean]);
        setTagInput('');
        setShowTagDropdown(false);
    }

    function removeTag(i) {
        setTags(tags().filter((_, idx) => idx !== i));
    }

    function handleTagInput(val) {
        setTagInput(val);
        if (val.includes(',')) {
            const parts = val.split(',');
            parts.forEach((p, i) => { if (i < parts.length - 1 && p.trim()) addTag(p); });
            setTagInput(parts[parts.length - 1]);
            return;
        }
        clearTimeout(tagSearchTimeout);
        if (val.trim().length > 0) {
            tagSearchTimeout = setTimeout(async () => {
                const results = await searchTags(val.trim());
                setTagResults(results);
                setShowTagDropdown(true);
            }, 200);
        } else {
            setShowTagDropdown(false);
        }
    }

    async function handleSubmitNewTag(tagName) {
        const result = await submitNewTag(tagName);
        if (result && result.name) addTag(result.name);
        else addTag(tagName);
    }

    // ── File pickers ──
    async function pickFile() {
        const accept = contentType() === 'game'
            ? 'zip,exe,tar.gz,dmg,appimage'
            : 'zip,rar,7z,lua,rhai,wgsl,fbx,obj,gltf,glb,blend,png,jpg,svg,wav,ogg,mp3,flac,ttf,otf';
        const result = await fetchJson('/api/upload/file-picker', { method: 'POST', body: JSON.stringify({ type: 'file', accept }) });
        if (result.path) {
            setFilePath(result.path);
            setFilePaths([]);
            setFileName(result.name);
            setFileSize(result.size);
            if (!downloadFilename()) setDownloadFilename(result.name);
        }
    }

    async function pickMultipleFiles() {
        const accept = 'zip,rar,7z,lua,rhai,wgsl,fbx,obj,gltf,glb,blend,png,jpg,svg,wav,ogg,mp3,flac,ttf,otf';
        const result = await fetchJson('/api/upload/file-picker', { method: 'POST', body: JSON.stringify({ type: 'files', accept }) });
        if (result.files && result.files.length > 0) {
            setFilePaths(result.files.slice(0, 20));
            setFilePath(null);
            setFileName(result.files.length + ' files selected');
            setFileSize(result.files.reduce((s, f) => s + (f.size || 0), 0));
            if (!downloadFilename()) setDownloadFilename(result.files[0].name);
        }
    }

    async function pickThumbnail() {
        const result = await fetchJson('/api/upload/file-picker', { method: 'POST', body: JSON.stringify({ type: 'file', accept: 'png,jpg,jpeg,webp' }) });
        if (result.path) {
            setThumbPath(result.path);
            setThumbName(result.name);
        }
    }

    async function pickScreenshots() {
        const result = await fetchJson('/api/upload/file-picker', { method: 'POST', body: JSON.stringify({ type: 'files', accept: 'png,jpg,jpeg,webp' }) });
        if (result.files && result.files.length > 0) {
            setScreenshotPaths(result.files.slice(0, 10));
        }
    }

    // ── Submit ──
    async function handlePublish() {
        setUploading(true);
        setError('');
        setSuccess('');

        const metadata = {
            name: name().trim(),
            description: description().trim(),
            category: categorySlug(),
            price_credits: price(),
            version: version().trim() || '1.0.0',
        };

        if (contentType() === 'asset') {
            metadata.tags = tags();
            metadata.download_filename = downloadFilename();
            metadata.licence = licence();
            metadata.ai_generated = aiGenerated();
            metadata.zip_action = zipAction();
            if (creditName()) {
                metadata.credit_name = creditName();
                metadata.credit_url = creditUrl();
                metadata.price_credits = 0;
            }
        }

        const body = {
            content_type: contentType(),
            metadata,
        };
        // Support single file or multiple files
        if (filePaths().length > 0) {
            body.file_paths = filePaths().map(f => f.path);
        } else {
            body.file_path = filePath();
        }
        if (thumbPath()) body.thumbnail_path = thumbPath();
        if (screenshotPaths().length > 0) body.screenshot_paths = screenshotPaths().map(s => s.path);

        try {
            const result = await fetchJson('/api/upload/publish', { method: 'POST', body: JSON.stringify(body) });
            if (result.error) {
                setError(result.error);
            } else {
                setSuccess(contentType() === 'game'
                    ? 'Game uploaded successfully!'
                    : 'Asset uploaded as draft! You can publish it from your dashboard on renzora.com.');
                goToStep(totalSteps + 1); // done state
            }
        } catch (e) {
            setError('Upload failed: ' + e.message);
        }

        setUploading(false);
    }

    function formatSize(bytes) {
        if (!bytes) return '';
        if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
        if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
        return (bytes / 1e3).toFixed(0) + ' KB';
    }

    return (
        <div class="p-6 max-w-2xl mx-auto">
            {/* Header */}
            <div class="mb-6">
                <h1 class="text-xl font-bold">Publish Content</h1>
                <p class="text-xs text-base-content/40 mt-1">Share your creation with the Renzora community.</p>
            </div>

            {/* Progress */}
            <Show when={step() <= totalSteps}>
                <div class="flex items-center gap-1.5 mb-6">
                    <For each={Array.from({length: totalSteps}, (_, i) => i + 1)}>
                        {(s) => (
                            <>
                                <div class={`w-2.5 h-2.5 rounded-full transition-colors ${s <= step() ? 'bg-primary' : 'bg-base-300'}`} />
                                <Show when={s < totalSteps}>
                                    <div class={`w-8 h-0.5 transition-colors ${s < step() ? 'bg-primary' : 'bg-base-300'}`} />
                                </Show>
                            </>
                        )}
                    </For>
                    <span class="ml-3 text-[10px] text-base-content/30">Step {step()} of {totalSteps}</span>
                </div>
            </Show>

            {/* Error */}
            <Show when={error()}>
                <div class="mb-4 px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-error text-xs flex items-center gap-2">
                    <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {error()}
                </div>
            </Show>

            {/* Success */}
            <Show when={success()}>
                <div class="mb-4 px-3 py-2 rounded-lg bg-success/10 border border-success/20 text-success text-xs flex items-center gap-2">
                    <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    {success()}
                </div>
            </Show>

            {/* ═══════ STEP 1: Content Type ═══════ */}
            <Show when={step() === 1}>
                <div class="grid grid-cols-2 gap-3">
                    <button class="group p-6 bg-base-200/50 border border-white/[0.04] rounded-xl text-left hover:border-primary/30 hover:bg-primary/[0.03] transition-all"
                        onClick={() => selectType('asset')}>
                        <div class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                            <svg class="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                        </div>
                        <h3 class="text-sm font-semibold mb-1">Marketplace Asset</h3>
                        <p class="text-[11px] text-base-content/40">3D models, scripts, audio, textures, plugins, and more.</p>
                    </button>
                    <button class="group p-6 bg-base-200/50 border border-white/[0.04] rounded-xl text-left hover:border-primary/30 hover:bg-primary/[0.03] transition-all"
                        onClick={() => selectType('game')}>
                        <div class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                            <svg class="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4M8 10v4M15 11h.01M18 13h.01"/></svg>
                        </div>
                        <h3 class="text-sm font-semibold mb-1">Game</h3>
                        <p class="text-[11px] text-base-content/40">Publish a playable game for the community.</p>
                    </button>
                </div>
            </Show>

            {/* ═══════ STEP 2: Info + Category ═══════ */}
            <Show when={step() === 2}>
                <div class="space-y-4 p-5 bg-base-200/30 border border-white/[0.04] rounded-xl">
                    <h2 class="text-sm font-semibold">Basic Information</h2>

                    {/* Category */}
                    <div>
                        <label class="block text-xs text-base-content/50 mb-1">Category <span class="text-error">*</span></label>
                        <div class="grid grid-cols-3 gap-2">
                            <Show when={!categories.loading} fallback={<div class="col-span-3 text-xs text-base-content/30 py-4 text-center">Loading categories...</div>}>
                                <For each={categories() || []}>
                                    {(cat) => (
                                        <button class={`px-3 py-2 rounded-lg text-xs font-medium border transition-all text-left ${categorySlug() === cat.slug ? 'bg-primary/15 border-primary/30 text-primary' : 'bg-base-300/30 border-white/[0.04] text-base-content/60 hover:border-primary/20'}`}
                                            onClick={() => selectCategory(cat.slug, cat.name)}>
                                            {cat.name}
                                        </button>
                                    )}
                                </For>
                            </Show>
                        </div>
                    </div>

                    {/* Name */}
                    <div>
                        <label class="block text-xs text-base-content/50 mb-1">Name <span class="text-error">*</span></label>
                        <input type="text" class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs" placeholder="My Awesome Creation" maxLength="128"
                            value={name()} onInput={(e) => setName(e.target.value)} />
                    </div>

                    {/* Description */}
                    <div>
                        <label class="block text-xs text-base-content/50 mb-1">Description <span class="text-error">*</span></label>
                        <textarea class="textarea textarea-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs min-h-20" placeholder="Describe what this is..."
                            value={description()} onInput={(e) => setDescription(e.target.value)} />
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs text-base-content/50 mb-1">Version</label>
                            <input type="text" class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs" placeholder="1.0.0"
                                value={version()} onInput={(e) => setVersion(e.target.value)} />
                        </div>
                        <div>
                            <label class="block text-xs text-base-content/50 mb-1">Price (credits)</label>
                            <input type="number" class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs" min="0"
                                value={price()} onInput={(e) => setPrice(parseInt(e.target.value) || 0)} disabled={!!creditName().trim()} />
                            <p class="text-[10px] text-base-content/25 mt-0.5">{price() === 0 ? 'Free' : `${price()} credits ($${(price() * 0.10).toFixed(2)})`}</p>
                        </div>
                    </div>

                    {/* Tags — asset only */}
                    <Show when={contentType() === 'asset'}>
                        <div>
                            <label class="block text-xs text-base-content/50 mb-1">Tags</label>
                            <div class="flex flex-wrap gap-1 mb-1.5">
                                <For each={tags()}>
                                    {(tag, i) => (
                                        <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/15 text-primary text-[10px] font-medium rounded-md">
                                            {tag}
                                            <button class="hover:text-white ml-0.5" onClick={() => removeTag(i())}>&times;</button>
                                        </span>
                                    )}
                                </For>
                            </div>
                            <div class="relative">
                                <input type="text" class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs" placeholder="Type to search tags..."
                                    value={tagInput()} onInput={(e) => handleTagInput(e.target.value)}
                                    onFocus={() => tagInput().length > 0 && setShowTagDropdown(true)}
                                    onKeyDown={(e) => { if (e.key === 'Backspace' && !tagInput() && tags().length > 0) removeTag(tags().length - 1); }} />
                                <Show when={showTagDropdown() && (tagResults().length > 0 || tagInput().trim())}>
                                    <div class="absolute left-0 right-0 top-full mt-1 bg-base-300 border border-white/[0.06] rounded-lg shadow-lg z-50 max-h-36 overflow-y-auto">
                                        <For each={tagResults().filter(t => !tags().includes(t.name))}>
                                            {(t) => (
                                                <button class="w-full px-3 py-1.5 text-left text-xs text-base-content/70 hover:bg-white/[0.05] transition-colors"
                                                    onClick={() => addTag(t.name)}>{t.name}</button>
                                            )}
                                        </For>
                                        <Show when={tagInput().trim() && !tagResults().some(t => t.name.toLowerCase() === tagInput().trim().toLowerCase())}>
                                            <button class="w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-white/[0.05] transition-colors border-t border-white/[0.04]"
                                                onClick={() => handleSubmitNewTag(tagInput().trim())}>
                                                + Submit "{tagInput().trim()}" as new tag
                                            </button>
                                        </Show>
                                    </div>
                                </Show>
                            </div>
                            <p class="text-[10px] text-base-content/25 mt-0.5">Up to 5 tags. Press comma or click a suggestion.</p>
                        </div>

                        {/* Download filename */}
                        <div>
                            <label class="block text-xs text-base-content/50 mb-1">Download Filename</label>
                            <input type="text" class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs" placeholder="my-asset.zip"
                                value={downloadFilename()} onInput={(e) => setDownloadFilename(e.target.value)} />
                            <p class="text-[10px] text-base-content/25 mt-0.5">Auto-populated from your file. This is what users see when downloading.</p>
                        </div>

                        {/* License */}
                        <div>
                            <label class="block text-xs text-base-content/50 mb-1">License</label>
                            <select class="select select-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs"
                                value={licence()} onChange={(e) => setLicence(e.target.value)}>
                                <option value="standard">Standard Marketplace License</option>
                                <option value="mit">MIT</option>
                                <option value="apache2">Apache 2.0</option>
                                <option value="gpl3">GPL 3.0</option>
                                <option value="cc0">CC0 (Public Domain)</option>
                            </select>
                        </div>

                        {/* AI generated */}
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" class="checkbox checkbox-xs checkbox-primary" checked={aiGenerated()} onChange={(e) => setAiGenerated(e.target.checked)} />
                            <span class="text-xs text-base-content/60">This asset was created with AI assistance</span>
                        </label>

                        {/* Credit / Attribution */}
                        <div class="p-3 bg-base-300/20 border border-white/[0.04] rounded-lg space-y-2.5">
                            <div class="flex items-center gap-1.5">
                                <svg class="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                                <span class="text-[10px] text-base-content/40 uppercase tracking-wider font-medium">Credit / Attribution</span>
                            </div>
                            <p class="text-[10px] text-base-content/30">If this asset is from another creator, credit them here. Credited assets are automatically free.</p>
                            <div>
                                <label class="block text-[10px] text-base-content/40 mb-0.5">Original Creator Name</label>
                                <input type="text" class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs" placeholder="e.g. KayKit, Kenney"
                                    value={creditName()} onInput={(e) => { setCreditName(e.target.value); if (e.target.value.trim()) setPrice(0); }} />
                            </div>
                            <div>
                                <label class="block text-[10px] text-base-content/40 mb-0.5">Creator Website / Source Link</label>
                                <input type="text" class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs" placeholder="https://kaykit.itch.io"
                                    value={creditUrl()} onInput={(e) => setCreditUrl(e.target.value)} />
                            </div>
                            <Show when={creditName().trim()}>
                                <div class="px-2.5 py-1.5 bg-success/8 border border-success/15 rounded-md">
                                    <p class="text-[10px] text-success">This asset will be published as free because it credits another creator.</p>
                                </div>
                            </Show>
                        </div>
                    </Show>
                </div>

                <div class="flex gap-2 mt-4">
                    <button class="btn btn-ghost btn-sm rounded-lg text-xs" onClick={prevStep}>Back</button>
                    <button class="btn btn-primary btn-sm rounded-lg flex-1 text-xs" onClick={() => { if (!categorySlug()) { setError('Please select a category'); return; } nextStep(); }}>
                        Continue
                    </button>
                </div>
            </Show>

            {/* ═══════ STEP 3: Files ═══════ */}
            <Show when={step() === 3}>
                <div class="space-y-4 p-5 bg-base-200/30 border border-white/[0.04] rounded-xl">
                    <h2 class="text-sm font-semibold">{contentType() === 'game' ? 'Game Files' : 'Asset Files'}</h2>

                    {/* Main file(s) */}
                    <div>
                        <label class="block text-xs text-base-content/50 mb-1">{contentType() === 'game' ? 'Game File' : 'Asset File(s)'} <span class="text-error">*</span></label>
                        <div class="flex gap-2 mb-2">
                            <button class="flex-1 p-4 border-2 border-dashed border-white/[0.06] rounded-xl hover:border-primary/30 transition-colors text-center"
                                onClick={pickFile}>
                                <Show when={filePath() && filePaths().length === 0} fallback={
                                    <div>
                                        <svg class="w-6 h-6 mx-auto text-base-content/20 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                        <p class="text-xs text-base-content/40">Single file</p>
                                    </div>
                                }>
                                    <div class="text-xs">
                                        <span class="font-medium text-primary">{fileName()}</span>
                                        <span class="text-base-content/30 ml-1">({formatSize(fileSize())})</span>
                                    </div>
                                </Show>
                            </button>
                            <Show when={contentType() === 'asset'}>
                                <button class="flex-1 p-4 border-2 border-dashed border-white/[0.06] rounded-xl hover:border-primary/30 transition-colors text-center"
                                    onClick={pickMultipleFiles}>
                                    <Show when={filePaths().length > 0} fallback={
                                        <div>
                                            <svg class="w-6 h-6 mx-auto text-base-content/20 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                            <p class="text-xs text-base-content/40">Multiple files</p>
                                        </div>
                                    }>
                                        <div class="text-xs">
                                            <span class="font-medium text-primary">{filePaths().length} files</span>
                                            <span class="text-base-content/30 ml-1">({formatSize(fileSize())})</span>
                                        </div>
                                    </Show>
                                </button>
                            </Show>
                        </div>

                        {/* Zip action toggle */}
                        <Show when={filePath() && fileName().toLowerCase().endsWith('.zip') && contentType() === 'asset'}>
                            <div class="p-3 bg-base-300/30 border border-white/[0.04] rounded-lg mb-2">
                                <p class="text-[10px] text-base-content/40 mb-1.5">This is a .zip file. How should it be stored?</p>
                                <div class="flex gap-3">
                                    <label class="flex items-center gap-1.5 cursor-pointer">
                                        <input type="radio" name="zip_action" class="radio radio-xs radio-primary"
                                            checked={zipAction() === 'keep'} onChange={() => setZipAction('keep')} />
                                        <span class="text-xs text-base-content/60">Keep as zip</span>
                                    </label>
                                    <label class="flex items-center gap-1.5 cursor-pointer">
                                        <input type="radio" name="zip_action" class="radio radio-xs radio-primary"
                                            checked={zipAction() === 'extract'} onChange={() => setZipAction('extract')} />
                                        <span class="text-xs text-base-content/60">Extract contents</span>
                                    </label>
                                </div>
                            </div>
                        </Show>

                        {/* Multi-file list */}
                        <Show when={filePaths().length > 0}>
                            <div class="space-y-1 max-h-32 overflow-y-auto">
                                <For each={filePaths()}>
                                    {(f) => (
                                        <div class="flex items-center gap-2 px-2.5 py-1.5 bg-base-300/20 rounded-md text-[10px]">
                                            <svg class="w-3 h-3 text-base-content/30 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
                                            <span class="flex-1 truncate text-base-content/60">{f.name}</span>
                                            <span class="text-base-content/25">{formatSize(f.size)}</span>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </div>

                    {/* Thumbnail */}
                    <div>
                        <label class="block text-xs text-base-content/50 mb-1">Cover Image</label>
                        <button class="w-full p-3 border border-dashed border-white/[0.06] rounded-xl hover:border-primary/30 transition-colors text-center"
                            onClick={pickThumbnail}>
                            <Show when={thumbPath()} fallback={
                                <p class="text-xs text-base-content/40">Click to select thumbnail (PNG, JPG)</p>
                            }>
                                <span class="text-xs text-primary font-medium">{thumbName()}</span>
                            </Show>
                        </button>
                    </div>

                    {/* Screenshots */}
                    <div>
                        <label class="block text-xs text-base-content/50 mb-1">Screenshots (up to 10)</label>
                        <button class="w-full p-3 border border-dashed border-white/[0.06] rounded-xl hover:border-primary/30 transition-colors text-center"
                            onClick={pickScreenshots}>
                            <Show when={screenshotPaths().length > 0} fallback={
                                <p class="text-xs text-base-content/40">Click to select screenshots</p>
                            }>
                                <span class="text-xs text-primary font-medium">{screenshotPaths().length} screenshot{screenshotPaths().length !== 1 ? 's' : ''} selected</span>
                            </Show>
                        </button>
                    </div>
                </div>

                <div class="flex gap-2 mt-4">
                    <button class="btn btn-ghost btn-sm rounded-lg text-xs" onClick={prevStep}>Back</button>
                    <button class="btn btn-primary btn-sm rounded-lg flex-1 text-xs" onClick={nextStep}>Continue</button>
                </div>
            </Show>

            {/* ═══════ STEP 4: Review ═══════ */}
            <Show when={step() === 4}>
                <div class="p-5 bg-base-200/30 border border-white/[0.04] rounded-xl">
                    <h2 class="text-sm font-semibold mb-4">Review & Submit</h2>
                    <div class="divide-y divide-white/[0.04] text-xs">
                        <ReviewRow label="Type" value={contentType() === 'game' ? 'Game' : 'Marketplace Asset'} />
                        <ReviewRow label="Category" value={categoryName()} />
                        <ReviewRow label="Name" value={name()} />
                        <ReviewRow label="Description" value={description().length > 100 ? description().substring(0, 100) + '...' : description()} />
                        <ReviewRow label="Version" value={version()} />
                        <ReviewRow label="Price" value={price() === 0 ? 'Free' : `${price()} credits`} />
                        <Show when={contentType() === 'asset' && tags().length > 0}>
                            <ReviewRow label="Tags" value={tags().join(', ')} />
                        </Show>
                        <Show when={contentType() === 'asset' && downloadFilename()}>
                            <ReviewRow label="Download Filename" value={downloadFilename()} />
                        </Show>
                        <Show when={contentType() === 'asset' && creditName()}>
                            <ReviewRow label="Credit" value={`${creditName()}${creditUrl() ? ` (${creditUrl()})` : ''}`} />
                            <ReviewRow label="Price" value="Free (credited asset)" />
                        </Show>
                        <ReviewRow label="File" value={fileName() ? `${fileName()} (${formatSize(fileSize())})` : 'None'} />
                        <Show when={thumbName()}><ReviewRow label="Cover Image" value={thumbName()} /></Show>
                        <Show when={screenshotPaths().length > 0}><ReviewRow label="Screenshots" value={`${screenshotPaths().length} image${screenshotPaths().length !== 1 ? 's' : ''}`} /></Show>
                    </div>
                </div>

                <div class="flex gap-2 mt-4">
                    <button class="btn btn-ghost btn-sm rounded-lg text-xs" onClick={prevStep}>Back</button>
                    <button class="btn btn-primary btn-sm rounded-lg flex-1 text-xs" onClick={handlePublish} disabled={uploading()}>
                        <Show when={uploading()} fallback={contentType() === 'game' ? 'Publish Game' : 'Upload as Draft'}>
                            <span class="loading loading-spinner loading-xs" /> Uploading...
                        </Show>
                    </button>
                </div>
            </Show>

            {/* ═══════ STEP 5+: Done ═══════ */}
            <Show when={step() > totalSteps}>
                <div class="text-center py-12">
                    <div class="w-14 h-14 mx-auto rounded-full bg-success/15 flex items-center justify-center mb-4">
                        <svg class="w-7 h-7 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </div>
                    <h2 class="text-lg font-bold mb-2">Published!</h2>
                    <p class="text-xs text-base-content/40 mb-6">{success()}</p>
                    <button class="btn btn-primary btn-sm rounded-lg px-6 text-xs" onClick={() => { setStep(1); setContentType(null); setCategorySlug(''); setName(''); setDescription(''); setVersion('1.0.0'); setPrice(0); setTags([]); setFilePath(null); setFileName(''); setFileSize(0); setThumbPath(null); setThumbName(''); setScreenshotPaths([]); setDownloadFilename(''); setCreditName(''); setCreditUrl(''); setSuccess(''); setError(''); }}>
                        Publish Another
                    </button>
                </div>
            </Show>
        </div>
    );
}

function ReviewRow(props) {
    return (
        <div class="flex justify-between py-2">
            <span class="text-base-content/40">{props.label}</span>
            <span class="text-base-content/80 text-right max-w-[60%] truncate">{props.value}</span>
        </div>
    );
}
