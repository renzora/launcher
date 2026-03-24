import { createSignal, createResource, For, Show } from 'solid-js';
import { IconSearch, IconStarFilled, IconDownload } from './icons.jsx';

const GAMES_API = 'https://renzora.com/api/games';

async function fetchGames(params = {}) {
    try {
        const url = new URL(GAMES_API);
        if (params.q) url.searchParams.set('q', params.q);
        if (params.category && params.category !== 'all') url.searchParams.set('category', params.category);
        if (params.sort) url.searchParams.set('sort', params.sort);
        if (params.page) url.searchParams.set('page', params.page);
        if (params.free) url.searchParams.set('free', 'true');

        const resp = await fetch(url.toString());
        if (!resp.ok) return { games: [], total: 0, page: 1, per_page: 24 };
        const data = await resp.json();
        return { games: data.games || [], total: data.total || 0, page: data.page || 1, per_page: data.per_page || 24 };
    } catch {
        return { games: [], total: 0, page: 1, per_page: 24 };
    }
}

async function fetchCategories() {
    try {
        const resp = await fetch(`${GAMES_API}/categories`);
        if (!resp.ok) return [];
        return await resp.json();
    } catch {
        return [];
    }
}

export default function StorePage(props) {
    const [search, setSearch] = createSignal('');
    const [category, setCategory] = createSignal('all');
    const [sort, setSort] = createSignal('newest');
    const [page, setPage] = createSignal(1);
    const [searchTimeout, setSearchTimeout] = createSignal(null);

    const [categories] = createResource(fetchCategories);

    const [data] = createResource(
        () => ({ q: search(), category: category(), sort: sort(), page: page() }),
        fetchGames
    );

    function handleSearch(value) {
        if (searchTimeout()) clearTimeout(searchTimeout());
        setSearchTimeout(setTimeout(() => {
            setSearch(value);
            setPage(1);
        }, 300));
    }

    function changeCategory(cat) {
        setCategory(cat);
        setPage(1);
    }

    const games = () => data()?.games || [];
    const total = () => data()?.total || 0;
    const totalPages = () => Math.ceil(total() / 24);

    return (
        <div class="flex flex-col gap-5 p-6">
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-lg font-bold">Game Store</h1>
                    <p class="text-xs text-base-content/40 mt-0.5">
                        Discover and play games built with Renzora
                        <Show when={total() > 0}>
                            <span class="ml-1">· {total()} games</span>
                        </Show>
                    </p>
                </div>
            </div>

            {/* Search + Sort */}
            <div class="flex items-center gap-3">
                <div class="relative flex-1">
                    <IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/25" />
                    <input
                        type="text"
                        class="input input-sm w-full pl-9 rounded-lg bg-base-200/50 border-white/[0.04] text-xs focus:border-primary/30"
                        placeholder="Search games..."
                        onInput={(e) => handleSearch(e.target.value)}
                    />
                </div>
                <select
                    class="select select-sm rounded-lg bg-base-200/50 border-white/[0.04] text-xs min-h-0 h-8"
                    value={sort()}
                    onChange={(e) => { setSort(e.target.value); setPage(1); }}
                >
                    <option value="newest">Newest</option>
                    <option value="popular">Most Popular</option>
                    <option value="top_rated">Top Rated</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                </select>
            </div>

            {/* Categories */}
            <div class="flex gap-1.5 flex-wrap">
                <CategoryPill label="All" slug="all" active={category()} onClick={changeCategory} />
                <Show when={categories()}>
                    <For each={categories()}>
                        {(cat) => <CategoryPill label={cat.name} slug={cat.slug} active={category()} onClick={changeCategory} />}
                    </For>
                </Show>
            </div>

            {/* Loading */}
            <Show when={data.loading}>
                <div class="flex flex-col items-center justify-center py-16 gap-3">
                    <span class="loading loading-spinner loading-md text-primary" />
                    <span class="text-xs text-base-content/40">Loading games...</span>
                </div>
            </Show>

            <Show when={!data.loading}>
                <Show when={games().length > 0} fallback={
                    <div class="text-center py-16">
                        <div class="text-4xl mb-3 opacity-15">🎮</div>
                        <p class="text-sm text-base-content/30">No games found</p>
                        <Show when={search()}>
                            <p class="text-[11px] text-base-content/20 mt-1">Try a different search term</p>
                        </Show>
                    </div>
                }>
                    <div class="grid grid-cols-2 xl:grid-cols-3 gap-4">
                        <For each={games()}>
                            {(game) => <GameCard game={game} />}
                        </For>
                    </div>
                </Show>

                <Show when={totalPages() > 1}>
                    <div class="flex items-center justify-center gap-2 pt-2">
                        <button class="btn btn-ghost btn-xs rounded-lg" disabled={page() <= 1} onClick={() => setPage(p => p - 1)}>
                            Previous
                        </button>
                        <span class="text-[11px] text-base-content/40">Page {page()} of {totalPages()}</span>
                        <button class="btn btn-ghost btn-xs rounded-lg" disabled={page() >= totalPages()} onClick={() => setPage(p => p + 1)}>
                            Next
                        </button>
                    </div>
                </Show>
            </Show>
        </div>
    );
}

function CategoryPill(props) {
    return (
        <button
            class={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                props.active === props.slug
                    ? 'bg-primary/15 text-primary'
                    : 'text-base-content/40 hover:text-base-content/60 hover:bg-white/[0.03]'
            }`}
            onClick={() => props.onClick(props.slug)}
        >
            {props.label}
        </button>
    );
}

function GameCard(props) {
    const game = props.game;
    const isFree = () => game.price_credits === 0;
    const rating = () => game.rating_avg ? game.rating_avg.toFixed(1) : null;

    return (
        <a
            href={`https://renzora.com/games/${game.slug}`}
            target="_blank"
            class="group rounded-xl overflow-hidden border border-white/[0.04] hover:border-primary/20 transition-all cursor-pointer hover:scale-[1.01]"
        >
            <div class="aspect-[16/9] bg-base-300/50 relative overflow-hidden">
                <Show
                    when={game.thumbnail_url}
                    fallback={
                        <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
                            <span class="text-3xl opacity-20">🎮</span>
                        </div>
                    }
                >
                    <img
                        src={game.thumbnail_url}
                        alt={game.name}
                        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                    />
                </Show>
                <Show when={isFree()}>
                    <div class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-success/20 text-success text-[9px] font-bold backdrop-blur-sm">
                        FREE
                    </div>
                </Show>
                <Show when={game.category}>
                    <div class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/40 text-white/70 text-[9px] font-medium backdrop-blur-sm">
                        {game.category}
                    </div>
                </Show>
            </div>
            <div class="p-3 bg-base-200/40">
                <div class="text-xs font-semibold mb-0.5 truncate">{game.name}</div>
                <div class="text-[10px] text-base-content/35 truncate mb-2">{game.creator_name}</div>
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <Show when={rating()}>
                            <div class="flex items-center gap-0.5 text-accent">
                                <IconStarFilled size={10} />
                                <span class="text-[10px] font-medium">{rating()}</span>
                            </div>
                        </Show>
                        <Show when={game.downloads > 0}>
                            <div class="flex items-center gap-0.5 text-base-content/25">
                                <IconDownload size={10} />
                                <span class="text-[10px]">{game.downloads}</span>
                            </div>
                        </Show>
                    </div>
                    <Show when={!isFree()}>
                        <span class="text-[10px] font-medium text-accent">{game.price_credits} credits</span>
                    </Show>
                </div>
            </div>
        </a>
    );
}
