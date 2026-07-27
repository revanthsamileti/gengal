const net = require('net');

const server = net.createServer((clientSocket) => {
  console.log('New client connection');
  const targetSocket = net.createConnection({
    host: '::1',
    port: 8081
  }, () => {
    console.log('Connected to target [::1]:8081');
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  clientSocket.on('data', (d) => console.log('Client->Target:\n' + d.toString('utf8')));
  targetSocket.on('data', (d) => console.log('Target->Client:\n' + d.toString('utf8')));
  
  targetSocket.on('end', () => console.log('Target closed connection (EOF)'));
  targetSocket.on('close', () => console.log('Target socket closed'));
  targetSocket.on('error', (err) => console.log('Target error:', err.message));

  clientSocket.on('end', () => console.log('Client closed connection (EOF)'));
  clientSocket.on('close', () => console.log('Client socket closed'));
  clientSocket.on('error', (err) => console.log('Client error:', err.message));
});

server.listen(8082, '127.0.0.1', () => {
  console.log('Verbose TCP Proxy listening on 127.0.0.1:8082');
});
