import mongoose from 'mongoose';

/** Connects this test file to its own database on the shared in-memory server. */
export const connectTestDB = async (name) => {
  await mongoose.connect(process.env.MONGO_TEST_URI, { dbName: `test_${name}` });
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
};

export const closeTestDB = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};
