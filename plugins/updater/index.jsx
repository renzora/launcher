import { plugin } from 'webarcade';
import { createSignal, createResource, Show } from 'solid-js';

const API = 'http://localhost:3001/updater';

async function fetchJson(url, options = {}) {
    const resp = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    return resp.json();
}

function UpdateBanner() {
    const [updateInfo] = createResource(() => fetchJson(`${API}/check`).catch(() => null));
    const [updating, setUpdating] = createSignal(false);
    const [updateResult, setUpdateResult] = createSignal(null);

    async function performUpdate() {
        setUpdating(true);
        const result = await fetchJson(`${API}/update`, { method: 'POST' });
        setUpdateResult(result);
        setUpdating(false);
    }

    return (
        <Show when={updateInfo()?.update_available}>
            <div class="bg-info/10 border border-info/20 rounded-lg px-4 py-2 flex items-center justify-between">
                <span class="text-xs">
                    Launcher update: <strong>v{updateInfo().latest_version}</strong>
                    <span class="opacity-60 ml-1">(current: v{updateInfo().current_version})</span>
                </span>
                <Show
                    when={!updateResult()}
                    fallback={<span class="text-xs text-success">{updateResult().message}</span>}
                >
                    <button
                        class="btn btn-xs btn-primary"
                        onClick={performUpdate}
                        disabled={updating()}
                    >
                        {updating() ? 'Updating...' : 'Update'}
                    </button>
                </Show>
            </div>
        </Show>
    );
}

export default plugin({
    id: 'updater',
    name: 'Updater',
    version: '0.1.0',

    start(api) {
        api.register('update-banner', {
            type: 'status',
            component: UpdateBanner,
            align: 'right',
            priority: 10,
        });
    },

    stop() {},
});
