// api/index.js
require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const axios    = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Carrega variáveis de ambiente
const { FAIR_SECRET_KEY, FAIR_COMPANY_ID, MONGODB_URI } = process.env;
if (!FAIR_SECRET_KEY || !FAIR_COMPANY_ID) {
  console.error('❌ Defina FAIR_SECRET_KEY e FAIR_COMPANY_ID no .env');
  process.exit(1);
}

// (Opcional) Conexão MongoDB
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Erro MongoDB:', err));
}

// Endpoints FairPayments
const API_BASE      = 'https://api.fairpayments.com.br/functions/v1';
const CREATE_TX_URL = `${API_BASE}/transactions`;
const STATUS_TX_URL = id => `${API_BASE}/transactions/${id}`;

// Basic Auth + Company ID
app.use((req, res, next) => {
  const token = Buffer.from(`${FAIR_SECRET_KEY}:x`).toString('base64');
  req.fairHeaders = {
    Authorization:  `Basic ${token}`,
    'x-company-id': FAIR_COMPANY_ID,
    'Content-Type': 'application/json'
  };
  next();
});

app.get('/',    (req, res) => res.json({ ok: true, message: 'root OK' }));
app.get('/api', (req, res) => res.json({ ok: true, message: '/api OK' }));

// 1) Cria transação PIX (pass-through ajustando chaves)
app.post('/api/pix/create', async (req, res) => {
  const {
    client,
    customer,
    products,
    items,
    ...rest
  } = req.body;

  // Determina customer final
  const finalCustomer = customer || client;
  // Mapeia produtos para items se necessário
  const finalItems = items || (products?.map(p => ({
    title:      p.name || p.title,
    unitPrice:  Math.round((p.unitPrice ?? p.amount ?? 0) * 100),
    quantity:   p.quantity || 1,
    externalRef:p.id || p.externalRef
  })) || []);

  const payload = {
    currency:      'BRL',
    paymentMethod: 'PIX',
    ...rest,
    customer: finalCustomer,
    items:    finalItems
  };

  console.log('[API] Criando transação FairPayments:', payload);
  try {
    const { data } = await axios.post(CREATE_TX_URL, payload, { headers: req.fairHeaders });
    console.log('[API] Retorno FairPayments:', data);
    return res.status(201).json({
      transactionId: data.id,
      qrUrl:         data.pix?.qrcode,
      paymentUrl:    data.payment_url || data.paymentUrl,
      pix:           data.pix
    });
  } catch (err) {
    console.error('[API] Erro FairPayments:', err.response?.status, err.response?.data || err.message);
    const status = err.response?.status || 500;
    const body   = err.response?.data   || { message: err.message };
    return res.status(status).json(body);
  }
});

// 2) Consulta status
app.get('/api/pix/status/:id', async (req, res) => {
  try {
    const { data } = await axios.get(STATUS_TX_URL(req.params.id), { headers: req.fairHeaders });
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const body   = err.response?.data   || { message: err.message };
    return res.status(status).json(body);
  }
});

// 3) Webhook PIX
app.post('/api/webhook/pix', (req, res) => {
  const { data } = req.body;
  console.log(`🔔 Webhook FairPayments: tx ${data.id} → ${data.status}`);
  return res.sendStatus(200);
});

module.exports = app;
