const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// دالة لإنشاء الجداول مرة واحدة إن لم تكن موجودة (بدون مسح البيانات)
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
    console.log("Database tables checked/initialized successfully.");
  } catch (err) {
    console.error("Error initializing database tables:", err);
  }
};

initDb();

// --- 1. TRANSACTIONS ROUTES ---
app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, barber, service_name as "serviceName", short_name as "shortName", price, tip, time FROM transactions ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching transactions:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { id, barber, serviceName, shortName, price, tip, time } = req.body;
    
    const query = `
      INSERT INTO transactions (id, barber, service_name, short_name, price, tip, time)
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING id, barber, service_name as "serviceName", short_name as "shortName", price, tip, time;
    `;
    const values = [
      Number(id) || Date.now(), 
      barber || 'Unknown', 
      serviceName || 'Service', 
      shortName || 'SRV', 
      Number(price) || 0, 
      Number(tip) || 0, 
      time || ''
    ];
    
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error inserting transaction:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/transactions/:id/tip', async (req, res) => {
  try {
    const { id } = req.params;
    const { tip } = req.body;
    const query = `
      UPDATE transactions SET tip = $1 WHERE id = $2 
      RETURNING id, barber, service_name as "serviceName", short_name as "shortName", price, tip, time;
    `;
    const result = await pool.query(query, [Number(tip) || 0, id]);
    res.json(result.rows[0]);
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
    const values = [Number(id) || Date.now(), title || 'Expense', Number(amount) || 0];
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

// --- 3. SETTINGS ROUTES ---
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
    res.status(200).json(result.rows[result.rows.length - 1]);
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
    res.status(200).json({ message: 'Clôture executed successfully!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// المسار المطلوب لتتوافق الواجهة الأمامية تماماً
app.get('/api/cloture/history', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM daily_archives ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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