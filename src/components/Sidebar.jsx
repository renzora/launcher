import { For, Show } from 'solid-js';
import { IconHome, IconStore, IconLibrary, IconEngine, IconSettings, IconUser, IconMarketplace, IconUpload, IconBrandGithub, IconBrandYoutube, IconBrandDiscord } from '../icons.jsx';

const NAV_ITEMS = [
    { id: 'home', label: 'Home', icon: IconHome },
    { id: 'engine', label: 'Renzora Engine', icon: IconEngine },
    { id: 'store', label: 'Game Store', icon: IconStore },
    { id: 'marketplace', label: 'Marketplace', icon: IconMarketplace },
    { id: 'library', label: 'Library', icon: IconLibrary },
    { id: 'publish', label: 'Publish', icon: IconUpload },
    { id: 'settings', label: 'Settings', icon: IconSettings },
];

export default function Sidebar(props) {
    return (
        <div class="w-56 bg-base-200/40 border-r border-white/[0.04] flex flex-col shrink-0 select-none">
            <div class="px-5 pt-6 pb-4">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-black text-sm">
                        R
                    </div>
                    <div>
                        <div class="text-sm font-bold tracking-tight">Renzora Launcher</div>
                        <div class="text-[9px] uppercase tracking-[0.15em] text-base-content/30 font-medium">v0.1.0</div>
                    </div>
                </div>
            </div>

            <nav class="flex-1 px-3">
                <div class="space-y-0.5">
                    <For each={NAV_ITEMS}>
                        {(item) => <NavItem item={item} active={props.active} setActive={props.setActive} />}
                    </For>
                </div>
            </nav>

            <div class="text-[9px] uppercase tracking-[0.15em] text-base-content/25 font-semibold px-5 mb-1.5">Socials</div>
            <div class="px-5 pb-2 flex items-center gap-3">
                <a href="https://github.com/renzora/engine" target="_blank" class="text-base-content/20 hover:text-base-content/60 transition-colors"><IconBrandGithub size={16} /></a>
                <a href="https://youtube.com/@renzoragame" target="_blank" class="text-base-content/20 hover:text-base-content/60 transition-colors"><IconBrandYoutube size={16} /></a>
                <a href="https://discord.gg/9UHUGUyDJv" target="_blank" class="text-base-content/20 hover:text-base-content/60 transition-colors"><IconBrandDiscord size={16} /></a>
            </div>

            <div class="p-3 border-t border-white/[0.04]">
                <Show when={props.config()?.logged_in}
                    fallback={
                        <button class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs text-base-content/40 hover:text-base-content hover:bg-white/[0.03] transition-all" onClick={() => props.setShowLogin(true)}>
                            <div class="w-7 h-7 rounded-full bg-base-300 flex items-center justify-center"><IconUser /></div>
                            <span>Sign in</span>
                        </button>
                    }
                >
                    <div class="flex items-center gap-2.5 px-3 py-1.5">
                        <div class="w-7 h-7 rounded-full bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center text-[11px] font-bold text-primary">
                            {(props.config()?.username || '?')[0].toUpperCase()}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="text-[11px] font-medium truncate">{props.config()?.username || 'Connected'}</div>
                            <div class="text-[9px] text-accent font-medium">{props.config()?.credit_balance ?? 0} credits</div>
                        </div>
                    </div>
                </Show>
            </div>
        </div>
    );
}

function NavItem(props) {
    const isActive = () => props.active() === props.item.id;
    return (
        <button
            class={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all relative overflow-hidden ${
                isActive() ? 'bg-primary/15 text-primary' : 'text-base-content/50 hover:text-base-content/80 hover:bg-white/[0.03]'
            }`}
            onClick={() => props.setActive(props.item.id)}
        >
            {isActive() && <div class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-accent" />}
            <props.item.icon size={18} />
            {props.item.label}
        </button>
    );
}
