import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

export async function dbConnect(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  if (!cache.promise) {
    // maxIdleTimeMS closes unused connections so many short-lived serverless instances don't
    // pile up against Atlas's 500-connection cap on the free tier.
    cache.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 5,
      maxIdleTimeMS: 20000,
      serverSelectionTimeoutMS: 10000,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (err) {
    // Don't cache a failed connect: otherwise this instance keeps re-throwing the same error
    // long after the database has recovered.
    cache.promise = null;
    throw err;
  }
  return cache.conn;
}
