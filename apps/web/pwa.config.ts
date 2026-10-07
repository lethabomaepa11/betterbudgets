import type { NextConfig } from "next";
import withPwa from "@ducanh2912/next-pwa";

export function withPwaWrapper(config: NextConfig): NextConfig {
  // Static exports need these headers configured at the hosting layer.
  if (config.output === "export") return config;

  const withPwaConfig = withPwa({
    dest: "public",
    register: true,
    disable: process.env.NODE_ENV === "development",
    workboxOptions: {
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
      runtimeCaching: [
        {
          urlPattern: /^https?.*/,
          handler: "NetworkFirst",
          options: {
            cacheName: "bts-pwa-runtime",
            expiration: {
              maxEntries: 100,
              maxAgeSeconds: 7 * 24 * 60 * 60,
            },
            networkTimeoutSeconds: 10,
          },
        },
      ],
    },
  });

  const pwaConfig = withPwaConfig({
    ...config,
    async headers() {
      return [
        ...((await config.headers?.()) ?? []),
        {
          source: "/sw.js",
          headers: [
            { key: "Content-Type", value: "application/javascript; charset=utf-8" },
            { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
            { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
          ],
        },
      ];
    },
  });

  return pwaConfig;
}
