import { plugin } from '@/api/plugin';
import { IconPalette } from '@tabler/icons-solidjs';
import ThemeFooterButton from './ThemeFooterButton.jsx';

export { DAISYUI_THEMES } from './themes.jsx';

export default plugin({
    id: 'themes',
    name: 'Theme System',
    version: '3.0.0',
    description: 'Theme system using DaisyUI built-in themes',
    author: 'WebArcade Team',
    icon: IconPalette,

    start(api) {
        // Register theme selector as a status bar component
        api.register('theme-selector', {
            type: 'status',
            component: ThemeFooterButton,
            align: 'right',
            priority: 50
        });

        console.log('[Theme Plugin] Registered theme selector');
    },

    stop(api) {
        console.log('[Theme Plugin] Stopping...');
    }
});
