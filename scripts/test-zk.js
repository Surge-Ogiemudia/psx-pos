const ZKLib = require('node-zklib');

// Replace with the IP address of your ZKTeco machine on your local network
const DEVICE_IP = '192.168.100.25';
const DEVICE_PORT = 4370; // Default port

const testConnection = async () => {
    // Initialize the library with IP, Port, Timeout, and In-Port
    let zkInstance = new ZKLib(DEVICE_IP, DEVICE_PORT, 10000, 4000);

    try {
        console.log(`Attempting to connect to ZKTeco device at ${DEVICE_IP}:${DEVICE_PORT}...`);
        
        // 1. Create socket to the machine
        await zkInstance.createSocket();
        console.log("✅ Successfully connected to device!");

        // 2. Get general info (log capacity, user count, etc.)
        const info = await zkInstance.getInfo();
        console.log("\n--- Device Info ---");
        console.log(info);

        // 3. Get all registered users
        const users = await zkInstance.getUsers();
        console.log(`\n--- Users (${users.data.length}) ---`);
        console.log(users.data.slice(0, 5)); // show first 5
        if (users.data.length > 5) console.log("... and more");

        // 4. Get attendance logs
        const logs = await zkInstance.getAttendances();
        console.log(`\n--- Attendance Logs (${logs.data.length}) ---`);
        console.log(logs.data.slice(0, 5)); // show first 5
        if (logs.data.length > 5) console.log("... and more");

        // 5. Disconnect
        await zkInstance.disconnect();
        console.log("\n✅ Disconnected safely.");

    } catch (e) {
        console.error("\n❌ Error connecting or pulling data:");
        console.error(e);
        if (e.code === 'EADDRINUSE') {
            console.error("Port already in use. Ensure no other scripts are connected.");
        }
    }
};

testConnection();
