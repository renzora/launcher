import { IconMinus, IconSquare, IconX } from '@tabler/icons-solidjs';

export default function Titlebar() {
  const win = window.__WEBARCADE__?.window;

  return (
    <div class="h-9 bg-base-200 flex items-center justify-between px-3 select-none" data-drag-region>
      <span class="text-sm opacity-70">Renzora Launcher</span>
      <div class="flex gap-1">
        <button class="btn btn-ghost btn-xs" onClick={() => win?.minimize()}><IconMinus size={14} /></button>
        <button class="btn btn-ghost btn-xs" onClick={() => win?.toggleMaximize()}><IconSquare size={12} /></button>
        <button class="btn btn-ghost btn-xs hover:btn-error" onClick={() => win?.close()}><IconX size={14} /></button>
      </div>
    </div>
  );
}
