import type { AuthConfig } from "@betterbudgets/auth";
import "varlock/auto-load";
import { ENV as runtimeEnv } from "varlock/env";

type ServerEnv = AuthConfig & {
  DATABASE_URL: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
};

export const ENV = runtimeEnv as ServerEnv;
