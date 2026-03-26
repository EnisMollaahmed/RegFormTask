/**
 * MySQL connection pool using mysql2/promise
 * Usage:
 *   const db = require('./db');
 *   const rows = await db.query('SELECT * FROM users WHERE id = ?', [id]);
 */

const mysql = require('mysql2/promise');

const {
  DB_HOST = 'localhost',
  DB_USER = 'node_user',
  DB_PASSWORD = 'password123',
  DB_NAME = 'registration_app',
  DB_PORT = 3306,
  DB_CONNECTION_LIMIT = 10
} = process.env;

const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: Number(DB_PORT),
  waitForConnections: true,
  connectionLimit: Number(DB_CONNECTION_LIMIT),
  namedPlaceholders: true,
  timezone: 'Z',
  decimalNumbers: true
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { pool, query };
