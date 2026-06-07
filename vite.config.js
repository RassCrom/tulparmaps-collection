import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

// Find all generated project pages
const projectPages = {};
const projectDir = resolve(__dirname, 'project');
if (fs.existsSync(projectDir)) {
  const folders = fs.readdirSync(projectDir);
  folders.forEach(folder => {
    const indexPath = resolve(projectDir, folder, 'index.html');
    if (fs.existsSync(indexPath)) {
      projectPages[`project-${folder}`] = indexPath;
    }
  });
}

export default defineConfig({
  base: '/',
  publicDir: 'public',
  build: {
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ...projectPages
      }
    }
  }
});
