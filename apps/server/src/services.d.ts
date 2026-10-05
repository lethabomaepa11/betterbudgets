import type { Database } from "@betterbudgets/db";
import type { createAuth } from "@betterbudgets/auth";

export declare const db: Database;
export declare const auth: ReturnType<typeof createAuth>;
