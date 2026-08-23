import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  // Относительные пути к ассетам — игра развёрнута под /tolpa/, без этого vite
  // собирает с абсолютными /assets/... и браузер идёт на корень (404) → пустая страница.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 3000,
  },
});
