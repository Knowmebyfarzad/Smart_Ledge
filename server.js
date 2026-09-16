'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createAuth } = require('./auth-server.js');
const port = Number(process.env.PORT) || 3000;
const auth = createAuth({ port });
const assets = ['index.html', 'styles.css', 'import.css', 'auth.css', 'app.js', 'csv.js', 'import-ui.js', 'auth.js'];
const files = Object.fromEntries(assets.map(file => ['/' + file, file])); files['/'] = 'index.html';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (auth.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname.startsWith('/api/')) { await auth.handle(req, res, pathname); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Method not allowed'); return; }
  const file = files[pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(__dirname, file), (error, data) => {
    if (error) { res.writeHead(500); res.end('Unable to read file'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] }); res.end(req.method === 'HEAD' ? undefined : data);
  });
});
server.requestTimeout = 30000; server.headersTimeout = 15000;
server.listen(port, '127.0.0.1', () => {
  console.log(`Ledger is ready at http://localhost:${port}`);
  if (auth.needsSetup) console.log(`Create your first administrator using the one-time code in ${path.join(auth.dataDir, 'setup-code.txt')}`);
});
function stop() { server.close(() => { auth.close(); process.exit(0); }); server.closeIdleConnections(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
