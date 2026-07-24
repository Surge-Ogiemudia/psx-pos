const net = require('net');
const https = require('https');

const PORT = 80;
const TARGET_HOST = 'pos.psx.ng';

const server = net.createServer((socket) => {
  console.log(`\n[TCP] Connection from ${socket.remoteAddress}:${socket.remotePort}`);

  let buffer = Buffer.alloc(0);

  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    console.log(`[TCP] Received ${data.length} bytes. Total: ${buffer.length}`);
    console.log(`[RAW HEX]`, data.toString('hex'));
    console.log(`[RAW ASCII]`, data.toString('ascii'));

    // Try to see if it's HTTP
    const str = buffer.toString('utf8');
    if (str.includes('\r\n\r\n')) {
      console.log(`[TCP] Reached end of HTTP headers. Forwarding to Vercel...`);
      const lines = str.split('\r\n');
      const firstLine = lines[0];
      const [method, path, protocol] = firstLine.split(' ');
      
      console.log(`[PARSED] ${method} ${path}`);
      
      // We will just drop the connection for now to see what it sent.
      // But let's actually respond with OK just to see if it likes it
      socket.write('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK');
      socket.destroy();
    }
  });

  socket.on('error', (err) => {
    console.error(`[TCP] Error: ${err.message}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
==================================================
🚀 ZKTECO RAW TCP ANALYZER IS RUNNING!
==================================================
Listening on: port ${PORT}
`);
});
