import { createSignal, For, Show } from 'solid-js';
import { IconArrowRight, IconPlay, IconDownload, IconStarFilled } from './icons.jsx';

// Placeholder data
const FEATURED_GAMES = [
    { id: 1, title: 'Renzora', subtitle: 'Open world adventure', tag: 'Featured', color: 'from-primary/40 to-secondary/30' },
    { id: 2, title: 'Pixel Realms', subtitle: 'Build your kingdom', tag: 'New', color: 'from-emerald-500/30 to-teal-600/30' },
    { id: 3, title: 'Starbound Echo', subtitle: 'Space exploration RPG', tag: 'Popular', color: 'from-blue-500/30 to-indigo-600/30' },
    { id: 4, title: 'Neon Drift', subtitle: 'Cyberpunk racer', tag: 'Trending', color: 'from-pink-500/30 to-purple-600/30' },
];

const NEWS_ITEMS = [
    { id: 1, date: 'Mar 24, 2026', title: 'Renzora Engine v0.2.0 Released', summary: 'New terrain system, improved physics, and 35+ post-processing effects.', type: 'Engine' },
    { id: 2, date: 'Mar 20, 2026', title: 'Marketplace Now Live', summary: 'Browse and purchase community-created assets, plugins, and templates.', type: 'Platform' },
    { id: 3, date: 'Mar 15, 2026', title: 'Renzora Game — Early Access', summary: 'Join the adventure with Hazel in the world of Renzora.', type: 'Game' },
];

export default function HomePage(props) {
    return (
        <div class="flex flex-col gap-6 p-6">
            {/* Hero Banner */}
            <div class="relative rounded-2xl overflow-hidden bg-gradient-to-br from-primary/20 via-base-200 to-secondary/15 border border-white/[0.04]">
                <div class="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,oklch(0.55_0.13_300/0.15),transparent_60%)]" />
                <div class="relative px-8 py-10 flex items-center justify-between">
                    <div class="max-w-md">
                        <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/15 text-accent text-[10px] font-semibold uppercase tracking-wider mb-3">
                            <IconStarFilled size={12} />
                            Now Available
                        </div>
                        <h1 class="text-2xl font-bold mb-2">Welcome to Renzora</h1>
                        <p class="text-sm text-base-content/50 leading-relaxed mb-5">
                            Your hub for games, the Renzora engine, and the creative community. Download, play, and build.
                        </p>
                        <div class="flex gap-3">
                            <button
                                class="btn btn-primary btn-sm rounded-lg gap-1.5 px-5"
                                onClick={() => props.setActive('store')}
                            >
                                Browse Store <IconArrowRight size={14} />
                            </button>
                            <button
                                class="btn btn-ghost btn-sm rounded-lg border border-white/[0.06] px-5"
                                onClick={() => props.setActive('engine')}
                            >
                                Get Engine
                            </button>
                        </div>
                    </div>
                    <div class="hidden lg:block w-40 h-40 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 border border-white/[0.06] flex items-center justify-center">
                        <div class="w-full h-full rounded-2xl flex items-center justify-center text-5xl opacity-40">
                            🎮
                        </div>
                    </div>
                </div>
            </div>

            {/* Featured */}
            <div>
                <div class="flex items-center justify-between mb-3">
                    <h2 class="text-sm font-bold">Featured</h2>
                    <button
                        class="text-[11px] text-base-content/40 hover:text-primary flex items-center gap-1 transition-colors"
                        onClick={() => props.setActive('store')}
                    >
                        View all <IconArrowRight size={12} />
                    </button>
                </div>
                <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
                    <For each={FEATURED_GAMES}>
                        {(game) => (
                            <button
                                class="group relative rounded-xl overflow-hidden border border-white/[0.04] hover:border-primary/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                onClick={() => props.setActive('store')}
                            >
                                <div class={`aspect-[4/3] bg-gradient-to-br ${game.color} flex items-center justify-center`}>
                                    <div class="text-3xl opacity-30 group-hover:opacity-50 transition-opacity">🎮</div>
                                </div>
                                <div class="p-3 bg-base-200/50">
                                    <div class="flex items-center gap-1.5 mb-1">
                                        <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent font-semibold uppercase">{game.tag}</span>
                                    </div>
                                    <div class="text-xs font-semibold">{game.title}</div>
                                    <div class="text-[10px] text-base-content/40">{game.subtitle}</div>
                                </div>
                            </button>
                        )}
                    </For>
                </div>
            </div>

            {/* Quick Actions */}
            <div class="grid grid-cols-3 gap-3">
                <button
                    class="flex items-center gap-3 px-4 py-3 rounded-xl bg-base-200/30 border border-white/[0.04] hover:border-primary/20 transition-all group"
                    onClick={() => props.setActive('library')}
                >
                    <div class="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary/20 transition-colors">
                        <IconPlay size={16} />
                    </div>
                    <div class="text-left">
                        <div class="text-xs font-semibold">My Library</div>
                        <div class="text-[10px] text-base-content/35">Launch your games</div>
                    </div>
                </button>
                <button
                    class="flex items-center gap-3 px-4 py-3 rounded-xl bg-base-200/30 border border-white/[0.04] hover:border-primary/20 transition-all group"
                    onClick={() => props.setActive('engine')}
                >
                    <div class="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary group-hover:bg-secondary/20 transition-colors">
                        <IconDownload size={16} />
                    </div>
                    <div class="text-left">
                        <div class="text-xs font-semibold">Engine</div>
                        <div class="text-[10px] text-base-content/35">Manage versions</div>
                    </div>
                </button>
                <button
                    class="flex items-center gap-3 px-4 py-3 rounded-xl bg-base-200/30 border border-white/[0.04] hover:border-primary/20 transition-all group"
                    onClick={() => props.setActive('store')}
                >
                    <div class="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent group-hover:bg-accent/20 transition-colors">
                        <IconStarFilled size={16} />
                    </div>
                    <div class="text-left">
                        <div class="text-xs font-semibold">Store</div>
                        <div class="text-[10px] text-base-content/35">Discover content</div>
                    </div>
                </button>
            </div>

            {/* News */}
            <div>
                <h2 class="text-sm font-bold mb-3">Latest News</h2>
                <div class="space-y-2">
                    <For each={NEWS_ITEMS}>
                        {(item) => (
                            <div class="flex items-start gap-4 px-4 py-3 rounded-xl bg-base-200/20 border border-white/[0.03] hover:border-white/[0.06] transition-colors">
                                <div class={`shrink-0 mt-0.5 w-2 h-2 rounded-full ${
                                    item.type === 'Engine' ? 'bg-primary' :
                                    item.type === 'Game' ? 'bg-secondary' : 'bg-accent'
                                }`} />
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-2 mb-0.5">
                                        <span class="text-xs font-semibold">{item.title}</span>
                                        <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-base-300/50 text-base-content/30 font-medium">{item.type}</span>
                                    </div>
                                    <p class="text-[11px] text-base-content/40 leading-relaxed">{item.summary}</p>
                                </div>
                                <span class="text-[10px] text-base-content/25 shrink-0">{item.date}</span>
                            </div>
                        )}
                    </For>
                </div>
            </div>
        </div>
    );
}
