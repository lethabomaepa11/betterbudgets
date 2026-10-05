import { initLogger } from "evlog";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Context, MiddlewareHandler } from "hono";
import type { Prisma } from "@betterbudgets/db";
import { z } from "zod";

import { ENV } from "./env.server";
import { auth, db } from "./services";

initLogger({
  env: { service: "betterbudgets-server" },
});

const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

const app = new Hono<EvlogVariables>();

type RateLimitBucket = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();
const RATE_LIMIT_WINDOW_MS = 60_000;

function requestKey(c: Context) {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
}

function rateLimit(max: number): MiddlewareHandler {
  return async (c, next) => {
    const now = Date.now();
    for (const [key, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
    }
    if (rateLimitBuckets.size > 10_000) rateLimitBuckets.clear();

    const key = `${c.req.path}:${requestKey(c)}`;
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    } else if (bucket.count >= max) {
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    } else {
      bucket.count += 1;
    }
    await next();
  };
}

app.get("/health/live", (c) => c.json({ status: "ok" }));
app.get("/health/ready", async (c) => {
  try {
    await db.$queryRaw`SELECT 1`;
    return c.json({ status: "ok" });
  } catch {
    return c.json({ status: "unavailable" }, 503);
  }
});

const planRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  intent: z.string().trim().max(1_000).optional(),
  currency: z.string().trim().min(1).max(8),
  targetAmount: z.number().finite().positive(),
  targetDate: z.string().date().optional(),
  monthlyRequired: z.number().finite().nonnegative(),
  monthlyCapacity: z.number().finite().nonnegative(),
  feasibility: z.enum(["comfortable", "tight", "impossible", "unknown"]),
});

const planAdviceSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  steps: z.array(z.string().trim().min(1).max(240)).min(2).max(5),
  adjustment: z.string().trim().min(1).max(400),
});

const syncOperationSchema = z.object({
  operationId: z.string().trim().min(1).max(128),
  entity: z.string().trim().min(1).max(80),
  entityId: z.string().trim().min(1).max(128),
  deleted: z.boolean().default(false),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const syncPushSchema = z.object({
  operations: z.array(syncOperationSchema).min(1).max(100),
});

app.use(evlog());
app.use("*", secureHeaders());
app.use("*", bodyLimit({ maxSize: 512 * 1024 }));
app.use("*", async (c, next) => {
  await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
  await next();
});

app.use(
  "/*",
  cors({
    origin: (origin) => (origin === ENV.CORS_ORIGIN ? origin : ""),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => auth.handler(c.req.raw));

app.use("/api/sync/*", rateLimit(30));
app.post("/api/sync/push", async (c) => {
  const userId = await auth.api.getSession({ headers: c.req.raw.headers }).then((session) => session?.user.id ?? null);
  if (!userId) return c.json({ error: "Sign in to sync your budget." }, 401);

  const parsed = syncPushSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "The sync batch was invalid." }, 400);

  const accepted: string[] = [];
  const rejected: Array<{ operationId: string; reason: string }> = [];
  let latestRevision = 0;

  await db.$transaction(async (tx) => {
    for (const operation of parsed.data.operations) {
      const existing = await tx.syncChange.findUnique({
        where: { userId_operationId: { userId, operationId: operation.operationId } },
        select: { revision: true },
      });
      if (existing) {
        accepted.push(operation.operationId);
        latestRevision = Math.max(latestRevision, existing.revision);
        continue;
      }

      const latest = await tx.syncChange.findFirst({
        where: { userId },
        orderBy: { revision: "desc" },
        select: { revision: true },
      });
      const revision = (latest?.revision ?? 0) + 1;
      await tx.syncRecord.upsert({
        where: { userId_entity_entityId: { userId, entity: operation.entity, entityId: operation.entityId } },
        create: {
          id: crypto.randomUUID(),
          userId,
          entity: operation.entity,
          entityId: operation.entityId,
          payload: operation.payload as Prisma.InputJsonValue,
          deleted: operation.deleted,
          revision,
        },
        update: {
          payload: operation.payload as Prisma.InputJsonValue,
          deleted: operation.deleted,
          revision,
        },
      });
      await tx.syncChange.create({
        data: {
          id: crypto.randomUUID(),
          userId,
          operationId: operation.operationId,
          entity: operation.entity,
          entityId: operation.entityId,
          payload: operation.payload as Prisma.InputJsonValue,
          deleted: operation.deleted,
          revision,
        },
      });
      accepted.push(operation.operationId);
      latestRevision = revision;
    }
  });

  return c.json({ accepted, rejected, latestRevision });
});

app.get("/api/sync/pull", async (c) => {
  const userId = await auth.api.getSession({ headers: c.req.raw.headers }).then((session) => session?.user.id ?? null);
  if (!userId) return c.json({ error: "Sign in to sync your budget." }, 401);

  const after = Number(c.req.query("after") ?? "0");
  if (!Number.isSafeInteger(after) || after < 0) return c.json({ error: "The sync cursor was invalid." }, 400);

  const changes = await db.syncChange.findMany({
    where: { userId, revision: { gt: after } },
    orderBy: { revision: "asc" },
    take: 100,
  });
  const nextCursor = changes.at(-1)?.revision ?? after;
  return c.json({
    changes: changes.map(({ operationId, entity, entityId, payload, deleted, revision }) => ({
      operationId,
      entity,
      entityId,
      payload,
      deleted,
      revision,
    })),
    nextCursor,
    hasMore: changes.length === 100,
  });
});

app.use("/api/ai/*", rateLimit(10));
app.post("/api/ai/plan", async (c) => {
  const apiKey = ENV.GROQ_API_KEY;
  if (!apiKey) {
    return c.json({ error: "AI planning is not configured on the server." }, 503);
  }

  const parsed = planRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "The plan details were invalid." }, 400);
  }

  const facts = parsed.data;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: ENV.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a practical budgeting coach. Return only valid JSON with exactly these keys: title (string), summary (string), steps (array of 2 to 5 short strings), adjustment (string). Use only the supplied facts. Never invent balances, income, expenses, or dates. Do not give investment, lending, tax, or legal advice. If feasibility is impossible, be honest and suggest a later date, smaller target, expense reduction, or extra income. Keep the tone encouraging and concrete.",
        },
        {
          role: "user",
          content: JSON.stringify(facts),
        },
      ],
    }),
  }).catch(() => null);

  if (!response?.ok) {
    return c.json({ error: "The AI planning service is temporarily unavailable." }, 502);
  }

  const body = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    return c.json({ error: "The AI planning service returned no advice." }, 502);
  }

  let advice: unknown;
  try {
    advice = JSON.parse(content);
  } catch {
    return c.json({ error: "The AI planning service returned invalid advice." }, 502);
  }

  const validated = planAdviceSchema.safeParse(advice);
  if (!validated.success) {
    return c.json({ error: "The AI planning service returned incomplete advice." }, 502);
  }

  return c.json(validated.data);
});

app.get("/", (c) => {
  return c.text("OK");
});

import { serve } from "@hono/node-server";

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
