import { NextRequest, NextResponse } from "next/server";
import { gzipSync } from "zlib";
import { put, list, del } from "@vercel/blob";
import { dbConnect } from "@/lib/mongodb";
import { handleApiError } from "@/lib/apiError";

// Free-tier Atlas clusters (M0) don't support Cloud Backup at all, so this is a stopgap
// safety net: a periodic full-database dump, not a substitute for real point-in-time
// recovery. Triggered by Vercel Cron (see vercel.json), which — once CRON_SECRET is set
// as an env var — automatically sends it back as this bearer token, so no other caller
// can trigger a database dump.
export const maxDuration = 60;

const BACKUP_PREFIX = "backups/";
const RETENTION_DAYS = 14;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const mongooseInstance = await dbConnect();
    const db = mongooseInstance.connection.db;
    if (!db) throw new Error("No active database connection");

    const collectionInfos = await db.listCollections().toArray();
    const dump: Record<string, unknown[]> = {};
    for (const { name } of collectionInfos) {
      dump[name] = await db.collection(name).find({}).toArray();
    }

    const gzipped = gzipSync(Buffer.from(JSON.stringify(dump)));
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { url } = await put(`${BACKUP_PREFIX}${timestamp}.json.gz`, gzipped, {
      access: "private",
      contentType: "application/gzip",
      addRandomSuffix: false,
    });

    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const { blobs } = await list({ prefix: BACKUP_PREFIX });
    const stale = blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
    if (stale.length > 0) {
      await del(stale.map((b) => b.url));
    }

    return NextResponse.json({
      backedUp: true,
      url,
      collections: Object.keys(dump).length,
      documents: Object.values(dump).reduce((sum, docs) => sum + docs.length, 0),
      deletedStale: stale.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
