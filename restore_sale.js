const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";
const Sale = mongoose.models.Sale || mongoose.model("Sale", new mongoose.Schema({}, { strict: false }));

async function run() {
  await mongoose.connect(uri);
  
  const restoredSale = {
    _id: new mongoose.Types.ObjectId('6a772deb4458df78b0a930e3'),
    pharmacyId: new mongoose.Types.ObjectId('6a770a5269eeb1c414b0c939'),
    branchId: new mongoose.Types.ObjectId('6a7713d0b1d1061c03a22ac1'),
    userId: new mongoose.Types.ObjectId('6a7716e645f2121421e0949f'),
    customerId: null,
    customerName: 'Client8-20260808',
    items: [
      {
        productId: new mongoose.Types.ObjectId('6a7713ec262ff74bb95eccc6'),
        productName: 'NEUROVIT FORTE(Hovid) · Standard · Generic',
        isCustom: false,
        batchDraws: [],
        itemName: null,
        brand: null,
        size: null,
        category: null,
        quantity: 1,
        form: null,
        formQuantity: null,
        priceTierUsed: 'retail',
        unitPrice: 2300,
        lineTotal: 2300,
        unitCost: 1450,
        costTotal: 1450
      }
    ],
    totalAmount: 2300,
    payments: [ { method: 'card', amount: 2300 } ],
    amountTendered: 2300,
    changeGiven: 0,
    changeMethod: 'cash',
    changeFee: 0,
    printStatus: 'not_needed',
    timestamp: new Date('2026-08-08T13:23:55.705Z'),
    createdAt: new Date('2026-08-08T13:23:55.708Z'),
    updatedAt: new Date('2026-08-08T13:23:55.708Z'),
    __v: 0,
    totalCost: 1450
  };
  
  await Sale.create(restoredSale);
  console.log("Restored the Neurovit Forte sale successfully!");
  
  await mongoose.disconnect();
}

run().catch(console.error);
