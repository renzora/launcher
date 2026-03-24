import { createSignal, createResource, For, Show, onMount } from 'solid-js';
import { IconSearch, IconStarFilled, IconDownload } from './icons.jsx';

const RENZORA_API = 'https://renzora.com/api/marketplace';

async function fetchMarketplace(params = {}) {
    try {
        const url = new URL(RENZORA_API);
        if (params.q) url.searchParams.set('q', params.q);
        if (params.category && params.category !== 'all') url.searchParams.set('category', params.category);
        if (params.sort) url.searchParams.set('sort', params.sort);
        if (params.page) url.searchParams.set('page', params.page);
        if (params.free) url.searchParams.set('free', 'true');

        const resp = await fetch(url.toString());
        if (!resp.ok) return { assets: [], total: 0, page: 1, per_page: 24 };
        const data = await resp.json();
        return {
            assets: data.assets || [],
            total: data.total || 0,
            page: data.page || 1,
            per_page: data.per_page || 24,
        };
    } catch {
        return { assets: [], total: 0, page: 1, per_page: 24 };
    }
}

async function fetchCategories() {
    try {
        const resp = await fetch(`${RENZORA_API}/categories`);
        if (!resp.ok) return [];
        return await resp.json();
    } catch {
        return [];
    }
}

export default function MarketplacePage() {
    const [search, setSearch] = createSignal('');
    const [category, setCategory] = createSignal('all');
    const [sort, setSort] = createSignal('newest');
    const [page, setPage] = createSignal(1);
    const [searchTimeout, setSearchTimeout] = createSignal(null);

    const [categories] = createResource(fetchCategories);

    const [data, { refetch }] = createResource(
        () => ({ q: search(), category: category(), sort: sort(), page: page() }),
        fetchMarketplace
    );

    function handleSearch(value) {
        // Debounce search
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

    function changeSort(s) {
        setSort(s);
        setPage(1);
    }

    const assets = () => data()?.assets || [];
    const total = () => data()?.total || 0;
    const totalPages = () => Math.ceil(total() / 24);

    return (
        <div class="flex flex-col gap-5 p-6">
            {/* Header */}
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-lg font-bold">Marketplace</h1>
                    <p class="text-xs text-base-content/40 mt-0.5">
                        Assets, plugins, and templates from the community
                        <Show when={total() > 0}>
                            <span class="ml-1">· {total()} items</span>
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
                        placeholder="Search marketplace..."
                        onInput={(e) => handleSearch(e.target.value)}
                    />
                </div>
                <select
                    class="select select-sm rounded-lg bg-base-200/50 border-white/[0.04] text-xs min-h-0 h-8"
                    value={sort()}
                    onChange={(e) => changeSort(e.target.value)}
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
                <CategoryPill
                    label="All"
                    slug="all"
                    active={category()}
                    onClick={changeCategory}
                />
                <Show when={categories()}>
                    <For each={categories()}>
                        {(cat) => (
                            <CategoryPill
                                label={cat.name}
                                slug={cat.slug}
                                active={category()}
                                onClick={changeCategory}
                            />
                        )}
                    </For>
                </Show>
            </div>

            {/* Loading */}
            <Show when={data.loading}>
                <div class="flex flex-col items-center justify-center py-16 gap-3">
                    <span class="loading loading-spinner loading-md text-primary" />
                    <span class="text-xs text-base-content/40">Loading marketplace...</span>
                </div>
            </Show>

            {/* Grid */}
            <Show when={!data.loading}>
                <Show when={assets().length > 0} fallback={
                    <div class="text-center py-16">
                        <div class="text-4xl mb-3 opacity-15">🏪</div>
                        <p class="text-sm text-base-content/30">No items found</p>
                        <Show when={search()}>
                            <p class="text-[11px] text-base-content/20 mt-1">Try a different search term</p>
                        </Show>
                    </div>
                }>
                    <div class="grid grid-cols-2 xl:grid-cols-3 gap-3">
                        <For each={assets()}>
                            {(asset) => <AssetCard asset={asset} />}
                        </For>
                    </div>
                </Show>

                {/* Pagination */}
                <Show when={totalPages() > 1}>
                    <div class="flex items-center justify-center gap-2 pt-2">
                        <button
                            class="btn btn-ghost btn-xs rounded-lg"
                            disabled={page() <= 1}
                            onClick={() => setPage(p => p - 1)}
                        >
                            Previous
                        </button>
                        <span class="text-[11px] text-base-content/40">
                            Page {page()} of {totalPages()}
                        </span>
                        <button
                            class="btn btn-ghost btn-xs rounded-lg"
                            disabled={page() >= totalPages()}
                            onClick={() => setPage(p => p + 1)}
                        >
                            Next
                        </button>
                    </div>
                </Show>
            </Show>
        </div>
    );
}

function CategoryPill(props) {
    const isActive = () => props.active === props.slug;
    return (
        <button
            class={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                isActive()
                    ? 'bg-primary/15 text-primary'
                    : 'text-base-content/40 hover:text-base-content/60 hover:bg-white/[0.03]'
            }`}
            onClick={() => props.onClick(props.slug)}
        >
            {props.label}
        </button>
    );
}

function AssetCard(props) {
    const asset = props.asset;
    const isFree = () => asset.price_credits === 0;
    const rating = () => asset.rating_avg ? asset.rating_avg.toFixed(1) : null;

    return (
        <a
            href={`https://renzora.com/marketplace/asset/${asset.slug}`}
            target="_blank"
            class="group rounded-xl overflow-hidden border border-white/[0.04] hover:border-primary/20 transition-all cursor-pointer hover:scale-[1.01]"
        >
            {/* Thumbnail */}
            <div class="aspect-[16/10] bg-base-300/50 relative overflow-hidden">
                <Show
                    when={asset.thumbnail_url}
                    fallback={
                        <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
                            <span class="text-2xl opacity-20">📦</span>
                        </div>
                    }
                >
                    <img
                        src={asset.thumbnail_url}
                        alt={asset.name}
                        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                    />
                </Show>
                <Show when={isFree()}>
                    <div class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-success/20 text-success text-[9px] font-bold backdrop-blur-sm">
                        FREE
                    </div>
                </Show>
                <Show when={asset.category}>
                    <div class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/40 text-white/70 text-[9px] font-medium backdrop-blur-sm">
                        {asset.category}
                    </div>
                </Show>
            </div>

            {/* Info */}
            <div class="p-3 bg-base-200/40">
                <div class="text-xs font-semibold mb-0.5 truncate">{asset.name}</div>
                <div class="text-[10px] text-base-content/35 mb-2 truncate">{asset.creator_name}</div>
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <Show when={rating()}>
                            <div class="flex items-center gap-0.5 text-accent">
                                <IconStarFilled size={12} />
                                <span class="text-[10px] font-medium">{rating()}</span>
                            </div>
                        </Show>
                        <Show when={asset.downloads > 0}>
                            <div class="flex items-center gap-0.5 text-base-content/25">
                                <IconDownload size={10} />
                                <span class="text-[10px]">{asset.downloads}</span>
                            </div>
                        </Show>
                    </div>
                    <Show when={!isFree()}>
                        <span class="text-[10px] font-medium text-accent">{asset.price_credits} credits</span>
                    </Show>
                </div>
            </div>
        </a>
    );
}
