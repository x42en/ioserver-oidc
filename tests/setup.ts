// Global test setup for ioserver-oidc
beforeAll(() => {
  // Suppress console output during tests unless explicitly needed
  if (process.env["NODE_ENV"] !== "test-verbose") {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  }
});

afterAll(() => {
  vi.restoreAllMocks();
});
