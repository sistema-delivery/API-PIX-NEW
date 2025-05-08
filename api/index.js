// index.js
require('dotenv').config();
const serverless = require('serverless-http');
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const axios      = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Carrega variáveis de ambiente
const {
  FAIR_SECRET_KEY,
  MONGODB_URI,
  WEBHOOK_BASE_URL
} = process.env;

if (!FAIR_SECRET_KEY) {
  console.error('❌ FAIR_SECRET_KEY não definida.');
  process.exit(1);
}

// Conexão Mongo (opcional)
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Erro conectando ao MongoDB:', err));
}

// Constantes de API FairPayments
const API_BASE         = 'https://api.fairpayments.com.br/functions/v1';
const CREATE_TX_URL    = `${API_BASE}/transactions`;
const STATUS_TX_URL    = (id) => `${API_BASE}/transactions/${id}`;

// Middleware de autenticação Basic Auth
app.use((req, res, next) => {
  const token = Buffer.from(`${FAIR_SECRET_KEY}:x`).toString('base64');
  req.fairHeaders = {
    Authorization: `Basic ${token}`,
    'Content-Type': 'application/json'
  };
  next();
});

// Health-checks
app.get('/',      (req, res) => res.json({ ok: true, message: 'root OK' }));
app.get('/api',   (req, res) => res.json({ ok: true, message: '/api OK' }));

// 1) Cria transação PIX
app.post('/api/pix/create', async (req, res) => {
  const {
    identifier,
    amount,
    client = {},
    products = [],
    splits = [],
    metadata = {},
    callbackUrl
  } = req.body;

  // Converte valor em centavos
  const amountCents = Math.round(amount * 100);

  // Monta payload conforme FairPayments
  const payload = {
    amount:        amountCents,
    paymentMethod: 'PIX',
    description:   `Pedido ${identifier || Date.now()}`,
    customer: {
      name:  client.name,
      email: client.email,
      phone: client.phone
    },
    items: products.map(p => ({
      title:       p.name,
      unitPrice:   Math.round((p.unitPrice || p.amount) * 100),
      quantity:    p.quantity || 1,
      externalRef: p.id || undefined
    })),
    splits: splits.map(s => ({
      recipientId: s.recipientId,
      percentage:  s.percentage
    })),
    metadata,
    postbackUrl: callbackUrl && /^https?:\/\//.test(callbackUrl)
      ? callbackUrl
      : WEBHOOK_BASE_URL
        ? `${WEBHOOK_BASE_URL.replace(/\/+$/, '')}/api/webhook/pix`
        : undefined
  };

  console.log('[API] Criando transação FairPayments:', CREATE_TX_URL, payload);
  try {
    const { data, status } = await axios.post(
      CREATE_TX_URL,
      payload,
      { headers: req.fairHeaders }
    );
    console.log('[API] FairPayments retornou:', status, data);

    const transactionId = data.id;
    const qrUrl         = data.pix?.qrcode;
    const paymentUrl    = data.payment_url;

    return res.status(201).json({ transactionId, qrUrl, paymentUrl });
  } catch (err) {
    console.error('[API] Erro criando transação:', err.response?.status, err.response?.data || err.message);
    const code = err.response?.status || 500;
    const body = err.response?.data   || { message: err.message };
    return res.status(code).json(body);
  }
});

// 2) Consulta status da transação
app.get('/api/pix/status/:id', async (req, res) => {
  const { id } = req.params;
  const url = STATUS_TX_URL(id);

  console.log('[API] Consultando status em', url);
  try {
    const { data } = await axios.get(url, { headers: req.fairHeaders });
    console.log('[API] Status encontrado:', data);
    return res.json(data);
  } catch (err) {
    console.error('[API] Erro consultando status:', err.response?.status, err.response?.data);
    return res.status(err.response?.status || 500).json(err.response?.data || { message: err.message });
  }
});

// 3) Webhook PIX
app.post('/api/webhook/pix', (req, res) => {
  const { data } = req.body;
  const transactionId = data.id;
  const status        = data.status;
  console.log(`🔔 FairPayments Webhook: ${transactionId} -> ${status}`);
  // Aqui você pode atualizar o MongoDB ou notificar o bot
  return res.status(200).send('OK');
});

// Export para Vercel
app.listen(3000, () => console.log('Rodando local em :3000'));
module.exports = app;
module.exports.handler = serverless(app);
