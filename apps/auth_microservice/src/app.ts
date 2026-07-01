import express from 'express';
import cors from 'cors';

const app = express();

// Global middlewares
app.use(express.json());
app.use(cors());

// Routes and error handler will be added in Phase 3

export default app;
