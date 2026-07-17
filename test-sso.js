const mongoose = require("mongoose");
const { PrismaClient } = require("../PSX EMR/node_modules/@prisma/client");

const uri = "mongodb+srv://psxnig_db_user:BhMzX7OgfyoMNkF4@cluster0.06byfg6.mongodb.net/pharmastackx?appName=Cluster0";

async function run() {
  await mongoose.connect(uri);
  const prisma = new PrismaClient({
    datasources: { db: { url: uri } },
  });

  const token = "test-token-123";
  const userId = new mongoose.Types.ObjectId();

  await mongoose.connection.db.collection("sso_tokens").insertOne({
    token,
    userId,
    expiresAt: new Date(Date.now() + 60000),
    createdAt: new Date(),
  });

  console.log("Inserted using mongoose, userId type:", typeof userId, userId);

  const found = await prisma.ssoToken.findUnique({
    where: { token },
  });

  console.log("Found using Prisma:", found);

  await mongoose.disconnect();
  await prisma.$disconnect();
}

run().catch(console.error);
