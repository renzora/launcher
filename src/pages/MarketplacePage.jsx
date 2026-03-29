import { createSignal, createResource, createEffect, For, Show } from 'solid-js';
import { IconSearch, IconStarFilled, IconDownload } from '../icons.jsx';
import { fetchJson } from '../api.jsx';

async function fetchMarketplace(params = {}) {
    try {
        const body = { path: 'marketplace', method: 'GET' };
        const qs = new URLSearchParams();
        if (params.q) qs.set('q', params.q);
        if (params.category && params.category !== 'all') qs.set('category', params.category);
        if (params.sort) qs.set('sort', params.sort);
        if (params.page) qs.set('page', params.page);
        if (params.free) qs.set('free', 'true');
        if (qs.toString()) body.path += '?' + qs.toString();

        const data = await fetchJson('/api/proxy', { method: 'POST', body: JSON.stringify(body) });
        return { assets: data.assets || [], total: data.total || 0, page: data.page || 1, per_page: data.per_page || 24 };
    } catch {
        return { assets: [], total: 0, page: 1, per_page: 24 };
    }
}

async function fetchCategories() {
    try {
        const data = await fetchJson('/api/proxy', { method: 'POST', body: JSON.stringify({ path: 'marketplace/categories', method: 'GET' }) });
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

export default function MarketplacePage(props) {
    const [search, setSearch] = createSignal('');
    const [category, setCategory] = createSignal('all');
    const [sort, setSort] = createSignal('newest');
    const [page, setPage] = createSignal(1);
    const [searchTimeout, setSearchTimeout] = createSignal(null);
    const [ownedIds, setOwnedIds] = createSignal(new Set());

    const [categories] = createResource(fetchCategories);

    const [data] = createResource(
        () => ({ q: search(), category: category(), sort: sort(), page: page() }),
        fetchMarketplace
    );

    createEffect(() => {
        const items = data()?.assets || [];
        if (items.length === 0) return;
        const ids = items.map(a => a.id);
        fetchJson('/api/check-owned', { method: 'POST', body: JSON.stringify({ asset_ids: ids }) })
            .then(res => { if (res.owned_ids) setOwnedIds(new Set(res.owned_ids)); })
            .catch(() => {});
    });

    function handleSearch(value) {
        if (searchTimeout()) clearTimeout(searchTimeout());
        setSearchTimeout(setTimeout(() => { setSearch(value); setPage(1); }, 300));
    }

    const assets = () => data()?.assets || [];
    const total = () => data()?.total || 0;
    const totalPages = () => Math.ceil(total() / 24);

    return (
        <div class="flex flex-col gap-5 p-6">
            <div>
                <h1 class="text-lg font-bold">Marketplace</h1>
                <p class="text-xs text-base-content/40 mt-0.5">
                    Assets, plugins, and templates from the community
                    <Show when={total() > 0}><span class="ml-1">· {total()} items</span></Show>
                </p>
            </div>

            <div class="flex items-center gap-3">
                <div class="relative flex-1">
                    <IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/25" />
                    <input type="text" class="input input-sm w-full pl-9 rounded-lg bg-base-200/50 border-white/[0.04] text-xs focus:border-primary/30" placeholder="Search marketplace..." onInput={(e) => handleSearch(e.target.value)} />
                </div>
                <select class="select select-sm rounded-lg bg-base-200/50 border-white/[0.04] text-xs min-h-0 h-8" value={sort()} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                    <option value="newest">Newest</option>
                    <option value="popular">Most Popular</option>
                    <option value="top_rated">Top Rated</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                </select>
            </div>

            <div class="flex gap-1.5 flex-wrap">
                <CategoryPill label="All" slug="all" active={category()} onClick={(c) => { setCategory(c); setPage(1); }} />
                <Show when={categories()}>
                    <For each={categories()}>{(cat) => <CategoryPill label={cat.name} slug={cat.slug} active={category()} onClick={(c) => { setCategory(c); setPage(1); }} />}</For>
                </Show>
            </div>

            <Show when={data.loading}>
                <div class="flex flex-col items-center justify-center py-16 gap-3">
                    <span class="loading loading-spinner loading-md text-primary" />
                    <span class="text-xs text-base-content/40">Loading marketplace...</span>
                </div>
            </Show>

            <Show when={!data.loading}>
                <Show when={assets().length > 0} fallback={
                    <div class="text-center py-16">
                        <div class="text-4xl mb-3 opacity-15">🏪</div>
                        <p class="text-sm text-base-content/30">No items found</p>
                        <Show when={search()}><p class="text-[11px] text-base-content/20 mt-1">Try a different search term</p></Show>
                    </div>
                }>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3">
                        <For each={assets()}>{(asset) => <AssetCard asset={asset} ownedIds={ownedIds} setOwnedIds={setOwnedIds} refetchConfig={props.refetchConfig} viewAsset={props.viewAsset} />}</For>
                    </div>
                </Show>

                <Show when={totalPages() > 1}>
                    <div class="flex items-center justify-center gap-2 pt-2">
                        <button class="btn btn-ghost btn-xs rounded-lg" disabled={page() <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                        <span class="text-[11px] text-base-content/40">Page {page()} of {totalPages()}</span>
                        <button class="btn btn-ghost btn-xs rounded-lg" disabled={page() >= totalPages()} onClick={() => setPage(p => p + 1)}>Next</button>
                    </div>
                </Show>
            </Show>
        </div>
    );
}

function CategoryPill(props) {
    return (
        <button class={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${props.active === props.slug ? 'bg-primary/15 text-primary' : 'text-base-content/40 hover:text-base-content/60 hover:bg-white/[0.03]'}`} onClick={() => props.onClick(props.slug)}>
            {props.label}
        </button>
    );
}

function AssetCard(props) {
    const asset = props.asset;
    const isFree = () => asset.price_credits === 0;
    const rating = () => asset.rating_avg ? asset.rating_avg.toFixed(1) : null;
    const [purchasing, setPurchasing] = createSignal(false);
    const [justPurchased, setJustPurchased] = createSignal(false);
    const [confirming, setConfirming] = createSignal(false);
    const [error, setError] = createSignal('');

    const isOwned = () => justPurchased() || (props.ownedIds()?.has(asset.id) || false);

    function handleClick(e) {
        e.preventDefault(); e.stopPropagation();
        if (purchasing() || isOwned()) return;
        if (isFree()) doPurchase(); else setConfirming(true);
    }

    async function doPurchase() {
        setPurchasing(true); setConfirming(false); setError('');
        try {
            const data = await fetchJson('/api/purchase', { method: 'POST', body: JSON.stringify({ asset_id: asset.id }) });
            if (data.error) setError(data.error);
            else { setJustPurchased(true); props.setOwnedIds(prev => new Set([...prev, asset.id])); props.refetchConfig?.(); }
        } catch { setError('Purchase failed'); }
        setPurchasing(false);
    }

    return (
        <div class="group rounded-xl overflow-hidden border border-white/[0.04] hover:border-primary/20 transition-all relative">
            <div class="cursor-pointer" onClick={() => props.viewAsset?.(asset.slug)}>
                <div class="aspect-[16/10] bg-base-300/50 relative overflow-hidden">
                    <Show when={asset.thumbnail_url} fallback={<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10"><span class="text-2xl opacity-20">📦</span></div>}>
                        <img src={asset.thumbnail_url} alt={asset.name} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                    </Show>
                    <Show when={isFree() && !isOwned()}><div class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-success/20 text-success text-[9px] font-bold backdrop-blur-sm">FREE</div></Show>
                    <Show when={isOwned()}><div class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-success/20 text-success text-[9px] font-bold backdrop-blur-sm">✓ Owned</div></Show>
                    <Show when={asset.category}><div class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/40 text-white/70 text-[9px] font-medium backdrop-blur-sm">{asset.category}</div></Show>
                </div>
            </div>
            <div class="p-3 bg-base-200/40">
                <div class="text-xs font-semibold mb-0.5 truncate">{asset.name}</div>
                <div class="text-[10px] text-base-content/35 mb-2 truncate">{asset.creator_name}</div>
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <Show when={rating()}><div class="flex items-center gap-0.5 text-accent"><IconStarFilled size={12} /><span class="text-[10px] font-medium">{rating()}</span></div></Show>
                        <Show when={asset.downloads > 0}><div class="flex items-center gap-0.5 text-base-content/25"><IconDownload size={10} /><span class="text-[10px]">{asset.downloads}</span></div></Show>
                    </div>
                    <Show when={isOwned()} fallback={
                        <button class={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all ${isFree() ? 'bg-success/15 text-success hover:bg-success/25' : 'bg-primary/15 text-primary hover:bg-primary/25'}`} onClick={handleClick} disabled={purchasing()}>
                            {purchasing() ? '...' : isFree() ? 'Get Free' : `${asset.price_credits} credits`}
                        </button>
                    }><span class="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-success/10 text-success/60">Owned</span></Show>
                </div>
                <Show when={error()}><div class="text-[9px] text-error mt-1">{error()}</div></Show>
            </div>
            <Show when={confirming()}>
                <div class="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-10 rounded-xl" onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>
                    <div class="bg-base-200 border border-white/[0.08] rounded-xl p-4 mx-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <div class="text-xs font-semibold mb-1">Purchase {asset.name}?</div>
                        <div class="text-[10px] text-base-content/50 mb-3">This will cost {asset.price_credits} credits</div>
                        <div class="flex gap-2 justify-center">
                            <button class="text-[10px] px-3 py-1.5 rounded-lg bg-base-300 text-base-content/60 hover:bg-base-300/80" onClick={() => setConfirming(false)}>Cancel</button>
                            <button class="text-[10px] px-3 py-1.5 rounded-lg bg-primary text-primary-content hover:brightness-110" onClick={doPurchase}>Confirm</button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
}
