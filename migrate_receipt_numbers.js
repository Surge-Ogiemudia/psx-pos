import mongoose from "mongoose";
import dotenv from "dotenv";
import { join } from "path";

dotenv.config({ path: join(process.cwd(), ".env.local") });

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");

  // Define minimal schemas to interact directly
  const CounterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
  });
  const Counter = mongoose.models.Counter || mongoose.model("Counter", CounterSchema);

  const SaleSchema = new mongoose.Schema({}, { strict: false });
  const Sale = mongoose.models.Sale || mongoose.model("Sale", SaleSchema);

  const RefundSchema = new mongoose.Schema({}, { strict: false });
  const Refund = mongoose.models.Refund || mongoose.model("Refund", RefundSchema);

  await Counter.deleteMany({});

  const sales = await Sale.find({}).sort({ timestamp: 1 });
  console.log(`Found ${sales.length} sales to migrate.`);

  let updatedSales = 0;
  for (const sale of sales) {
    if (sale.get("receiptNumber")) {
      updatedSales++;
      continue;
    }
    const d = new Date(sale.get("timestamp") || sale._id.getTimestamp());
    const datePrefix = `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, "0")}${d.getDate().toString().padStart(2, "0")}`;
    const counterId = `${sale.get("pharmacyId").toString()}-${datePrefix}`;
    
    const counterDoc = await Counter.findByIdAndUpdate(
      counterId,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    
    const receiptNumber = `${datePrefix}-${counterDoc.seq.toString().padStart(3, "0")}`;
    
    sale.set("receiptNumber", receiptNumber);
    await sale.save();
    updatedSales++;
  }
  console.log(`Updated ${updatedSales} sales.`);

  const refunds = await Refund.find({}).sort({ timestamp: 1 });
  console.log(`Found ${refunds.length} refunds to migrate.`);

  let updatedRefunds = 0;
  for (const refund of refunds) {
    if (refund.get("receiptNumber")) {
      updatedRefunds++;
      continue;
    }
    const d = new Date(refund.get("timestamp") || refund._id.getTimestamp());
    const datePrefix = `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, "0")}${d.getDate().toString().padStart(2, "0")}`;
    const counterId = `${refund.get("pharmacyId").toString()}-${datePrefix}`;
    
    const counterDoc = await Counter.findByIdAndUpdate(
      counterId,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    
    const receiptNumber = `${datePrefix}-${counterDoc.seq.toString().padStart(3, "0")}`;
    
    refund.set("receiptNumber", receiptNumber);
    await refund.save();
    updatedRefunds++;
  }
  console.log(`Updated ${updatedRefunds} refunds.`);

  await mongoose.disconnect();
  console.log("Migration complete.");
}

migrate().catch(console.error);
