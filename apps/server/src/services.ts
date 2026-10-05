import { createAuth } from "@betterbudgets/auth";
import { createPrismaClient } from "@betterbudgets/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
