import { createSignal, createResource, For, Show } from 'solid-js';
import { API, fetchJson } from './api.jsx';
import { IconSearch, IconDownload, IconStarFilled, IconCheck } from './icons.jsx';
import { IconPlayerPlay } from '@tabler/icons-solidjs';

export default function LibraryPage(props) {
    const [search, setSearch] = createSignal('');
    const [tab, setTab] = createSignal('games');

    const [gameData] = createResource(() =>
        fetchJson(`${API}/game-library`)
            .then((r) => ({ items: r.games || [], error: r.error }))
            .catch(() => ({ items: [], error: 'Connection failed' }))
    );

    const [assetData] = createResource(() =>
        fetchJson(`${API}/library`)
            .then((r) => ({ items: r.assets || [], error: r.error }))
            .catch(() => ({ items: [], error: 'Connection failed' }))
    );

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
                        <input
                            type="text"
                            class="input input-sm pl-8 w-48 rounded-lg bg-base-200/50 border-white/[0.04] text-xs"
                            placeholder="Search library..."
                            value={search()}
                            onInput={(e) => setSearch(e.target.value)}
                        />
                    </div>
                </Show>
            </div>

            {/* Loading */}
            <Show when={isLoading()}>
                <div class="flex flex-col items-center justify-center py-16 gap-3">
                    <span class="loading loading-spinner loading-md text-primary" />
                    <span class="text-xs text-base-content/40">Loading library...</span>
                </div>
            </Show>

            {/* Not logged in */}
            <Show when={!isLoading() && notLoggedIn()}>
                <div class="text-center py-20">
                    <div class="text-4xl mb-3 opacity-20">🔒</div>
                    <p class="text-sm text-base-content/40 mb-2">Sign in to view your library</p>
                    <p class="text-[11px] text-base-content/25 mb-4">Your purchased games and assets will appear here</p>
                    <button class="btn btn-primary btn-sm rounded-lg" onClick={() => props.setShowLogin(true)}>
                        Sign in
                    </button>
                </div>
            </Show>

            {/* Content */}
            <Show when={!isLoading() && !notLoggedIn()}>
                {/* Tabs */}
                <div class="flex gap-1 p-1 rounded-lg bg-base-200/30 border border-white/[0.04] w-fit">
                    <button
                        class={`px-4 py-1.5 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                            tab() === 'games' ? 'bg-primary/15 text-primary' : 'text-base-content/40 hover:text-base-content/60'
                        }`}
                        onClick={() => setTab('games')}
                    >
                        Games
                        <Show when={games().length > 0}>
                            <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-base-300/50">{games().length}</span>
                        </Show>
                    </button>
                    <button
                        class={`px-4 py-1.5 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                            tab() === 'assets' ? 'bg-primary/15 text-primary' : 'text-base-content/40 hover:text-base-content/60'
                        }`}
                        onClick={() => setTab('assets')}
                    >
                        Assets
                        <Show when={assets().length > 0}>
                            <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-base-300/50">{assets().length}</span>
                        </Show>
                    </button>
                </div>

                {/* Empty state */}
                <Show when={currentItems().length === 0}>
                    <div class="text-center py-16">
                        <div class="text-4xl mb-3 opacity-20">{tab() === 'games' ? '🎮' : '📦'}</div>
                        <p class="text-sm text-base-content/40 mb-4">
                            {tab() === 'games' ? 'No games in your library' : 'No assets in your library'}
                        </p>
                        <button
                            class="btn btn-primary btn-sm rounded-lg"
                            onClick={() => props.setActive(tab() === 'games' ? 'store' : 'marketplace')}
                        >
                            {tab() === 'games' ? 'Browse Game Store' : 'Browse Marketplace'}
                        </button>
                    </div>
                </Show>

                {/* Items grid */}
                <Show when={filtered().length > 0}>
                    <div class="grid grid-cols-2 xl:grid-cols-3 gap-4">
                        <For each={filtered()}>
                            {(item) => (
                                <Show when={tab() === 'games'} fallback={<AssetCard item={item} />}>
                                    <GameCard game={item} />
                                </Show>
                            )}
                        </For>
                    </div>
                </Show>

                {/* No search results */}
                <Show when={currentItems().length > 0 && filtered().length === 0}>
                    <div class="text-center py-16">
                        <p class="text-sm text-base-content/30">No items match "{search()}"</p>
                    </div>
                </Show>
            </Show>
        </div>
    );
}

function GameCard(props) {
    const game = props.game;
    const [downloading, setDownloading] = createSignal(false);
    const [downloaded, setDownloaded] = createSignal(false);

    async function download() {
        setDownloading(true);
        const result = await fetchJson(`${API}/download`, {
            method: 'POST',
            body: JSON.stringify({ id: game.id, name: game.name }),
        });
        if (!result.error) setDownloaded(true);
        setDownloading(false);
    }

    return (
        <div class="group rounded-xl overflow-hidden border border-white/[0.04] hover:border-primary/20 transition-all">
            <div class="aspect-[16/9] bg-base-300/50 relative overflow-hidden">
                <Show
                    when={game.thumbnail_url}
                    fallback={
                        <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
                            <span class="text-3xl opacity-20">🎮</span>
                        </div>
                    }
                >
                    <img src={game.thumbnail_url} alt={game.name} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                </Show>
                <Show when={game.category}>
                    <div class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/40 text-white/70 text-[9px] font-medium backdrop-blur-sm">
                        {game.category}
                    </div>
                </Show>
                {/* Play overlay */}
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Show when={downloaded()} fallback={
                        <button
                            class="btn btn-sm btn-primary rounded-full w-12 h-12 p-0"
                            onClick={download}
                            disabled={downloading()}
                        >
                            <Show when={!downloading()} fallback={<span class="loading loading-spinner loading-sm" />}>
                                <IconDownload size={20} />
                            </Show>
                        </button>
                    }>
                        <button class="btn btn-sm btn-success rounded-full w-12 h-12 p-0">
                            <IconPlayerPlay size={20} />
                        </button>
                    </Show>
                </div>
            </div>
            <div class="p-3 bg-base-200/40">
                <div class="flex items-center justify-between">
                    <div class="min-w-0">
                        <div class="text-xs font-semibold truncate">{game.name}</div>
                        <div class="text-[10px] text-base-content/30 truncate">{game.creator_name}</div>
                    </div>
                    <Show when={downloaded()}>
                        <div class="flex items-center gap-1 text-success text-[10px] shrink-0">
                            <IconCheck size={12} /> Ready
                        </div>
                    </Show>
                </div>
            </div>
        </div>
    );
}

function AssetCard(props) {
    const item = props.item;
    const [downloading, setDownloading] = createSignal(false);
    const [downloaded, setDownloaded] = createSignal(false);

    async function download() {
        setDownloading(true);
        const result = await fetchJson(`${API}/download`, {
            method: 'POST',
            body: JSON.stringify({ id: item.id, name: item.name }),
        });
        if (!result.error) setDownloaded(true);
        setDownloading(false);
    }

    return (
        <div class="group rounded-xl overflow-hidden border border-white/[0.04] hover:border-primary/20 transition-all">
            <div class="aspect-[16/9] bg-base-300/50 relative overflow-hidden">
                <Show
                    when={item.thumbnail_url}
                    fallback={
                        <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
                            <span class="text-3xl opacity-20">📦</span>
                        </div>
                    }
                >
                    <img src={item.thumbnail_url} alt={item.name} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                </Show>
            </div>
            <div class="p-3 bg-base-200/40">
                <div class="text-xs font-semibold truncate mb-0.5">{item.name}</div>
                <div class="text-[10px] text-base-content/35 truncate mb-2">{item.creator_name}</div>
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <Show when={item.rating_avg > 0}>
                            <div class="flex items-center gap-0.5 text-accent">
                                <IconStarFilled size={10} />
                                <span class="text-[10px] font-medium">{item.rating_avg.toFixed(1)}</span>
                            </div>
                        </Show>
                    </div>
                    <Show when={downloaded()} fallback={
                        <button
                            class="btn btn-primary btn-xs rounded-lg gap-1"
                            onClick={download}
                            disabled={downloading()}
                        >
                            <Show when={!downloading()} fallback={<span class="loading loading-spinner loading-xs" />}>
                                <IconDownload size={12} />
                            </Show>
                            {downloading() ? '...' : 'Download'}
                        </button>
                    }>
                        <div class="flex items-center gap-1 text-success text-[10px]">
                            <IconCheck size={12} /> Downloaded
                        </div>
                    </Show>
                </div>
            </div>
        </div>
    );
}
