/**
 * WebArcade API
 *
 * Drop-in replacement for @tauri-apps/api imports.
 * Use this in your frontend to replace Tauri imports:
 *
 * Before:
 *   import { getCurrentWindow } from '@tauri-apps/api/window';
 *   const win = getCurrentWindow();
 *   await win.setSize(new LogicalSize(800, 600));
 *
 * After:
 *   import { getCurrentWindow, LogicalSize } from './webarcade-api';
 *   const win = getCurrentWindow();
 *   await win.setSize(new LogicalSize(800, 600));
 */

// DPI types
export class LogicalSize {
    constructor(width, height) {
        this.width = width;
        this.height = height;
    }
}

export class LogicalPosition {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}

export class PhysicalSize {
    constructor(width, height) {
        this.width = width;
        this.height = height;
    }
}

export class PhysicalPosition {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}

// Get the IPC bridge
function getApi() {
    if (!window.__WEBARCADE__) {
        throw new Error('WebArcade IPC bridge not initialized');
    }
    return window.__WEBARCADE__;
}

// Window class - mimics Tauri's Window class
class Window {
    async close() {
        return getApi().window.close();
    }

    async minimize() {
        return getApi().window.minimize();
    }

    async maximize() {
        return getApi().window.maximize();
    }

    async unmaximize() {
        return getApi().window.unmaximize();
    }

    async toggleMaximize() {
        return getApi().window.toggleMaximize();
    }

    async isMaximized() {
        return getApi().window.isMaximized();
    }

    async setFullscreen(enabled) {
        return getApi().window.setFullscreen(enabled);
    }

    async setSize(size) {
        // Accept LogicalSize or {width, height}
        const w = size.width || size;
        const h = size.height || arguments[1];
        return getApi().window.setSize(w, h);
    }

    async innerSize() {
        const size = await getApi().window.getSize();
        return new PhysicalSize(size.width, size.height);
    }

    async outerSize() {
        return this.innerSize(); // Same for borderless window
    }

    async setPosition(position) {
        const x = position.x || position;
        const y = position.y || arguments[1];
        return getApi().window.setPosition(x, y);
    }

    async innerPosition() {
        const pos = await getApi().window.getPosition();
        return new PhysicalPosition(pos.x, pos.y);
    }

    async outerPosition() {
        return this.innerPosition();
    }

    async setMinSize(size) {
        if (size) {
            return getApi().window.setMinSize(size.width, size.height);
        }
    }

    async setMaxSize(size) {
        if (size) {
            return getApi().window.setMaxSize(size.width, size.height);
        }
    }

    async center() {
        return getApi().window.center();
    }

    async setTitle(title) {
        return getApi().window.setTitle(title);
    }

    async show() {
        // Window is always shown in our implementation
        return Promise.resolve();
    }

    async hide() {
        return this.minimize();
    }

    async setDecorations(enabled) {
        // No-op - we always use borderless
        return Promise.resolve();
    }

    async setAlwaysOnTop(enabled) {
        // TODO: implement if needed
        return Promise.resolve();
    }

    async startDragging() {
        return getApi().window.startDrag();
    }
}

// Singleton window instance
let windowInstance = null;

export function getCurrentWindow() {
    if (!windowInstance) {
        windowInstance = new Window();
    }
    return windowInstance;
}

// Event API - mimics @tauri-apps/api/event
export async function emit(event, payload) {
    return getApi().event.emit(event, payload);
}

export async function listen(event, callback) {
    return getApi().event.listen(event, callback);
}

export async function once(event, callback) {
    const unlisten = await listen(event, (payload) => {
        unlisten();
        callback(payload);
    });
    return unlisten;
}

// Core API - mimics @tauri-apps/api/core
export async function invoke(cmd, args) {
    // For Tauri invoke compatibility
    // Map to HTTP calls to your bridge server
    const response = await fetch(`http://127.0.0.1:3001/api/${cmd}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {})
    });
    return response.json();
}

// Check if running in WebArcade environment
export function isWebArcade() {
    return typeof window !== 'undefined' && !!window.__WEBARCADE__;
}

// For backwards compatibility with code that checks __TAURI_INTERNALS__
export function isTauri() {
    return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
}

// Default export for convenience
export default {
    window: { getCurrentWindow, Window },
    event: { emit, listen, once },
    core: { invoke },
    dpi: { LogicalSize, LogicalPosition, PhysicalSize, PhysicalPosition },
    isWebArcade,
    isTauri
};
