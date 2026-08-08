const fs = require('fs');
const PDFParser = require("pdf2json");
const { MongoClient, ObjectId } = require("mongodb");

const env = fs.readFileSync(".env.local", "utf8");
let uri = env.split("\n").find(line => line.startsWith("MONGODB_URI=")).substring("MONGODB_URI=".length).replace(/["']/g, "").trim();
uri = uri.replace("&appName=", "&appName=test").replace("?appName=", "?appName=test");

const KOP_PHARMACY_ID = "6a770a5269eeb1c414b0c939";

async function run() {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    
    let branch = await db.collection("branches").findOne({ pharmacyId: new ObjectId(KOP_PHARMACY_ID) });
    if (!branch) {
        console.log("No branch found for KOP. Creating a default Main Branch...");
        const res = await db.collection("branches").insertOne({
            pharmacyId: new ObjectId(KOP_PHARMACY_ID),
            branchName: "Main Branch",
            address: "Main Outlet",
            contactPhone: "",
            createdAt: new Date(),
            updatedAt: new Date()
        });
        branch = { _id: res.insertedId };
    }
    
    console.log("Using Branch ID:", branch._id);
    
    const user = await db.collection("users").findOne({ pharmacyId: new ObjectId(KOP_PHARMACY_ID) });
    let userId = user ? user._id : null;

    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError) );
    pdfParser.on("pdfParser_dataReady", async pdfData => {
        console.log(`Parsed PDF with ${pdfData.Pages.length} pages.`);
        let products = [];
        
        pdfData.Pages.forEach(page => {
            let items = [];
            page.Texts.forEach(textObj => {
                let text = textObj.R[0].T;
                try { text = decodeURIComponent(text); } catch(e) {}
                items.push({ x: textObj.x, y: textObj.y, text: text.trim() });
            });
            
            items.sort((a, b) => {
                if (Math.abs(a.y - b.y) < 0.5) return a.x - b.x;
                return a.y - b.y;
            });
            
            let currentY = -1;
            let row = [];
            items.forEach(item => {
                if (Math.abs(item.y - currentY) > 0.5) {
                    if (row.length > 0) processRow(row, products, branch._id);
                    row = [];
                    currentY = item.y;
                }
                row.push(item);
            });
            if (row.length > 0) processRow(row, products, branch._id);
        });
        
        console.log(`Successfully parsed ${products.length} products.`);
        console.log("Sample of first 3:");
        console.log(products.slice(0, 3));
        
        console.log("Sample of last 3:");
        console.log(products.slice(-3));
        
        // Bulk insert
        if (products.length > 0) {
            console.log("Inserting into database...");
            const result = await db.collection("products").insertMany(products);
            console.log(`Inserted ${result.insertedCount} products!`);
            
            console.log("Adding initial stock inventory into StoreProduct...");
            const storeProducts = products.map(p => ({
               pharmacyId: p.pharmacyId,
               storeId: branch._id, // the branch acts as the primary store conceptually? wait, let me check if there's a store
               itemName: p.itemName,
               brand: p.brand,
               size: p.size,
               category: p.category,
               baseUnitName: "piece",
               quantityInStock: p.quantityInStock,
               createdAt: new Date(),
               updatedAt: new Date()
            }));
            
            // Wait, StoreId needs to be a real Store ID. Let's find a store.
            let store = await db.collection("stores").findOne({ pharmacyId: new ObjectId(KOP_PHARMACY_ID) });
            if (!store) {
                 const storeRes = await db.collection("stores").insertOne({
                     pharmacyId: new ObjectId(KOP_PHARMACY_ID),
                     storeName: "Main Store",
                     branchId: branch._id,
                     createdAt: new Date(),
                     updatedAt: new Date()
                 });
                 store = { _id: storeRes.insertedId };
            }
            
            storeProducts.forEach(sp => sp.storeId = store._id);
            const spResult = await db.collection("storeproducts").insertMany(storeProducts);
            console.log(`Inserted ${spResult.insertedCount} store inventory records!`);
        }
        
        await client.close();
    });

    pdfParser.loadPDF("C:\\Users\\HP\\Desktop\\KOP\\KOP STOCK.pdf");
}

function processRow(row, products, branchId) {
    if (row.length < 5) return; // Ignore headers and junk rows
    if (row[0].text === "Department" || row[0].text.includes("Item Name") || row[0].text.includes("Page") || row[0].text.includes("KOP PHARMACY")) return;
    
    // We map by X coordinate ranges because optional columns can be skipped.
    let category = "supermarket"; // Default
    let itemName = "";
    let brand = "Generic";
    let size = "Standard";
    let qty = 0;
    let price = 0;
    
    row.forEach(cell => {
        if (cell.x < 3) {
            if (cell.text.toLowerCase().includes("pharmacy")) category = "medicine";
            else if (cell.text.toLowerCase().includes("supermarket")) category = "supermarket";
        } else if (cell.x >= 3 && cell.x < 13) {
            itemName += (itemName ? " " : "") + cell.text;
        } else if (cell.x >= 13 && cell.x < 17) {
            brand = cell.text;
        } else if (cell.x >= 17 && cell.x < 20) {
            size = cell.text;
        } else if (cell.x >= 20 && cell.x < 24) {
            qty = parseInt(cell.text.replace(/,/g, ''), 10) || 0;
        } else if (cell.x >= 33 && cell.x < 36) {
            price = parseFloat(cell.text.replace(/,/g, '')) || 0;
        }
    });
    
    if (itemName && price > 0) {
        products.push({
            pharmacyId: new ObjectId(KOP_PHARMACY_ID),
            branchId: branchId,
            itemName: itemName,
            brand: brand,
            size: size,
            category: category,
            quantityInStock: qty,
            alertQuantity: Math.max(1, Math.floor(qty * 0.2)),
            retailPrice: price,
            wholesalePrice: price,
            distributorPrice: price,
            batchNumber: "",
            expiryDate: null,
            importBatchId: null,
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }
}

run().catch(console.error);
