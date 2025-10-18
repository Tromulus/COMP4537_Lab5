// This code is was written with the help of ChatGPT5

const http = require('http');
const { URL } = require('url');
const querystring = require('querystring');
const mysql = require('mysql2/promise');
const MSG = require('./strings'); // import all user-facing strings

// ------------------------------------------------------------------
// Database connection info (uses Railway MYSQL* or fallback local)
// ------------------------------------------------------------------
const DB_HOST = process.env.MYSQLHOST || process.env.DB_HOST || '127.0.0.1';
const DB_PORT = +(process.env.MYSQLPORT || process.env.DB_PORT || 3306);
const DB_USER = process.env.MYSQLUSER || process.env.DB_USER || 'root';
const DB_PASS = process.env.MYSQLPASSWORD || process.env.DB_PASS || '';
const DB_NAME = process.env.MYSQLDATABASE || process.env.DB_NAME || 'lab5';

let pool; // connection pool (reused for all queries)

// ------------------------------------------------------------------
// Creates database (if allowed) and ensures patient table exists
// ------------------------------------------------------------------
async function initDB() {
  try {
    const bootstrap = await mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASS, port: DB_PORT });
    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await bootstrap.end();
  } catch (_) {
    // ignore if CREATE DATABASE privilege not allowed (e.g. Railway)
  }

  pool = mysql.createPool({ host: DB_HOST, user: DB_USER, password: DB_PASS, database: DB_NAME, port: DB_PORT });

  // create the patient table if missing
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patient (
      patientid INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100),
      dateOfBirth DATETIME
    ) ENGINE=InnoDB;
  `);
}

// ------------------------------------------------------------------
// Utility: read full HTTP body into string
// ------------------------------------------------------------------
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
  });
}

// Simple SQL type detection
const isSelect = s => /^\s*SELECT\b/i.test(s || '');
const isInsert = s => /^\s*INSERT\b/i.test(s || '');

// ------------------------------------------------------------------
// Main HTTP server
// ------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // simple health check route
  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(MSG.OK);
  }

  try {
    // --------------------------------------------------------------
    // GET /sql?q=SELECT%20*%20FROM%20patient
    // Runs SELECT statements only
    // --------------------------------------------------------------
    if (url.pathname.startsWith('/sql') && req.method === 'GET') {
      let sql = url.searchParams.get('q');
      if (!sql) {
        const parts = url.pathname.split('/');
        sql = decodeURIComponent(parts.slice(2).join('/')) || '';
      }
      if (!sql) {
        res.writeHead(400, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ error: MSG.MISSING_SQL }));
      }
      if (!isSelect(sql)) {
        res.writeHead(405, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ error: MSG.ONLY_SELECT_GET }));
      }

      const [rows] = await pool.query(sql);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, rows }));
    }

    // --------------------------------------------------------------
    // POST /sql   (body: {"sql":"INSERT ..."} or sql=... or raw text)
    // Runs INSERT statements only
    // --------------------------------------------------------------
    if (url.pathname === '/sql' && req.method === 'POST') {
      const raw = await readBody(req);
      const ctype = req.headers['content-type'] || '';
      let sql = '';

      if (ctype.includes('application/json')) {
        try { sql = (JSON.parse(raw || '{}').sql || '').trim(); } catch { sql = ''; }
      } else if (ctype.includes('application/x-www-form-urlencoded')) {
        sql = (querystring.parse(raw).sql || '').trim();
      } else {
        sql = (raw || '').trim(); // raw text
      }

      if (!sql) {
        res.writeHead(400, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ error: MSG.MISSING_SQL }));
      }
      if (!isInsert(sql)) {
        res.writeHead(405, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ error: MSG.ONLY_INSERT_POST }));
      }

      const [r] = await pool.query(sql);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, affectedRows: r.affectedRows, insertId: r.insertId || null }));
    }

    // fallback for any other path
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: MSG.NOT_FOUND }));

  } catch (e) {
    // generic error response
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: MSG.SERVER_ERROR }));
  }
});

// ------------------------------------------------------------------
// Start server after DB ready
// ------------------------------------------------------------------
(async () => {
  await initDB();
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => console.log('API running on :' + PORT));
})();
