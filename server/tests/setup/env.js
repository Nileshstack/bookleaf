// Runs before each test file's imports. dotenv never overrides variables that
// are already set, so these win over a developer's server/.env, and tests
// can never touch the real Atlas database or call OpenAI.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGO_TEST_URI;
process.env.JWT_SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
process.env.JWT_EXPIRES_IN = '1h';
process.env.OPENAI_API_KEY = '';
process.env.CLIENT_URL = 'http://localhost:3000';
