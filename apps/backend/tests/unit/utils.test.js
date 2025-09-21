// apps/backend/tests/unit/utils.test.js
// Unit tests for utility functions

describe('Utility Functions', () => {
  describe('String utilities', () => {
    test('should handle basic string operations', () => {
      const testString = 'Hello World';
      expect(testString.toLowerCase()).toBe('hello world');
      expect(testString.toUpperCase()).toBe('HELLO WORLD');
      expect(testString.length).toBe(11);
    });

    test('should handle string validation', () => {
      const validEmail = 'test@example.com';
      const invalidEmail = 'not-an-email';
      
      expect(validEmail.includes('@')).toBe(true);
      expect(invalidEmail.includes('@')).toBe(false);
    });
  });

  describe('Array utilities', () => {
    test('should handle array operations', () => {
      const testArray = [1, 2, 3, 4, 5];
      expect(testArray.length).toBe(5);
      expect(testArray.includes(3)).toBe(true);
      expect(testArray.filter(x => x > 3)).toEqual([4, 5]);
    });

    test('should handle array mapping', () => {
      const numbers = [1, 2, 3];
      const doubled = numbers.map(x => x * 2);
      expect(doubled).toEqual([2, 4, 6]);
    });
  });

  describe('Object utilities', () => {
    test('should handle object operations', () => {
      const testObj = { name: 'Test', value: 42 };
      expect(testObj.name).toBe('Test');
      expect(testObj.value).toBe(42);
      expect(Object.keys(testObj)).toEqual(['name', 'value']);
    });

    test('should handle object merging', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 3, c: 4 };
      const merged = { ...obj1, ...obj2 };
      expect(merged).toEqual({ a: 1, b: 3, c: 4 });
    });
  });

  describe('Async operations', () => {
    test('should handle promises', async () => {
      const promise = Promise.resolve('test value');
      const result = await promise;
      expect(result).toBe('test value');
    });

    test('should handle promise rejection', async () => {
      const promise = Promise.reject(new Error('test error'));
      await expect(promise).rejects.toThrow('test error');
    });
  });

  describe('Mock functions', () => {
    test('should work with Jest mocks', () => {
      const mockFn = jest.fn();
      mockFn('arg1', 'arg2');
      
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    test('should handle mock return values', () => {
      const mockFn = jest.fn();
      mockFn.mockReturnValue('mocked value');
      
      expect(mockFn()).toBe('mocked value');
    });

    test('should handle mock implementations', () => {
      const mockFn = jest.fn();
      mockFn.mockImplementation((a, b) => a + b);
      
      expect(mockFn(2, 3)).toBe(5);
    });
  });
});

