const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const mongoUri = env.split('\n').find(l => l.startsWith('MONGODB_URI=')).split('=')[1].trim();

const mongoose = require('mongoose');

mongoose.connect(mongoUri).then(async () => {
  const db = mongoose.connection.db;
  const docs = await db.collection('storeproducts').find({ itemName: { $in: [null, undefined, ''] } }).toArray();
  const docs2 = await db.collection('storeproducts').find({ name: { $exists: true } }).toArray();
  console.log('Empty itemName:', JSON.stringify(docs, null, 2));
  console.log('With name:', JSON.stringify(docs2, null, 2));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
