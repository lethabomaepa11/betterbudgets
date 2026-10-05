import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";

const withVarlock = varlockNextConfigPlugin();
import type { NextConfig } from "next";

import { withPwa } from "./pwa.config";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  output: "standalone",
  allowedDevOrigins: ['10.0.0.151'],
  turbopack: {
    rules: {
      /*
       * `@sqlite.org/sqlite-wasm` publishes a single amalgamated ESM build that
       * also contains SQLite's deprecated Worker1 promiser, which spawns a
       * worker from a *computed* specifier. No bundler can resolve that
       * statically, and it aborts the build.
       *
       * The loader rewrites that one expression to its equivalent literal. The
       * rule is scoped by `content` so it only touches the file that actually
       * contains the pattern, rather than every module in node_modules.
       */
      "*": {
        condition: {
          all: [
            { path: /sqlite3-worker1\.mjs$/ },
            { content: /new Worker\(new URL\(proxyUri, import\.meta\.url\)\)/ },
          ],
        },
        loaders: ["./scripts/sqlite-wasm-static-worker-url-loader.cjs"],
      },
    },
  },
};

export default withVarlock(withPwa(nextConfig));
