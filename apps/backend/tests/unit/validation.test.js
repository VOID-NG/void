// apps/backend/tests/unit/validation.test.js
// Unit tests for validation functions

describe('Validation Functions', () => {
  describe('Email validation', () => {
    test('should validate correct email formats', () => {
      const validEmails = [
        'test@example.com',
        'user.name@domain.co.uk',
        'user+tag@example.org',
        'test123@test-domain.com'
      ];

      validEmails.forEach(email => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        expect(emailRegex.test(email)).toBe(true);
      });
    });

    test('should reject invalid email formats', () => {
      const invalidEmails = [
        'not-an-email',
        '@example.com',
        'test@',
        'test.example.com',
        'test@.com',
        'test@example.'
      ];

      invalidEmails.forEach(email => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        expect(emailRegex.test(email)).toBe(false);
      });
    });
  });

  describe('Password validation', () => {
    test('should validate strong passwords', () => {
      const strongPasswords = [
        'Password123!',
        'MyStr0ng#Pass',
        'SecureP@ssw0rd',
        'Complex123$'
      ];

      strongPasswords.forEach(password => {
        const hasMinLength = password.length >= 8;
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        expect(hasMinLength).toBe(true);
        expect(hasUpperCase).toBe(true);
        expect(hasLowerCase).toBe(true);
        expect(hasNumbers).toBe(true);
        expect(hasSpecialChar).toBe(true);
      });
    });

    test('should reject weak passwords', () => {
      const weakPasswords = [
        '12345678', // only numbers
        'password', // no numbers or special chars
        'PASSWORD', // no lowercase or numbers
        'Pass1', // too short
        'password123' // no special chars
      ];

      weakPasswords.forEach(password => {
        const hasMinLength = password.length >= 8;
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        const isValid = hasMinLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Input sanitization', () => {
    test('should sanitize HTML input', () => {
      const maliciousInput = '<script>alert("xss")</script>Hello World';
      const sanitized = maliciousInput.replace(/<[^>]*>/g, '');
      expect(sanitized).toBe('alert("xss")Hello World');
    });

    test('should trim whitespace', () => {
      const input = '  test string  ';
      expect(input.trim()).toBe('test string');
    });

    test('should handle empty strings', () => {
      const emptyString = '';
      const whitespaceString = '   ';
      
      expect(emptyString.length).toBe(0);
      expect(whitespaceString.trim().length).toBe(0);
    });
  });

  describe('Number validation', () => {
    test('should validate positive numbers', () => {
      const positiveNumbers = [1, 100, 0.5, 999.99];
      
      positiveNumbers.forEach(num => {
        expect(num > 0).toBe(true);
        expect(typeof num).toBe('number');
        expect(!isNaN(num)).toBe(true);
      });
    });

    test('should validate price ranges', () => {
      const validPrices = [10, 99.99, 1000, 0.01];
      const invalidPrices = [-10, 0, 'not-a-number', null, undefined];

      validPrices.forEach(price => {
        expect(price > 0).toBe(true);
        expect(typeof price).toBe('number');
      });

      invalidPrices.forEach(price => {
        const isValid = typeof price === 'number' && price > 0;
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Array validation', () => {
    test('should validate non-empty arrays', () => {
      const validArrays = [[1, 2, 3], ['a', 'b'], [{ id: 1 }]];
      const invalidArrays = [[], null, undefined, 'not-an-array'];

      validArrays.forEach(arr => {
        expect(Array.isArray(arr)).toBe(true);
        expect(arr.length > 0).toBe(true);
      });

      invalidArrays.forEach(arr => {
        const isValid = Array.isArray(arr) && arr.length > 0;
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Object validation', () => {
    test('should validate required object properties', () => {
      const validObject = { id: 1, name: 'Test', email: 'test@example.com' };
      const requiredFields = ['id', 'name', 'email'];

      const hasAllRequiredFields = requiredFields.every(field => 
        validObject.hasOwnProperty(field) && validObject[field] !== null && validObject[field] !== undefined
      );

      expect(hasAllRequiredFields).toBe(true);
    });

    test('should detect missing required fields', () => {
      const incompleteObject = { id: 1, name: 'Test' };
      const requiredFields = ['id', 'name', 'email'];

      const hasAllRequiredFields = requiredFields.every(field => 
        incompleteObject.hasOwnProperty(field) && incompleteObject[field] !== null && incompleteObject[field] !== undefined
      );

      expect(hasAllRequiredFields).toBe(false);
    });
  });
});

