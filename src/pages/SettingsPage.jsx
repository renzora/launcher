import { createSignal, Show } from 'solid-js';
import { fetchJson } from '../api.jsx';
import { IconFolder, IconCheck } from '../icons.jsx';

function DirPicker(props) {
    const [dir, setDir] = createSignal(props.value || '');
    const [saved, setSaved] = createSignal(false);

    async function browse() {
        const result = await fetchJson('/api/browse', { method: 'POST' });
        if (result.path) {
            setDir(result.path);
            await fetchJson('/api/config', {
                method: 'POST',
                body: JSON.stringify({ [props.configKey]: result.path }),
            });
            props.refetchConfig();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        }
    }

    return (
        <div class="space-y-2.5">
            <div>
                <label class="text-xs font-semibold text-base-content/70">{props.label}</label>
                <p class="text-[10px] text-base-content/35 mt-0.5">{props.description}</p>
            </div>
            <div class="flex gap-2">
                <div class="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg bg-base-200/40 border border-white/[0.04] min-h-[36px]">
                    <IconFolder size={14} class="text-base-content/20 shrink-0" />
                    <span class={`text-xs truncate ${dir() ? 'text-base-content/80' : 'text-base-content/25'}`}>
                        {dir() || 'No directory selected'}
                    </span>
                </div>
                <button class="btn btn-ghost btn-sm rounded-lg border border-white/[0.06] px-4 text-xs" onClick={browse}>Browse</button>
            </div>
            <Show when={saved()}>
                <div class="flex items-center gap-1.5 text-success text-[11px]"><IconCheck size={14} /> Saved</div>
            </Show>
        </div>
    );
}

export default function SettingsPage(props) {
    async function signOut() {
        await fetchJson('/api/logout', { method: 'POST' });
        props.refetchConfig();
    }

    return (
        <div class="flex flex-col gap-6 p-6">
            <div>
                <h1 class="text-lg font-bold">Settings</h1>
                <p class="text-xs text-base-content/40 mt-0.5">Configure your launcher preferences</p>
            </div>

            <div class="space-y-8 max-w-lg">
                <DirPicker
                    label="Engine Directory"
                    description="Where Renzora Engine versions are installed"
                    configKey="install_dir"
                    value={props.config()?.install_dir}
                    refetchConfig={props.refetchConfig}
                />

                <DirPicker
                    label="Games Directory"
                    description="Where downloaded games are stored"
                    configKey="games_dir"
                    value={props.config()?.games_dir}
                    refetchConfig={props.refetchConfig}
                />

                <DirPicker
                    label="Assets Directory"
                    description="Where marketplace assets are downloaded"
                    configKey="assets_dir"
                    value={props.config()?.assets_dir}
                    refetchConfig={props.refetchConfig}
                />

                <div class="border-t border-white/[0.04]" />

                <div class="space-y-3">
                    <div>
                        <label class="text-xs font-semibold text-base-content/70">Account</label>
                        <p class="text-[10px] text-base-content/35 mt-0.5">Connect to renzora.com for marketplace and multiplayer</p>
                    </div>
                    <Show when={props.config()?.logged_in} fallback={
                        <button class="btn btn-primary btn-sm rounded-lg w-full" onClick={() => props.setShowLogin(true)}>Sign in</button>
                    }>
                        <div class="rounded-xl border border-white/[0.04] bg-base-200/30 overflow-hidden">
                            <div class="flex items-center gap-3 px-4 py-3">
                                <div class="w-9 h-9 rounded-full bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center text-sm font-bold text-primary">
                                    {(props.config()?.username || '?')[0].toUpperCase()}
                                </div>
                                <div class="flex-1">
                                    <div class="text-xs font-semibold">{props.config()?.username}</div>
                                    <div class="text-[10px] text-accent font-medium">{props.config()?.credit_balance ?? 0} credits</div>
                                </div>
                                <div class="flex items-center gap-1.5 text-success text-[10px]"><IconCheck size={12} /> Connected</div>
                            </div>
                            <div class="border-t border-white/[0.04] px-4 py-2.5">
                                <button class="btn btn-ghost btn-xs text-error/60 hover:text-error hover:bg-error/10 rounded-lg" onClick={signOut}>Sign out</button>
                            </div>
                        </div>
                    </Show>
                </div>
            </div>
        </div>
    );
}
