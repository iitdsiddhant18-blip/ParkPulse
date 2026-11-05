import express from 'express';
import cors from 'cors';
import { pool } from './db';
import { AppError, asyncHandler, errorMiddleware } from './errors';
import { authRouter } from './routes/auth.routes';
import { vehiclesRouter } from './routes/vehicles.routes';
import { lotsRouter } from './routes/lots.routes';
import { favoritesRouter } from './routes/favorites.routes';
import { reviewsRouter } from './routes/reviews.routes';
import { adminRouter } from './routes/admin.routes';
import { reservationsRouter } from './routes/reservations.routes';
import { seriesRouter } from './routes/series.routes';
import { waitlistRouter } from './routes/waitlist.routes';
import { notificationsRouter } from './routes/notifications.routes';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      await pool.execute('SELECT 1 AS ok');
      res.status(200).json({ status: 'ok', db: 'connected' });
    })
  );

  app.use('/api/auth', authRouter);
  app.use('/api/vehicles', vehiclesRouter);
  app.use('/api/lots', lotsRouter);
  app.use('/api/favorites', favoritesRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/api/series', seriesRouter);
  app.use('/api/waitlist', waitlistRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);

  app.use((_req, _res, next) => {
    next(new AppError(404, 'NOT_FOUND', 'Endpoint not found'));
  });

  app.use(errorMiddleware);

  return app;
}
