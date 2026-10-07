import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@betterbudgets/db";
import { db } from "@/server/services";
import { getUserFromRequest } from "@/server/auth-server";

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

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const userId = user.id;

  const body = await request.json().catch(() => null);
  const parsed = syncPushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "The sync payload was invalid.", details: parsed.error.flatten() }, { status: 400 });
  }

  const operations = parsed.data.operations;

  try {
    // Fast path: only write to syncChange (outbox), return immediately
    // Background job will process syncChange -> syncRecord
    // Use upsert to make it idempotent - skip operations that already exist
    const result = await db.$transaction(async (tx) => {
      let revision = await tx.syncChange.count({ where: { userId } });
      let accepted = 0;

      for (const op of operations) {
        // Check if this operation already exists (idempotency)
        const existing = await tx.syncChange.findUnique({
          where: { userId_operationId: { userId, operationId: op.operationId } },
          select: { id: true },
        });

        if (existing) {
          // Already processed, skip
          continue;
        }

        revision += 1;
        accepted += 1;

        await tx.syncChange.create({
          data: {
            id: crypto.randomUUID(),
            userId,
            operationId: op.operationId,
            entity: op.entity,
            entityId: op.entityId,
            payload: op.payload as Prisma.InputJsonValue,
            deleted: op.deleted,
            revision,
          },
        });
      }

      return { revision, accepted };
    });

    // Trigger background processing (fire and forget)
    processOutbox(userId).catch(console.error);

    return NextResponse.json({ revision: result.revision, accepted: result.accepted });
  } catch (error) {
    console.error("Sync push error:", error);
    return NextResponse.json({ error: "Failed to process sync operations.", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

// Background job to process outbox -> syncRecord
async function processOutbox(userId: string) {
  try {
    // Get unprocessed changes
    const changes = await db.syncChange.findMany({
      where: { userId, processed: false },
      orderBy: { revision: "asc" },
      take: 100,
    });

    if (changes.length === 0) return;

    // Process each change in its own transaction to avoid timeout
    for (const change of changes) {
      try {
        await db.$transaction(async (tx) => {
          if (change.deleted) {
            await tx.syncRecord.deleteMany({
              where: { userId, entity: change.entity, entityId: change.entityId },
            });
          } else {
            await tx.syncRecord.upsert({
              where: { userId_entity_entityId: { userId, entity: change.entity, entityId: change.entityId } },
              create: {
                id: crypto.randomUUID(),
                userId,
                entity: change.entity,
                entityId: change.entityId,
                payload: change.payload as Prisma.InputJsonValue,
                deleted: false,
                revision: change.revision,
              },
              update: { payload: change.payload as Prisma.InputJsonValue, deleted: false, revision: change.revision },
            });
          }

          // Mark as processed
          await tx.syncChange.update({
            where: { id: change.id },
            data: { processed: true },
          });
        });
      } catch (error) {
        console.error(`Failed to process change ${change.id}:`, error);
        // Continue with next change
      }
    }
  } catch (error) {
    console.error("Background outbox processing failed:", error);
  }
}