import { onMount } from 'solid-js';

const THEME_CSS = `
[data-theme="renzora"] {
  color-scheme: dark;
  --color-base-100: oklch(0.17 0.025 280);
  --color-base-200: oklch(0.14 0.025 280);
  --color-base-300: oklch(0.11 0.025 280);
  --color-base-content: oklch(0.90 0.01 280);
  --color-primary: oklch(0.55 0.13 300);
  --color-primary-content: oklch(0.98 0.005 300);
  --color-secondary: oklch(0.48 0.11 30);
  --color-secondary-content: oklch(0.98 0.005 30);
  --color-accent: oklch(0.82 0.10 80);
  --color-accent-content: oklch(0.18 0.03 80);
  --color-neutral: oklch(0.20 0.02 280);
  --color-neutral-content: oklch(0.85 0.01 280);
  --color-info: oklch(0.65 0.15 240);
  --color-success: oklch(0.65 0.18 155);
  --color-warning: oklch(0.75 0.15 80);
  --color-error: oklch(0.60 0.18 25);
  --rounded-box: 0.75rem;
  --rounded-btn: 0.5rem;
  --rounded-badge: 1rem;
  --tab-radius: 0.5rem;
}
`;

export function injectTheme() {
    if (typeof document === 'undefined') return;
    if (document.querySelector('[data-renzora-theme]')) return;

    const style = document.createElement('style');
    style.setAttribute('data-renzora-theme', 'true');
    style.textContent = THEME_CSS;
    document.head.appendChild(style);

    document.documentElement.setAttribute('data-theme', 'renzora');
}

export function useRenzoraTheme() {
    onMount(() => injectTheme());
}
