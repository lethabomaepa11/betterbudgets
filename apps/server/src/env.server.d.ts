import type { AuthConfig } from "@betterbudgets/auth";

export declare const ENV: AuthConfig & {
  DATABASE_URL: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
};
