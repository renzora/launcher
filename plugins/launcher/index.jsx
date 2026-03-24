import { plugin, Column, Row, Toolbar } from 'webarcade';
import { DragRegion, WindowControls } from 'webarcade/ui';
import { createSignal, createResource, Show } from 'solid-js';
import { useRenzoraTheme } from './theme.jsx';
import { API, fetchJson } from './api.jsx';
import Sidebar from './Sidebar.jsx';
import HomePage from './HomePage.jsx';
import StorePage from './StorePage.jsx';
import LibraryPage from './LibraryPage.jsx';
import MarketplacePage from './MarketplacePage.jsx';
import EnginePage from './EnginePage.jsx';
import SettingsPage from './SettingsPage.jsx';

function LauncherLayout() {
    useRenzoraTheme();

    const [active, setActive] = createSignal('home');
    const [showLogin, setShowLogin] = createSignal(false);

    const [config, { refetch: refetchConfig }] = createResource(() =>
        fetchJson(`${API}/config`).catch(() => ({}))
    );

    const [releases] = createResource(() =>
        fetchJson(`${API}/releases`).then((r) => r.releases || []).catch(() => [])
    );

    const [installed, { refetch: refetchInstalled }] = createResource(() =>
        fetchJson(`${API}/installed`).then((r) => r.installed || []).catch(() => [])
    );

    return (
        <Column class="h-screen bg-base-100">
            <Toolbar>
                <DragRegion class="flex-1 h-full" />
                <WindowControls />
            </Toolbar>

            <Row class="flex-1 overflow-hidden">
                <Sidebar active={active} setActive={setActive} config={config} setShowLogin={setShowLogin} />

                <div class="flex-1 overflow-y-auto">
                    {/* Setup warning */}
                    <Show when={!config.loading && !config()?.install_dir}>
                        <div class="mx-6 mt-4 px-4 py-2.5 rounded-xl bg-warning/8 border border-warning/15 flex items-center gap-2">
                            <svg class="w-4 h-4 text-warning shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                <line x1="12" y1="9" x2="12" y2="13" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                            <span class="text-xs">
                                Set an install directory in{' '}
                                <button class="text-primary font-medium hover:underline" onClick={() => setActive('settings')}>
                                    Settings
                                </button>
                                {' '}to get started.
                            </span>
                        </div>
                    </Show>

                    <Show when={active() === 'home'}>
                        <HomePage setActive={setActive} />
                    </Show>

                    <Show when={active() === 'store'}>
                        <StorePage setActive={setActive} />
                    </Show>

                    <Show when={active() === 'marketplace'}>
                        <MarketplacePage />
                    </Show>

                    <Show when={active() === 'library'}>
                        <LibraryPage setActive={setActive} setShowLogin={setShowLogin} />
                    </Show>

                    <Show when={active() === 'engine'}>
                        <EnginePage
                            releases={releases}
                            installed={installed}
                            refetchInstalled={refetchInstalled}
                        />
                    </Show>

                    <Show when={active() === 'settings'}>
                        <SettingsPage
                            config={config}
                            refetchConfig={refetchConfig}
                            setShowLogin={setShowLogin}
                        />
                    </Show>
                </div>
            </Row>

            {/* Login Modal */}
            <Show when={showLogin()}>
                <LoginModal setShowLogin={setShowLogin} refetchConfig={refetchConfig} />
            </Show>
        </Column>
    );
}

function LoginModal(props) {
    const [mode, setMode] = createSignal('login');
    const [username, setUsername] = createSignal('');
    const [email, setEmail] = createSignal('');
    const [password, setPassword] = createSignal('');
    const [error, setError] = createSignal('');
    const [loading, setLoading] = createSignal(false);

    function reset() {
        setError('');
        setUsername('');
        setEmail('');
        setPassword('');
    }

    function switchMode(m) {
        reset();
        setMode(m);
    }

    async function handleSubmit() {
        setLoading(true);
        setError('');
        try {
            const isRegister = mode() === 'register';
            const endpoint = isRegister ? `${API}/register` : `${API}/login`;
            const body = isRegister
                ? { username: username(), email: email(), password: password() }
                : { email: email(), password: password() };

            const result = await fetchJson(endpoint, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (result.error) {
                setError(result.error);
            } else {
                props.refetchConfig();
                props.setShowLogin(false);
            }
        } catch {
            setError('Connection failed');
        }
        setLoading(false);
    }

    const isRegister = () => mode() === 'register';

    return (
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && props.setShowLogin(false)}
        >
            <div class="w-80 bg-base-200 border border-white/[0.06] rounded-2xl p-6 shadow-2xl">
                <div class="text-center mb-5">
                    <div class="w-10 h-10 mx-auto rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-black text-lg mb-3">
                        R
                    </div>
                    <h2 class="text-sm font-bold">
                        {isRegister() ? 'Create an account' : 'Sign in to Renzora'}
                    </h2>
                    <p class="text-[10px] text-base-content/35 mt-1">
                        {isRegister() ? 'Join the Renzora community' : 'Access the store, library, and multiplayer'}
                    </p>
                </div>

                <div class="space-y-2.5">
                    <Show when={isRegister()}>
                        <input
                            type="text"
                            class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs placeholder:text-base-content/20 focus:border-primary/30"
                            placeholder="Username"
                            value={username()}
                            onInput={(e) => setUsername(e.target.value)}
                        />
                    </Show>
                    <input
                        type="email"
                        class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs placeholder:text-base-content/20 focus:border-primary/30"
                        placeholder="Email"
                        value={email()}
                        onInput={(e) => setEmail(e.target.value)}
                    />
                    <input
                        type="password"
                        class="input input-sm w-full rounded-lg bg-base-300/50 border-white/[0.04] text-xs placeholder:text-base-content/20 focus:border-primary/30"
                        placeholder={isRegister() ? 'Password (min 8 characters)' : 'Password'}
                        value={password()}
                        onInput={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    />
                    <Show when={error()}>
                        <div class="text-[11px] text-error px-1">{error()}</div>
                    </Show>
                    <button
                        class="btn btn-primary btn-sm w-full rounded-lg mt-1"
                        onClick={handleSubmit}
                        disabled={loading()}
                    >
                        {loading()
                            ? (isRegister() ? 'Creating account...' : 'Signing in...')
                            : (isRegister() ? 'Create account' : 'Sign in')}
                    </button>

                    <div class="text-center pt-1">
                        <Show when={!isRegister()} fallback={
                            <button class="text-[11px] text-base-content/40 hover:text-primary transition-colors" onClick={() => switchMode('login')}>
                                Already have an account? <span class="text-primary font-medium">Sign in</span>
                            </button>
                        }>
                            <button class="text-[11px] text-base-content/40 hover:text-primary transition-colors" onClick={() => switchMode('register')}>
                                Don't have an account? <span class="text-primary font-medium">Create one</span>
                            </button>
                        </Show>
                    </div>

                    <button
                        class="btn btn-ghost btn-xs w-full text-base-content/30"
                        onClick={() => props.setShowLogin(false)}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

export default plugin({
    id: 'launcher',
    name: 'Renzora Launcher',
    version: '0.1.0',

    start(api) {
        api.layout.register('launcher', {
            name: 'Launcher',
            component: LauncherLayout,
            order: 1,
        });
        api.layout.setActive('launcher');
    },

    stop() {},
});
