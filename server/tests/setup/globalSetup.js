import { MongoMemoryServer } from 'mongodb-memory-server';

export default async function globalSetup() {
  const mongod = await MongoMemoryServer.create();
  globalThis.__MONGOD__ = mongod;
  // Read by tests/setup/env.js in every worker (workers inherit process.env).
  process.env.MONGO_TEST_URI = mongod.getUri();
}
