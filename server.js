// server.js — minimal, no Express, no CORS
const http = require('http');
const { URL } = require('url');
const mysql = require('mysql2/promise');

// Reads creds from env (set these in Railway Node service)
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || '';
const DB_NAME = process.env.DB_NAME || 'lab5';
const DB_PORT = +(process.env.DB_PORT || 3306);

let pool;

async function initDB() {
  // Create DB if missing (works with Railway internal/public)
    const bootstrap = await mysql.createConnection({ 
        host: DB_HOST, 
        user: DB_USER, 
        password: DB_PASS, 
        port: DB_PORT });
    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await bootstrap.end();

    pool = mysql.createPool({ 
        host: DB_HOST, 
        user: DB_USER, 
        password: DB_PASS, 
        database: DB_NAME, 
        port: DB_PORT });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS patient (
        patientid INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100),
        dateOfBirth DATETIME
        ) ENGINE=InnoDB;
    `);
}

function readBody(req) {
    return new Promise(resolve => {
        let data = '';
        req.on('data', c => data += c);
        req.on('end', () => resolve(data));
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
        if (url.pathname === '/patients' && req.method === 'GET') {
            const [rows] = await pool.query('SELECT * FROM patient ORDER BY patientid');
            res.writeHead(200); return res.end(JSON.stringify(rows));
        }

        if (url.pathname === '/patients' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (!body.name || !body.dateOfBirth) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: 'Missing name or dateOfBirth' }));
        }
        const [r] = await pool.execute(
            'INSERT INTO patient (name, dateOfBirth) VALUES (?, ?)',
            [body.name, body.dateOfBirth]
        );
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true, id: r.insertId }));
        }

        res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
    } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
});

(async () => {
    await initDB();
    const PORT = process.env.PORT || 3001; // Railway sets PORT automatically
    server.listen(PORT, () => console.log('Server on :' + PORT));
})();
