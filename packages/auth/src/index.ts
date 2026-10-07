import { expo } from "@better-auth/expo";
import type { Database } from "@betterbudgets/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export type AuthConfig = {
  NODE_ENV: "development" | "production" | "test";
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  const isDevelopment = env.NODE_ENV === "development";
  return betterAuth({
    database: prismaAdapter(database, {
      provider: "postgresql",
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      ...desktopOrigins,
      "betterbudgets://",
      "http://localhost:8081",
      ...(isDevelopment ? ["exp://"] : []),
    ],
    emailAndPassword: { enabled: true },
    rateLimit: {
      enabled: true,
      window: 10,
      max: 100,
      customRules: {
        "/api/auth/sign-in/email": { window: 60, max: 5 },
        "/api/auth/sign-up/email": { window: 60, max: 3 },
        "/api/auth/change-password": { window: 60, max: 5 },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      disableCSRFCheck: false,
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
      },
      defaultCookieAttributes: {
        sameSite: isDevelopment ? "lax" : "none",
        secure: !isDevelopment,
        httpOnly: true,
      },
    },
    plugins: [expo()],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
