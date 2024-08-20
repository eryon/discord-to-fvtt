import fs from 'fs';
import { defineConfig } from "vite";
import moduleJSON from "./module.json";

const moduleId = moduleJSON.id;

export default defineConfig(({ command, mode }) => {
  const buildMode = mode === "production" ? "production" : "development";

  // Create dummy files for vite dev server
  if (command === "serve") {
    const message = "This file is for a running vite dev server and is not copied to a build";
    fs.writeFileSync("./index.html", `<h1>${message}</h1>\n`);
    fs.writeFileSync(`./${moduleId}.js`, `/** ${message} */\n\nimport "./src/index.js";\n`);
  }

  return {
    assetsInclude: ["./module.json"],
    base: command === "build" ? "./" : `/modules/${moduleId}/`,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      minify: false,
      sourcemap: buildMode === "development",
      lib: {
        name: moduleId,
        entry: "src/index.js",
        formats: ["es"],
        fileName: moduleId
      },
      rollupOptions: {
        output: {
          assetFileNames: ({ name }) => (name === "style.css" ? `styles/${moduleId}.css` : (name ?? "")),
          chunkFileNames: "[name].js",
          entryFileNames: `${moduleId}.js`,
        },
        watch: { buildDelay: 100 }
      }
    },
    css: {
      devSourcemap: buildMode === "development",
    },
    esbuild: { keepNames: true },
    server: {
      port: 30001,
      open: "/game",
      proxy: {
        [`^(?!/modules/${moduleId}/)`]: "http://localhost:30000/",
        "/socket.io": {
          target: "ws://localhost:30000",
          ws: true
        }
      }
    }
  };
});
