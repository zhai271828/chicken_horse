import { defineConfig } from 'vite';

export default defineConfig({
    // Project root directory
    root: './',
    // Base public path when served in production
    base: '/',
    publicDir: 'src/public',
    build: {
        outDir: 'dist',
    },
});
