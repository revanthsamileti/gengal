const httpProxy = require('http-proxy');

const proxy = httpProxy.createProxyServer({
  target: 'http://[::1]:8081',
  ws: true,
});

proxy.on('error', (err, req, res) => {
  console.log('Proxy error:', err.message);
  if (res && res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  }
});

proxy.listen(8082, '127.0.0.1', () => {
  console.log('Robust HTTP Proxy started on 127.0.0.1:8082');
});
