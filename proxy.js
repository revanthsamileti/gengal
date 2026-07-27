const net = require('net');
const proxy = net.createServer((socket) => {
  const client = net.createConnection({ port: 8081, host: '::1' }, () => {
    socket.pipe(client);
    client.pipe(socket);
  });
  client.on('error', (err) => console.error('Proxy error:', err));
  socket.on('error', (err) => console.error('Socket error:', err));
});
proxy.listen(8082, '127.0.0.1', () => console.log('IPv4 to IPv6 Proxy listening on 127.0.0.1:8082'));
