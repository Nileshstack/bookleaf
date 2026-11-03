import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export const connectDB = async () => {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  logger.info('MongoDB connected', { host: mongoose.connection.host });
};

export const disconnectDB = () => {
  // Intentional shutdown: drop the listener so it isn't logged as an outage.
  mongoose.connection.removeAllListeners('disconnected');
  return mongoose.connection.close();
};

// readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
export const isDBConnected = () => mongoose.connection.readyState === 1;
