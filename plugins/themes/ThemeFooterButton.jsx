import { createSignal, createEffect, For, Show, onMount } from 'solid-js';
import { IconPalette, IconChevronUp } from '@tabler/icons-solidjs';
import { DAISYUI_THEMES } from './themes.jsx';

const THEME_STORAGE_KEY = 'webarcade-theme';
const DEFAULT_THEME = 'dark';

const ThemeFooterButton = () => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [currentThemeName, setCurrentThemeName] = createSignal(DEFAULT_THEME);

  // Load theme from localStorage on mount
  onMount(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
    setCurrentThemeName(savedTheme);
    applyTheme(savedTheme);
  });

  // Apply theme to document
  const applyTheme = (themeName) => {
    document.documentElement.setAttribute('data-theme', themeName);
  };

  const themesByCategory = () => {
    const grouped = {};
    DAISYUI_THEMES.forEach(theme => {
      if (!grouped[theme.category]) {
        grouped[theme.category] = [];
      }
      grouped[theme.category].push(theme);
    });
    return grouped;
  };

  const handleThemeSelect = (themeName) => {
    setCurrentThemeName(themeName);
    localStorage.setItem(THEME_STORAGE_KEY, themeName);
    applyTheme(themeName);
    setIsOpen(false);
  };

  const currentThemeLabel = () => {
    const theme = DAISYUI_THEMES.find(t => t.name === currentThemeName());
    return theme ? theme.label : currentThemeName();
  };

  return (
    <div class="relative">
      <Show when={isOpen()}>
        <div
          class="absolute bottom-full right-0 mb-2 w-64 bg-base-100 rounded-lg shadow-xl border border-base-300 max-h-96 overflow-y-auto"
          style={{ "z-index": "9999" }}
        >
          <div class="sticky top-0 bg-base-100 border-b border-base-300 px-3 py-2">
            <div class="flex items-center gap-2">
              <IconPalette size={16} class="text-base-content/70" />
              <span class="text-sm font-semibold text-base-content">Select Theme</span>
            </div>
          </div>

          <div class="p-2">
            <For each={Object.entries(themesByCategory())}>
              {([category, themes]) => (
                <div class="mb-3 last:mb-0">
                  <div class="px-2 py-1 text-xs font-semibold text-base-content/50 uppercase tracking-wide">
                    {category}
                  </div>
                  <div class="space-y-1">
                    <For each={themes}>
                      {(theme) => (
                        <button
                          class={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                            currentThemeName() === theme.name
                              ? 'bg-primary text-primary-content font-medium'
                              : 'hover:bg-base-200 text-base-content'
                          }`}
                          onClick={() => handleThemeSelect(theme.name)}
                        >
                          {theme.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={isOpen()}>
        <div
          class="fixed inset-0"
          style={{ "z-index": "9998" }}
          onClick={() => setIsOpen(false)}
        />
      </Show>

      <button
        class={`flex items-center gap-2 px-3 py-1 rounded transition-colors ${
          isOpen() ? 'bg-base-300' : 'hover:bg-base-200'
        }`}
        onClick={() => setIsOpen(!isOpen())}
        title="Change theme"
      >
        <IconPalette size={16} class="text-base-content/70" />
        <span class="text-xs text-base-content/80">{currentThemeLabel()}</span>
        <IconChevronUp
          size={14}
          class={`text-base-content/50 transition-transform ${isOpen() ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  );
};

export default ThemeFooterButton;
