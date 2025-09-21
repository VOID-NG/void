// apps/backend/tests/unit/simple.test.js
// Simple unit tests to verify test setup

describe('Test Setup Verification', () => {
  test('should run basic test', () => {
    expect(1 + 1).toBe(2);
  });

  test('should have access to Jest globals', () => {
    expect(jest).toBeDefined();
    expect(expect).toBeDefined();
  });

  test('should be able to use mocks', () => {
    const mockFn = jest.fn();
    mockFn('test');
    expect(mockFn).toHaveBeenCalledWith('test');
  });

  test('should have test helpers available', () => {
    expect(global.testHelpers).toBeDefined();
  });
});

describe('Environment Setup', () => {
  test('should have NODE_ENV set to test', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  test('should have JWT_SECRET set', () => {
    expect(process.env.JWT_SECRET).toBeDefined();
  });
});

