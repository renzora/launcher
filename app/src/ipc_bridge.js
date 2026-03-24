// WebArcade IPC Bridge
// This script is injected into the webview and provides window.__WEBARCADE__ API
// Uses window.ipc.postMessage() for native IPC communication

(function() {
    'use strict';

    // Pending IPC calls waiting for responses
    const pendingCalls = new Map();
    let callId = 0;

    // Check if native IPC is available (window.ipc is injected by wry)
    const hasNativeIpc = typeof window.ipc !== 'undefined' && typeof window.ipc.postMessage === 'function';

    // Callback for receiving IPC responses from Rust
    window.__WEBARCADE_IPC_CALLBACK__ = function(response) {
        const pending = pendingCalls.get(response.id);
        if (pending) {
            pendingCalls.delete(response.id);
            if (response.success) {
                pending.resolve(response.data);
            } else {
                pending.reject(new Error(response.error || 'IPC call failed'));
            }
        }
    };

    // Make an IPC call to Rust
    function ipcCall(command, args = {}) {
        return new Promise((resolve, reject) => {
            if (!hasNativeIpc) {
                // Fallback for browser mode - return sensible defaults
                if (command === 'isMaximized') return resolve(false);
                if (command === 'getSize') return resolve({ width: window.innerWidth, height: window.innerHeight });
                if (command === 'getPosition') return resolve({ x: 0, y: 0 });
                if (command === 'ping') return resolve('pong');
                // For operations that don't return data, just resolve
                return resolve(null);
            }

            const id = ++callId;
            const request = { id, command, args };

            // Store the pending call
            pendingCalls.set(id, { resolve, reject });

            // Set a timeout
            setTimeout(() => {
                if (pendingCalls.has(id)) {
                    pendingCalls.delete(id);
                    reject(new Error(`IPC call '${command}' timed out`));
                }
            }, 5000);

            // Send to Rust via window.ipc.postMessage
            try {
                window.ipc.postMessage(JSON.stringify(request));
            } catch (e) {
                pendingCalls.delete(id);
                reject(e);
            }
        });
    }

    // Synchronous-ish IPC for drag (fire and forget)
    function ipcCallSync(command, args = {}) {
        if (!hasNativeIpc) return null;

        const id = ++callId;
        const request = { id, command, args };

        // Don't wait for response - drag is fire-and-forget
        try {
            window.ipc.postMessage(JSON.stringify(request));
        } catch (e) {
            console.error(`[IPC] ${command} failed:`, e);
        }
        return null;
    }

    // Window API - replaces @tauri-apps/api/window
    const windowApi = {
        async close() {
            return ipcCall('close');
        },

        async minimize() {
            return ipcCall('minimize');
        },

        async maximize() {
            return ipcCall('maximize');
        },

        async unmaximize() {
            return ipcCall('unmaximize');
        },

        async toggleMaximize() {
            return ipcCall('toggleMaximize');
        },

        async isMaximized() {
            return ipcCall('isMaximized');
        },

        async setFullscreen(enabled = true) {
            return ipcCall('fullscreen', { enabled });
        },

        async setSize(width, height) {
            return ipcCall('setSize', { width, height });
        },

        async getSize() {
            return ipcCall('getSize');
        },

        async innerSize() {
            return ipcCall('getSize');
        },

        async setPosition(x, y) {
            return ipcCall('setPosition', { x, y });
        },

        async getPosition() {
            return ipcCall('getPosition');
        },

        async outerPosition() {
            return ipcCall('getPosition');
        },

        async setMinSize(width, height) {
            return ipcCall('setMinSize', { width, height });
        },

        async setMaxSize(width, height) {
            return ipcCall('setMaxSize', { width, height });
        },

        async center() {
            return ipcCall('center');
        },

        async setTitle(title) {
            return ipcCall('setTitle', { title });
        },

        // Start window drag - fire and forget
        startDrag() {
            ipcCallSync('startDrag');
        }
    };

    // Event system
    const eventListeners = new Map();
    let eventId = 0;

    const eventApi = {
        async emit(event, payload) {
            const listeners = eventListeners.get(event) || [];
            listeners.forEach(({ callback }) => callback(payload));
        },

        async listen(event, callback) {
            const id = ++eventId;
            if (!eventListeners.has(event)) {
                eventListeners.set(event, []);
            }
            eventListeners.get(event).push({ id, callback });

            return () => {
                const listeners = eventListeners.get(event) || [];
                const index = listeners.findIndex(l => l.id === id);
                if (index !== -1) {
                    listeners.splice(index, 1);
                }
            };
        }
    };

    // DPI utilities
    class LogicalSize {
        constructor(width, height) {
            this.width = width;
            this.height = height;
        }
    }

    class LogicalPosition {
        constructor(x, y) {
            this.x = x;
            this.y = y;
        }
    }

    // Drag region handling
    function setupDragRegions() {
        document.addEventListener('mousedown', (e) => {
            if (!hasNativeIpc) return;

            const dragRegion = e.target.closest('[data-drag-region], [data-tauri-drag-region]');
            if (dragRegion && e.button === 0) {
                const interactive = e.target.closest('button, a, input, select, textarea, [role="button"]');
                if (!interactive) {
                    e.preventDefault();
                    windowApi.startDrag();
                }
            }
        });
    }

    // Double-click to maximize
    function setupDoubleClickMaximize() {
        document.addEventListener('dblclick', (e) => {
            if (!hasNativeIpc) return;

            const dragRegion = e.target.closest('[data-drag-region], [data-tauri-drag-region]');
            if (dragRegion) {
                const interactive = e.target.closest('button, a, input, select, textarea, [role="button"]');
                if (!interactive) {
                    windowApi.toggleMaximize();
                }
            }
        });
    }

    // Initialize
    function init() {
        setupDragRegions();
        setupDoubleClickMaximize();

        // Expose APIs globally
        window.__WEBARCADE__ = {
            window: windowApi,
            event: eventApi,
            dpi: { LogicalSize, LogicalPosition },
            ipc: { call: ipcCall, callSync: ipcCallSync },
            isNative: hasNativeIpc
        };

        // Compatibility shim
        window.__TAURI_INTERNALS__ = {
            __WEBARCADE_COMPAT__: true
        };

        console.log(`[WebArcade] IPC bridge initialized (${hasNativeIpc ? 'native' : 'browser'} mode)`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
