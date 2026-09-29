const path = require('path');
const express = require('express');
const cors = require('cors');
const { PORT, ALLOWED_ORIGINS } = require('./src/config');
const { errorMiddleware } = require('./src/utils/errors');
const { sweepTempDir } = require('./src/utils/tempFiles');
const { apiLimiter } = require('./src/middleware/rateLimit');
const searchRoutes = require('./src/routes/search');
const trackRoutes = require('./src/routes/tracks');
const workspaceRoutes = require('./src/routes/workspace');
const distanceRoutes = require('./src/routes/distances');
const lookupRoutes = require('./src/routes/lookup');
const graphRoutes = require('./src/routes/graph');

sweepTempDir();

const app = express();
app.use(express.json());
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  allowedHeaders: ['Content-Type', 'X-Device-Id'],
}));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/api', apiLimiter);

app.use('/api/search', searchRoutes);
app.use('/api/tracks', trackRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/distances', distanceRoutes);
app.use('/api/lookup', lookupRoutes);
app.use('/api/graph', graphRoutes);

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`NearfieldSpace backend listening on http://localhost:${PORT}`);
});
