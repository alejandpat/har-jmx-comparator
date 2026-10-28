import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Base relativa: permite servir la app desde cualquier ruta (GitHub Pages
  // con subruta de proyecto, servidor interno, etc.) sin recompilar.
  base: "./",
})
