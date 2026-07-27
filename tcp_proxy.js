const net = require('net');

const server = net.createServer((clientSocket) => {
  const targetSocket = net.createConnection({
    host: '::1',
    port: 8081
  }, () => {
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  targetSocket.on('error', (err) => {
    console.log('Target error:', err.message);
    clientSocket.end();
  });

  clientSocket.on('error', (err) => {
    console.log('Client error:', err.message);
    targetSocket.end();
  });
});

server.listen(8082, '127.0.0.1', () => {
  console.log('TCP Proxy listening on 127.0.0.1:8082 and forwarding to [::1]:8081');
});
