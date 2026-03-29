import { createSignal, createResource, createEffect, For, Show } from 'solid-js';
import { fetchJson } from '../api.jsx';
import { IconSearch, IconDownload, IconStarFilled, IconCheck } from '../icons.jsx';
import { IconPlayerPlay } from '@tabler/icons-solidjs';

const ITEMS_PER_PAGE = 24;

export default function LibraryPage(props) {
    const [search, setSearch] = createSignal('');
    const [tab, setTab] = createSignal('games');
    const [page, setPage] = createSignal(1);
    const [downloadedIds, setDownloadedIds] = createSignal(new Set());

    const [gameData] = createResource(() =>
        fetchJson('/api/games/library').then(r => ({ items: r.games || [], error: r.error })).catch(() => ({ items: [], error: 'Connection failed' }))
    );

    const [assetData] = createResource(() =>
        fetchJson('/api/library').then(r => ({ items: r.assets || [], error: r.error })).catch(() => ({ items: [], error: 'Connection failed' }))
    );

    // Check which items are already downloaded
    createEffect(() => {
        const games = gameData()?.items || [];
        const assets = assetData()?.items || [];
        if (games.length === 0 && assets.length === 0) return;

        const gameIds = games.map(g => String(g.id));
        const assetIds = assets.map(a => String(a.id));

        Promise.all([
            gameIds.length > 0 ? fetchJson('/api/download/check', { method: 'POST', body: JSON.stringify({ ids: gameIds, type: 'game' }) }) : { downloaded_ids: [] },
            assetIds.length > 0 ? fetchJson('/api/download/check', { method: 'POST', body: JSON.stringify({ ids: assetIds, type: 'asset' }) }) : { downloaded_ids: [] },
        ]).then(([gameResult, assetResult]) => {
            const all = [...(gameResult.downloaded_ids || []), ...(assetResult.downloaded_ids || [])];
            setDownloadedIds(new Set(all));
        }).catch(() => {});
    });

    const notLoggedIn = () => gameData()?.error === 'Not logged in' || assetData()?.error === 'Not logged in';
    const isLoading = () => gameData.loading || assetData.loading;
    const games = () => gameData()?.items || [];
    const assets = () => assetData()?.items || [];
    const currentItems = () => tab() === 'games' ? games() : assets();
    const filtered = () => {
        const items = currentItems();
        if (!search()) return items;
        return items.filter(a => a.name.toLowerCase().includes(search().toLowerCase()));
    };
    const totalCount = () => games().length + assets().length;
    const totalPages = () => Math.ceil(filtered().length / ITEMS_PER_PAGE);
    const paged = () => filtered().slice((page() - 1) * ITEMS_PER_PAGE, page() * ITEMS_PER_PAGE);

    return (
        <div class="flex flex-col gap-5 p-6">
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-lg font-bold">Library</h1>
                    <p class="text-xs text-base-content/40 mt-0.5">
                        <Show when={!isLoading() && totalCount() > 0} fallback="Your purchased content">
                            {totalCount()} item{totalCount() !== 1 ? 's' : ''}
                        </Show>
                    </p>
                </div>
                <Show when={currentItems().length > 0}>
                    <div class="relative">
                        <IconSearch size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/25" />
                        <input type="text" class="input input-sm pl-8 w-48 rounded-lg bg-base-200/50 border-white/[0.04] text-xs" placeholder="Search library..." value={search()} onInput={(e) => { setSearch(e.target.value); setPage(1); }} />
                    </div>
                </Show>
            </div>

            <Show when={isLoading()}>
                <div class="flex flex-col items-center justify-center py-16 gap-3">
                    <span class="loading loading-spinner loading-md text-primary" />
                    <span class="text-xs text-base-content/40">Loading library...</span>
                </div>
            </Show>

            <Show when={!isLoading() && notLoggedIn()}>
                <div class="text-center py-20">
                    <div class="text-4xl mb-3 opacity-20">🔒</div>
                    <p class="text-sm text-base-content/40 mb-2">Sign in to view your library</p>
                    <p class="text-[11px] text-base-content/25 mb-4">Your purchased games and assets will appear here</p>
                    <button class="btn btn-primary btn-sm rounded-lg" onClick={() => props.setShowLogin(true)}>Sign in</button>
                </div>
            </Show>

            <Show when={!isLoading() && !notLoggedIn()}>
                <div class="flex gap-1 p-1 rounded-lg bg-base-200/30 border border-white/[0.04] w-fit">
                    <button class={`px-4 py-1.5 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${tab() === 'games' ? 'bg-primary/15 text-primary' : 'text-base-content/40 hover:text-base-content/60'}`} onClick={() => { setTab('games'); setPage(1); }}>
                        Games <Show when={games().length > 0}><span class="text-[9px] px-1.5 py-0.5 rounded-full bg-base-300/50">{games().length}</span></Show>
                    </button>
                    <button class={`px-4 py-1.5 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${tab() === 'assets' ? 'bg-primary/15 text-primary' : 'text-base-content/40 hover:text-base-content/60'}`} onClick={() => { setTab('assets'); setPage(1); }}>
                        Assets <Show when={assets().length > 0}><span class="text-[9px] px-1.5 py-0.5 rounded-full bg-base-300/50">{assets().length}</span></Show>
                    </button>
                </div>

                <Show when={currentItems().length === 0}>
                    <div class="text-center py-16">
                        <div class="text-4xl mb-3 opacity-20">{tab() === 'games' ? '🎮' : '📦'}</div>
                        <p class="text-sm text-base-content/40 mb-4">{tab() === 'games' ? 'No games in your library' : 'No assets in your library'}</p>
                        <button class="btn btn-primary btn-sm rounded-lg" onClick={() => props.setActive(tab() === 'games' ? 'store' : 'marketplace')}>
                            {tab() === 'games' ? 'Browse Game Store' : 'Browse Marketplace'}
                        </button>
                    </div>
                </Show>

                <Show when={filtered().length > 0}>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
                        <For each={paged()}>
                            {(item) => <Show when={tab() === 'games'} fallback={<AssetCard item={item} downloadedIds={downloadedIds} />}><GameCard game={item} downloadedIds={downloadedIds} /></Show>}
                        </For>
                    </div>
                </Show>

                <Show when={totalPages() > 1}>
                    <div class="flex items-center justify-center gap-2 pt-2">
                        <button class="btn btn-ghost btn-xs rounded-lg" disabled={page() <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                        <span class="text-[11px] text-base-content/40">Page {page()} of {totalPages()}</span>
                        <button class="btn btn-ghost btn-xs rounded-lg" disabled={page() >= totalPages()} onClick={() => setPage(p => p + 1)}>Next</button>
                    </div>
                </Show>

                <Show when={currentItems().length > 0 && filtered().length === 0}>
                    <div class="text-center py-16"><p class="text-sm text-base-content/30">No items match "{search()}"</p></div>
                </Show>
            </Show>
        </div>
    );
}

function useDownload(id, name, type, alreadyDownloaded) {
    const [status, setStatus] = createSignal(alreadyDownloaded ? 'done' : 'idle'); // idle, downloading, done, error
    const [progress, setProgress] = createSignal(0);
    const [error, setError] = createSignal('');

    async function start(e) {
        if (e) e.stopPropagation();
        if (status() === 'downloading') return;
        setStatus('downloading');
        setError('');
        setProgress(0);

        const result = await fetchJson('/api/download/start', { method: 'POST', body: JSON.stringify({ id: String(id), name, type }) });
        if (result.error) { setStatus('error'); setError(result.error); return; }

        // Poll progress
        const poll = setInterval(async () => {
            const p = await fetchJson(`/api/download/progress?id=${encodeURIComponent(String(id))}`);
            if (p.error && p.error !== 'No download found') { clearInterval(poll); setStatus('error'); setError(p.error); return; }
            if (p.total > 0) setProgress(Math.round((p.downloaded / p.total) * 100));
            if (p.status === 'done') { clearInterval(poll); setStatus('done'); setProgress(100); fetchJson('/api/download/clear', { method: 'POST', body: JSON.stringify({ id: String(id) }) }); }
            if (p.status === 'error') { clearInterval(poll); setStatus('error'); setError(p.error || 'Download failed'); }
        }, 300);
    }

    return { status, progress, error, start };
}

function GameCard(props) {
    const game = props.game;
    const isAlreadyDownloaded = () => props.downloadedIds()?.has(String(game.id));
    const dl = useDownload(game.id, game.name, 'game', isAlreadyDownloaded());

    return (
        <div class="group rounded-xl overflow-hidden border border-white/[0.04] hover:border-primary/20 transition-all">
            <div class="aspect-[16/9] bg-base-300/50 relative overflow-hidden">
                <Show when={game.thumbnail_url} fallback={<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10"><span class="text-3xl opacity-20">🎮</span></div>}>
                    <img src={game.thumbnail_url} alt={game.name} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                </Show>
                <Show when={game.category}><div class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/40 text-white/70 text-[9px] font-medium backdrop-blur-sm">{game.category}</div></Show>
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Show when={dl.status() === 'done'}>
                        <button class="btn btn-sm btn-success rounded-full w-12 h-12 p-0"><IconPlayerPlay size={20} /></button>
                    </Show>
                    <Show when={dl.status() === 'idle'}>
                        <button class="btn btn-sm btn-primary rounded-full w-12 h-12 p-0" onClick={dl.start}><IconDownload size={20} /></button>
                    </Show>
                    <Show when={dl.status() === 'downloading'}>
                        <div class="radial-progress text-primary text-xs" style={`--value:${dl.progress()}; --size:3rem;`} role="progressbar">{dl.progress()}%</div>
                    </Show>
                </div>
            </div>
            <div class="p-3 bg-base-200/40">
                <div class="flex items-center justify-between">
                    <div class="min-w-0"><div class="text-xs font-semibold truncate">{game.name}</div><div class="text-[10px] text-base-content/30 truncate">{game.creator_name}</div></div>
                    <Show when={dl.status() === 'done'}><div class="flex items-center gap-1 text-success text-[10px] shrink-0"><IconCheck size={12} /> Ready</div></Show>
                </div>
                <Show when={dl.status() === 'downloading'}>
                    <div class="mt-2 w-full bg-base-300/50 rounded-full h-1.5">
                        <div class="bg-primary h-1.5 rounded-full transition-all" style={`width: ${dl.progress()}%`} />
                    </div>
                </Show>
                <Show when={dl.error()}><div class="text-[9px] text-error mt-1">{dl.error()}</div></Show>
            </div>
        </div>
    );
}

function AssetCard(props) {
    const item = props.item;
    const isAlreadyDownloaded = () => props.downloadedIds()?.has(String(item.id));
    const dl = useDownload(item.id, item.name, 'asset', isAlreadyDownloaded());

    return (
        <div class="group rounded-xl overflow-hidden border border-white/[0.04] hover:border-primary/20 transition-all">
            <div class="aspect-[16/9] bg-base-300/50 relative overflow-hidden">
                <Show when={item.thumbnail_url} fallback={<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10"><span class="text-3xl opacity-20">📦</span></div>}>
                    <img src={item.thumbnail_url} alt={item.name} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                </Show>
            </div>
            <div class="p-3 bg-base-200/40">
                <div class="text-xs font-semibold truncate mb-0.5">{item.name}</div>
                <div class="text-[10px] text-base-content/35 truncate mb-2">{item.creator_name}</div>
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <Show when={item.rating_avg > 0}><div class="flex items-center gap-0.5 text-accent"><IconStarFilled size={10} /><span class="text-[10px] font-medium">{item.rating_avg.toFixed(1)}</span></div></Show>
                    </div>
                    <Show when={dl.status() === 'done'}>
                        <div class="flex items-center gap-1 text-success text-[10px]"><IconCheck size={12} /> Downloaded</div>
                    </Show>
                    <Show when={dl.status() === 'idle'}>
                        <button class="btn btn-primary btn-xs rounded-lg gap-1" onClick={dl.start}><IconDownload size={12} /> Download</button>
                    </Show>
                    <Show when={dl.status() === 'downloading'}>
                        <span class="text-[10px] text-primary font-medium">{dl.progress()}%</span>
                    </Show>
                </div>
                <Show when={dl.status() === 'downloading'}>
                    <div class="mt-2 w-full bg-base-300/50 rounded-full h-1.5">
                        <div class="bg-primary h-1.5 rounded-full transition-all" style={`width: ${dl.progress()}%`} />
                    </div>
                </Show>
                <Show when={dl.error()}><div class="text-[9px] text-error mt-1">{dl.error()}</div></Show>
            </div>
        </div>
    );
}
