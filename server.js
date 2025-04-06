// server.js
require('dotenv').config();
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

app.use(cors());
app.use(express.json());

app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    res.status(400).send({ error: { message: error.message } });
  }
});

app.listen(4242, () => console.log('Stripe server running on port 4242'));
const cron = require('node-cron');
const checkVIPStatus = require('./vipCheck');

// Her gün gece 00:00'da çalışır
cron.schedule('0 0 * * *', () => {
  console.log('⏰ VIP kontrolü başlatılıyor...');
  checkVIPStatus();
});
