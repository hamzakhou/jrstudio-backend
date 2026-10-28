const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// إنشاء الجداول تلقائياً عند تشغيل السيرفر إن لم تكن موجودة
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id BIGINT PRIMARY KEY,
        barber VARCHAR(100) NOT NULL,
        service_name VARCHAR(255) NOT NULL,
        short_name VARCHAR(50) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        tip NUMERIC(10, 2) DEFAULT 0,
        time VARCHAR(50) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id BIGINT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        amount NUMERIC(10, 2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS daily_archives (
        id SERIAL PRIMARY KEY,
        date VARCHAR(50) UNIQUE NOT NULL,
        total_services NUMERIC(10, 2) NOT NULL,
        yesterday_caisse NUMERIC(10, 2) NOT NULL,
        total_caisse_brut NUMERIC(10, 2) NOT NULL,
        total_barbers_pay NUMERIC(10, 2) NOT NULL,
        total_expenses NUMERIC(10, 2) NOT NULL,
        laisse_net NUMERIC(10, 2) NOT NULL
      );
    `);
    console.log("Database tables initialized successfully.");
  } catch (err) {
    console.error("Error initializing database tables:", err);
  }
};

initDb();

// --- 1. TRANSACTIONS ROUTES ---
app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { id, barber, serviceName, shortName, price, tip, time } = req.body;
    const query = `
      INSERT INTO transactions (id, barber, service_name, short_name, price, tip, time)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
    `;
    const values = [id, barber, serviceName, shortName, price, tip || 0, time];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM transactions WHERE id = $1', [id]);
    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 2. EXPENSES ROUTES ---
app.get('/api/expenses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { id, title, amount }  = req.body;
    const query = `
      INSERT INTO expenses (id, title, amount)
      VALUES ($1, $2, $3) RETURNING *;
    `;
    const values = [id, title, amount];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 3. SETTINGS (Yesterday Caisse) ROUTES ---
app.get('/api/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    res.json({ value: result.rows[0] ? result.rows[0].value : '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    const query = `
      INSERT INTO settings (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $2 RETURNING *;
    `;
    const result = await pool.query(query, [key, value]);
    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 4. DAILY ARCHIVE / CLÔTURE ROUTE ---
app.post('/api/cloture', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { date, totalServices, yesterdayCaisse, totalCaisseBrut, totalBarbersPay, totalExpenses, laisseNet } = req.body;

    const archiveQuery = `
      INSERT INTO daily_archives (date, total_services, yesterday_caisse, total_caisse_brut, total_barbers_pay, total_expenses, laisse_net)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (date) DO UPDATE SET 
        total_services = $2, yesterday_caisse = $3, total_caisse_brut = $4, total_barbers_pay = $5, total_expenses = $6, laisse_net = $7
      RETURNING *;
    `;
    const archiveValues = [date, totalServices, yesterdayCaisse, totalCaisseBrut, totalBarbersPay, totalExpenses, laisseNet];
    await client.query(archiveQuery, archiveValues);

    const updateSettingsQuery = `
      INSERT INTO settings (key, value) VALUES ('yesterday_caisse', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1;
    `;
    await client.query(updateSettingsQuery, [laisseNet.toString()]);

    await client.query('DELETE FROM transactions');
    await client.query('DELETE FROM expenses');

    await client.query('COMMIT');
    res.status(200).json({ message: 'Clôture executed successfully! Day archived and reset.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/archives', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM daily_archives ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});