const express= require('express');
const cors= require('cors');
const cookieParser= require('cookie-parser');
const healthRoutes= require('./routes/health.routes');
const authRoutes= require('./routes/auth.routes');
const errorMiddleware= require('./middleware/error.middleware');
const app= express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);

app.use(errorMiddleware);
module.exports= app;