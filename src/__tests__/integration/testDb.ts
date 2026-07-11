import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let replSet: MongoMemoryReplSet | null = null;

// mongodb.ts reads MONGODB_URI from process.env at module-eval time, so it must be set
// before dbConnect (or anything importing it, e.g. a route module) is first imported.
export async function connectTestDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replSet.getUri();
  const { dbConnect } = await import("@/lib/mongodb");
  await dbConnect();
}

export async function disconnectTestDb(): Promise<void> {
  await mongoose.connection.close();
  if (replSet) await replSet.stop();
}

export async function clearTestDb(): Promise<void> {
  for (const collection of Object.values(mongoose.connection.collections)) {
    await collection.deleteMany({});
  }
}
