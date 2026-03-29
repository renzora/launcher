import { createSignal, createResource, For, Show, onMount, onCleanup } from 'solid-js';
import { fetchJson } from '../api.jsx';
import PreviewPlayer from './PreviewPlayer.jsx';

function launchConfetti() {
    const colors = ['#6366f1', '#f43f5e', '#22c55e', '#eab308', '#3b82f6', '#a855f7', '#ec4899'];
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden';
    document.body.appendChild(container);

    if (!document.getElementById('confetti-style')) {
        const style = document.createElement('style');
        style.id = 'confetti-style';
        style.textContent = `@keyframes confetti-up { 0% { transform: translateY(0) translateX(0) rotate(0deg) scale(1); opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(calc(var(--cy) * -1vh)) translateX(calc(var(--cx) * 1vw)) rotate(calc(var(--cr) * 1deg)) scale(0.2); opacity: 0; } }`;
        document.head.appendChild(style);
    }

    for (let i = 0; i < 80; i++) {
        const piece = document.createElement('div');
        const color = colors[Math.floor(Math.random() * colors.length)];
        const x = 35 + Math.random() * 30;
        const size = 4 + Math.random() * 6;
        const dur = 1.5 + Math.random() * 1.5;
        const delay = Math.random() * 0.5;
        const isRect = Math.random() > 0.5;
        piece.style.cssText = `position:absolute;left:${x}%;bottom:0;width:${isRect ? size : size * 0.6}px;height:${isRect ? size * 0.6 : size}px;background:${color};border-radius:${isRect ? '1px' : '50%'};--cy:${80 + Math.random() * 40};--cx:${(Math.random() - 0.5) * 50};--cr:${Math.random() * 720 - 360};animation:confetti-up ${dur}s ${delay}s cubic-bezier(0.15,0.8,0.3,1) forwards;`;
        container.appendChild(piece);
    }
    setTimeout(() => container.remove(), 3500);
}

async function proxyGet(path) {
    return fetchJson('/api/proxy', { method: 'POST', body: JSON.stringify({ path, method: 'GET' }) });
}

export default function AssetDetail(props) {
    const slug = () => props.slug;
    const [purchasing, setPurchasing] = createSignal(false);
    const [purchased, setPurchased] = createSignal(false);
    const [error, setError] = createSignal('');
    const [comment, setComment] = createSignal('');
    const [submittingComment, setSubmittingComment] = createSignal(false);
    const [commentError, setCommentError] = createSignal('');
    const [reviewRating, setReviewRating] = createSignal(0);
    const [reviewHover, setReviewHover] = createSignal(0);
    const [reviewTitle, setReviewTitle] = createSignal('');
    const [reviewContent, setReviewContent] = createSignal('');
    const [submittingReview, setSubmittingReview] = createSignal(false);
    const [reviewError, setReviewError] = createSignal('');
    const [reviewSuccess, setReviewSuccess] = createSignal(false);

    const [asset] = createResource(slug, async (s) => {
        if (!s) return null;
        try { return await proxyGet(`marketplace/detail/${s}`); } catch { return null; }
    });

    const [reviews, { refetch: refetchReviews }] = createResource(
        () => asset()?.id,
        async (id) => {
            if (!id) return { reviews: [], rating_avg: 0, rating_count: 0 };
            try { return await proxyGet(`marketplace/${id}/reviews`); } catch { return { reviews: [], rating_avg: 0, rating_count: 0 }; }
        }
    );

    const [comments, { refetch: refetchComments }] = createResource(
        () => asset()?.id,
        async (id) => {
            if (!id) return { comments: [] };
            try { return await proxyGet(`marketplace/${id}/comments`); } catch { return { comments: [] }; }
        }
    );

    const [owned, { refetch: refetchOwned }] = createResource(
        () => asset()?.id,
        async (id) => {
            if (!id) return false;
            try {
                const data = await fetchJson('/api/check-owned', { method: 'POST', body: JSON.stringify({ asset_ids: [id] }) });
                return (data.owned_ids || []).includes(id);
            } catch { return false; }
        }
    );

    async function handlePurchase() {
        if (purchasing()) return;
        setPurchasing(true); setError('');
        try {
            const data = await fetchJson('/api/purchase', { method: 'POST', body: JSON.stringify({ asset_id: asset().id }) });
            if (data.error) setError(data.error);
            else { setPurchased(true); refetchOwned(); props.refetchConfig?.(); launchConfetti(); }
        } catch { setError('Purchase failed'); }
        setPurchasing(false);
    }

    async function submitComment() {
        if (!comment().trim() || submittingComment()) return;
        setSubmittingComment(true); setCommentError('');
        try {
            const data = await fetchJson('/api/comment', { method: 'POST', body: JSON.stringify({ asset_id: asset().id, content: comment() }) });
            if (data.error) setCommentError(data.error); else { setComment(''); refetchComments(); }
        } catch { setCommentError('Failed to post comment'); }
        setSubmittingComment(false);
    }

    async function submitReview() {
        if (!reviewRating() || submittingReview()) return;
        setSubmittingReview(true); setReviewError(''); setReviewSuccess(false);
        try {
            const data = await fetchJson('/api/review', { method: 'POST', body: JSON.stringify({ asset_id: asset().id, rating: reviewRating(), title: reviewTitle(), content: reviewContent() }) });
            if (data.error) setReviewError(data.error); else { setReviewSuccess(true); setReviewTitle(''); setReviewContent(''); refetchReviews(); }
        } catch { setReviewError('Failed to submit review'); }
        setSubmittingReview(false);
    }

    const [dlStatus, setDlStatus] = createSignal('idle');
    const [dlProgress, setDlProgress] = createSignal(0);
    const [dlError, setDlError] = createSignal('');

    async function handleDownload() {
        if (dlStatus() === 'downloading') return;
        setDlStatus('downloading'); setDlProgress(0); setDlError('');
        const id = String(asset().id);
        const result = await fetchJson('/api/download/start', { method: 'POST', body: JSON.stringify({ id, name: asset().name, type: 'asset' }) });
        if (result.error) { setDlStatus('error'); setDlError(result.error); return; }

        const poll = setInterval(async () => {
            const p = await fetchJson(`/api/download/progress?id=${encodeURIComponent(id)}`);
            if (p.total > 0) setDlProgress(Math.round((p.downloaded / p.total) * 100));
            if (p.status === 'done') { clearInterval(poll); setDlStatus('done'); setDlProgress(100); fetchJson('/api/download/clear', { method: 'POST', body: JSON.stringify({ id }) }); }
            if (p.status === 'error') { clearInterval(poll); setDlStatus('error'); setDlError(p.error || 'Download failed'); }
        }, 300);
    }

    // Close on ESC
    onMount(() => {
        const handler = (e) => { if (e.key === 'Escape') props.onBack?.(); };
        window.addEventListener('keydown', handler);
        onCleanup(() => window.removeEventListener('keydown', handler));
    });

    const a = () => asset();
    const isFree = () => a()?.price_credits === 0;
    const isOwned = () => owned() || purchased();
    const ratingAvg = () => reviews()?.rating_avg?.toFixed(1) || '0';
    const ratingCount = () => reviews()?.rating_count || 0;
    const commentList = () => comments()?.comments || [];

    return (
        <div class="flex flex-col gap-0 p-0">
            <Show when={asset.loading}><div class="flex items-center justify-center py-20"><span class="loading loading-spinner loading-md text-primary" /></div></Show>
            <Show when={!asset.loading && !a()}><div class="text-center py-20"><div class="text-4xl mb-3 opacity-20">📦</div><p class="text-sm text-base-content/40">Asset not found</p></div></Show>

            <Show when={a()}>
                <div class="flex flex-col lg:flex-row gap-6 px-6 pt-4">
                    <div class="flex-1 min-w-0">
                        <div class="rounded-xl overflow-hidden border border-white/[0.04]">
                            <PreviewPlayer assetId={a()?.id} slug={slug()} />
                        </div>

                        <div class="mt-4">
                            <h1 class="text-lg font-bold">{a().name}</h1>
                            <div class="flex items-center gap-3 mt-1.5 text-xs text-base-content/40">
                                <span>{a().creator?.username}</span>
                                <span class="flex items-center gap-1"><span class="text-amber-400">{'★'.repeat(Math.round(parseFloat(ratingAvg())))}</span>({ratingCount()})</span>
                                <span>{a().views?.toLocaleString()} views</span>
                                <span>{a().downloads?.toLocaleString()} downloads</span>
                            </div>
                        </div>

                        <Show when={a().tags?.length > 0}>
                            <div class="flex flex-wrap gap-1.5 mt-3">
                                <For each={a().tags}>{(tag) => <span class="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[10px] text-primary">{tag}</span>}</For>
                            </div>
                        </Show>

                        <Show when={a().description}>
                            <div class="mt-4 text-sm text-base-content/60 leading-relaxed whitespace-pre-wrap">{a().description}</div>
                        </Show>

                        <div class="mt-6 border-t border-white/[0.04] pt-6">
                            <h2 class="text-sm font-semibold mb-4">Reviews ({ratingCount()})</h2>
                            <div class="p-4 rounded-xl bg-base-200/30 border border-white/[0.04] mb-4">
                                <p class="text-xs text-base-content/50 mb-2">Rate this asset</p>
                                <div class="flex items-center gap-1 mb-3">
                                    <For each={[1, 2, 3, 4, 5]}>
                                        {(star) => <button class={`text-lg transition-colors ${(reviewHover() || reviewRating()) >= star ? 'text-amber-400' : 'text-base-content/15'}`} onMouseEnter={() => setReviewHover(star)} onMouseLeave={() => setReviewHover(0)} onClick={() => setReviewRating(star)}>★</button>}
                                    </For>
                                    <Show when={reviewRating()}><span class="text-[11px] text-base-content/40 ml-2">{reviewRating()}/5</span></Show>
                                </div>
                                <Show when={reviewRating()}>
                                    <input type="text" class="w-full px-3 py-1.5 rounded-lg bg-base-300/50 border border-white/[0.04] text-xs placeholder:text-base-content/20 mb-2" placeholder="Review title (optional)" value={reviewTitle()} onInput={(e) => setReviewTitle(e.target.value)} />
                                    <textarea class="w-full px-3 py-1.5 rounded-lg bg-base-300/50 border border-white/[0.04] text-xs placeholder:text-base-content/20 resize-none" rows="2" placeholder="Write your review (optional)" value={reviewContent()} onInput={(e) => setReviewContent(e.target.value)} />
                                    <div class="flex items-center gap-2 mt-2">
                                        <button class="px-3 py-1.5 rounded-lg bg-primary text-primary-content text-xs font-medium hover:brightness-110 transition-all" onClick={submitReview} disabled={submittingReview()}>{submittingReview() ? 'Submitting...' : 'Submit Review'}</button>
                                        <Show when={reviewError()}><span class="text-[11px] text-error">{reviewError()}</span></Show>
                                        <Show when={reviewSuccess()}><span class="text-[11px] text-success">Review submitted!</span></Show>
                                    </div>
                                </Show>
                            </div>
                            <Show when={(reviews()?.reviews || []).length > 0}>
                                <div class="space-y-3 mb-4">
                                    <For each={reviews()?.reviews || []}>
                                        {(r) => (
                                            <div class="p-3 rounded-lg bg-base-200/30 border border-white/[0.03]">
                                                <div class="flex items-center gap-2 mb-1">
                                                    <span class="text-amber-400 text-xs">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                                                    <span class="text-xs font-medium">{r.author_name}</span>
                                                    <span class="text-[10px] text-base-content/25">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
                                                </div>
                                                <Show when={r.title}><p class="text-xs font-medium mb-0.5">{r.title}</p></Show>
                                                <Show when={r.content}><p class="text-xs text-base-content/50">{r.content}</p></Show>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </Show>
                        </div>

                        <div class="mt-6 border-t border-white/[0.04] pt-6 pb-6">
                            <h2 class="text-sm font-semibold mb-4">Comments ({commentList().length})</h2>
                            <div class="flex gap-2 mb-4">
                                <input type="text" class="flex-1 px-3 py-2 rounded-lg bg-base-200/30 border border-white/[0.04] text-xs placeholder:text-base-content/20" placeholder="Write a comment..." value={comment()} onInput={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitComment()} />
                                <button class="px-4 py-2 rounded-lg bg-primary text-primary-content text-xs font-medium hover:brightness-110 transition-all disabled:opacity-50" onClick={submitComment} disabled={submittingComment() || !comment().trim()}>{submittingComment() ? '...' : 'Post'}</button>
                            </div>
                            <Show when={commentError()}><p class="text-[11px] text-error mb-3">{commentError()}</p></Show>
                            <Show when={commentList().length > 0} fallback={<p class="text-xs text-base-content/30">No comments yet. Be the first!</p>}>
                                <div class="space-y-3">
                                    <For each={commentList()}>
                                        {(c) => (
                                            <div class="p-3 rounded-lg bg-base-200/30 border border-white/[0.03]">
                                                <div class="flex items-center gap-2 mb-1">
                                                    <span class="text-xs font-medium">{c.author_name || c.username}</span>
                                                    <span class="text-[10px] text-base-content/25">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                                                </div>
                                                <p class="text-xs text-base-content/50">{c.content}</p>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </Show>
                        </div>
                    </div>

                    <div class="w-full lg:w-72 shrink-0">
                        <div class="bg-base-200/30 border border-white/[0.04] rounded-xl p-5 sticky top-4">
                            <Show when={isOwned()} fallback={
                                <div>
                                    <div class="text-center mb-4">
                                        <Show when={isFree()} fallback={<div class="text-2xl font-bold text-accent">{a().price_credits} <span class="text-sm font-normal text-base-content/40">credits</span></div>}>
                                            <div class="text-lg font-bold text-success">Free</div>
                                        </Show>
                                    </div>
                                    <button class={`w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${isFree() ? 'bg-success text-success-content hover:brightness-110' : 'bg-primary text-primary-content hover:brightness-110'}`} onClick={handlePurchase} disabled={purchasing()}>
                                        {purchasing() ? 'Processing...' : isFree() ? 'Get for Free' : `Buy for ${a().price_credits} credits`}
                                    </button>
                                    <Show when={error()}><p class="text-xs text-error text-center mt-2">{error()}</p></Show>
                                </div>
                            }>
                                <div class="text-center">
                                    <div class="text-sm font-semibold text-success mb-2">✓ You own this asset</div>
                                    <Show when={dlStatus() === 'done'}>
                                        <div class="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-success/15 text-success text-center">Downloaded</div>
                                    </Show>
                                    <Show when={dlStatus() === 'idle'}>
                                        <button class="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-success text-success-content hover:brightness-110 transition-all" onClick={handleDownload}>Download</button>
                                    </Show>
                                    <Show when={dlStatus() === 'downloading'}>
                                        <div class="w-full">
                                            <div class="text-xs text-center text-primary font-medium mb-2">Downloading... {dlProgress()}%</div>
                                            <div class="w-full bg-base-300/50 rounded-full h-2">
                                                <div class="bg-primary h-2 rounded-full transition-all" style={`width: ${dlProgress()}%`} />
                                            </div>
                                        </div>
                                    </Show>
                                    <Show when={dlStatus() === 'error'}>
                                        <div class="text-xs text-error mb-2">{dlError()}</div>
                                        <button class="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-error text-error-content hover:brightness-110 transition-all" onClick={handleDownload}>Retry</button>
                                    </Show>
                                </div>
                            </Show>

                            <div class="mt-5 pt-5 border-t border-white/[0.04] space-y-2.5">
                                <div class="flex justify-between text-xs"><span class="text-base-content/40">Category</span><span>{a().category}</span></div>
                                <div class="flex justify-between text-xs"><span class="text-base-content/40">Version</span><span>{a().version}</span></div>
                                <div class="flex justify-between text-xs"><span class="text-base-content/40">Rating</span><span class="text-amber-400">{'★'.repeat(Math.round(parseFloat(ratingAvg())))} <span class="text-base-content/40">({ratingCount()})</span></span></div>
                                <div class="flex justify-between text-xs"><span class="text-base-content/40">Downloads</span><span>{a().downloads?.toLocaleString()}</span></div>
                            </div>

                            <div class="mt-5 pt-5 border-t border-white/[0.04]">
                                <a href={`https://renzora.com/profile/${a().creator?.username}`} target="_blank" class="flex items-center gap-3 group">
                                    <div class="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{(a().creator?.username || '?')[0].toUpperCase()}</div>
                                    <div><div class="text-xs font-medium group-hover:text-primary transition-colors">{a().creator?.username}</div><div class="text-[10px] text-base-content/30">View profile</div></div>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
}
