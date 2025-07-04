// Set up test environment variables
process.env.NODE_ENV = 'test';
// Valid test token format (same as used in working tests)
process.env.MAPBOX_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature';
// JWT secret with sufficient entropy and complexity (generated with openssl rand -base64 64)
process.env.JWT_SECRET =
  '2/vnC6EYfa5fLMIq4kdYLMSQpBQfR3bCz21X4HU8s2/3LMXy37rxnJXGkgk9sbY8urvYmewesJqqN1+NwHTtXQ==';
process.env.LOG_LEVEL = 'error'; // Minimize logging during tests
