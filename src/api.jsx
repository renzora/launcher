export async function fetchJson(url, options = {}) {
    const resp = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    return resp.json();
}

// Proxy any external URL through the Rust backend
export function proxy(url) {
    return '/api/fetch?url=' + encodeURIComponent(url);
}

export function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    return (bytes / 1e3).toFixed(0) + ' KB';
}

export function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
