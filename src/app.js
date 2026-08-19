const express= require('express');
const cors= require('cors');
const cookieParser= require('cookie-parser');
const healthRoutes= require('./routes/health.routes');
const authRoutes= require('./routes/auth.routes');
const errorMiddleware= require('./middleware/error.middleware');
const walletRoutes = require("./routes/wallet.routes");
const merchantRoutes = require("./routes/merchant.routes");
const paymentIntentRoutes = require("./routes/payment-intent.routes");
const app= express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use("/api/merchants", merchantRoutes);
app.use("/api/payment-intents", paymentIntentRoutes);

app.use(errorMiddleware);
module.exports= app;