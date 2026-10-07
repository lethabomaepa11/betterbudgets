import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/services";
import { getUserFromRequest } from "@/server/auth-server";

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const userId = user.id;

  const after = Number(request.nextUrl.searchParams.get("after") ?? "0");
  if (!Number.isSafeInteger(after) || after < 0) {
    return NextResponse.json({ error: "The sync cursor was invalid." }, { status: 400 });
  }

  try {
    const changes = await db.syncChange.findMany({
      where: { userId, revision: { gt: after } },
      orderBy: { revision: "asc" },
      take: 100,
    });

    const nextCursor = changes.at(-1)?.revision ?? after;

    return NextResponse.json({
      changes: changes.map((change) => ({
        operationId: change.operationId,
        entity: change.entity,
        entityId: change.entityId,
        payload: change.payload,
        deleted: change.deleted,
        revision: change.revision,
      })),
      nextCursor,
      hasMore: changes.length === 100,
    });
  } catch (error) {
    console.error("Sync pull error:", error);
    return NextResponse.json({ error: "Failed to fetch sync changes.", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}