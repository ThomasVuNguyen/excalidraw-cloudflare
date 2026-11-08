import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { cloudflare } from "@cloudflare/vite-plugin";

const versionFilePath = path.resolve(__dirname, "../VERSION");
let versionFromFile = "0.0.0";

try {
  const raw = fs.readFileSync(versionFilePath, "utf8").trim();
  if (raw) {
    versionFromFile = raw;
  }
} catch (error) {
  console.warn("Unable to read VERSION file:", error);
}

const appVersion = process.env.VITE_APP_VERSION?.trim() || versionFromFile;
// GlitchTip release = git commit SHA (deploy.sh passes SENTRY_RELEASE explicitly)
let sentryRelease = process.env.SENTRY_RELEASE?.trim() || "";
if (!sentryRelease) {
  try {
    sentryRelease = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    sentryRelease = "";
  }
}
const buildLabel = process.env.VITE_APP_BUILD_LABEL?.trim() || "local development build";

export default defineConfig(({ command }) => {
  const nodeEnv = process.env.NODE_ENV || (command === "build" ? "production" : "development");
  const devBackendTarget = process.env.VITE_DEV_BACKEND_URL?.trim() || "http://localhost:8787";
  const processEnvDefines = {
    'process.env.IS_PREACT': JSON.stringify("false"),
    'process.env.NODE_ENV': JSON.stringify(nodeEnv),
  };

  return {
    plugins: [react(), cloudflare()],
    define: {
      ...processEnvDefines,
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.VITE_APP_BUILD_LABEL': JSON.stringify(buildLabel),
      'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(sentryRelease),
    },
    build: {
      // Generate source maps for GlitchTip but don't reference them in output
      // (they get uploaded separately and deleted after deploy)
      sourcemap: "hidden",
      rollupOptions: {
        output: {
          // Excalidraw's font-subsetting Web Worker (subset-worker.chunk.js) imports a few tiny
          // shared helper chunks. Left alone, Rollup merges them into our app entry, so the
          // worker ends up importing index-*.js, which touches `document` and throws
          // "document is not defined" inside the worker. Give each of the worker's
          // helpers that the worker shares with the app their own chunk so the worker never
          // loads the app entry. (Worker-only deps are left alone so they stay lazy.)
          manualChunks(id, { getModuleInfo }) {
            if (!id.includes("/@excalidraw/excalidraw/dist/prod/chunk-")) return undefined;
            const subsetChunk = /\/@excalidraw\/excalidraw\/dist\/prod\/subset-(worker|shared)\.chunk\.js$/;
            const importers = getModuleInfo(id)?.importers ?? [];
            const sharedWithApp =
              importers.some((importer) => subsetChunk.test(importer) || importer.includes("/dist/prod/chunk-")) &&
              importers.some((importer) => !subsetChunk.test(importer));
            if (!sharedWithApp) return undefined;
            return `excalidraw-${path.basename(id, ".js")}`;
          },
        },
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        define: processEnvDefines,
        target: "es2022",
      },
    },
    server: {
      proxy: {
        "/api": {
          target: devBackendTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        "/ws": {
          target: devBackendTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});