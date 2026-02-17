/**
 * ESLint rule to detect local helper functions in test files
 * that should be imported from source files instead.
 * 
 * This prevents "fake tests" that test local copies instead of actual source code,
 * resulting in 0% coverage for the real implementation.
 */

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow defining helper functions in test files that should be imported from source',
      category: 'Best Practices',
    },
    messages: {
      noLocalHelper: "Function '{{name}}' defined in test file. If this tests source code logic, export it from the source file and import it here. Allowed: mock factories (createMock*, mock*), vi.fn callbacks.",
      noLocalArrowHelper: "Arrow function '{{name}}' defined in test file. If this tests source code logic, export it from the source file and import it here. Allowed: mock factories (createMock*, mock*), vi.fn callbacks.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();
    
    // Only apply to test files
    if (!filename.includes('.test.')) {
      return {};
    }

    // Patterns that are allowed in test files
    const allowedPatterns = [
      /^createMock/,      // Mock factory functions
      /^mock[A-Z]/,       // Mock functions
      /^build.*Mock/,     // Mock builders
      /^fake[A-Z]/,       // Fake data generators
      /^stub[A-Z]/,       // Stubs
      /^spy[A-Z]/,        // Spies
      /^render/,          // Render helpers
      /^setup/,           // Setup functions
      /^cleanup/,         // Cleanup functions
      /^wait/,            // Wait utilities
      /^get.*Element/,    // DOM query helpers
      /^find.*Element/,   // DOM query helpers
      /^query.*Element/,  // DOM query helpers
    ];

    function isAllowedName(name) {
      return allowedPatterns.some(pattern => pattern.test(name));
    }

    function isInsideDescribeOrIt(node) {
      let parent = node.parent;
      while (parent) {
        if (
          parent.type === 'CallExpression' &&
          parent.callee &&
          (parent.callee.name === 'describe' || 
           parent.callee.name === 'it' ||
           parent.callee.name === 'test' ||
           parent.callee.name === 'beforeEach' ||
           parent.callee.name === 'afterEach' ||
           parent.callee.name === 'beforeAll' ||
           parent.callee.name === 'afterAll')
        ) {
          return true;
        }
        parent = parent.parent;
      }
      return false;
    }

    return {
      // Detect: function myHelper() {}
      FunctionDeclaration(node) {
        if (!node.id || !node.id.name) return;
        
        const name = node.id.name;
        
        // Skip allowed patterns
        if (isAllowedName(name)) return;
        
        // Skip if inside describe/it block (inline helpers are sometimes ok)
        if (isInsideDescribeOrIt(node)) return;

        context.report({
          node,
          messageId: 'noLocalHelper',
          data: { name },
        });
      },

      // Detect: const myHelper = () => {} or const myHelper = function() {}
      VariableDeclarator(node) {
        if (!node.id || node.id.type !== 'Identifier') return;
        if (!node.init) return;
        
        const name = node.id.name;
        
        // Skip allowed patterns
        if (isAllowedName(name)) return;
        
        // Only flag arrow functions and function expressions
        const isFunction = 
          node.init.type === 'ArrowFunctionExpression' ||
          node.init.type === 'FunctionExpression';
        
        if (!isFunction) return;
        
        // Skip if inside describe/it block
        if (isInsideDescribeOrIt(node)) return;
        
        // Skip vi.fn() assignments
        if (
          node.init.type === 'CallExpression' &&
          node.init.callee &&
          node.init.callee.type === 'MemberExpression' &&
          node.init.callee.object &&
          node.init.callee.object.name === 'vi'
        ) {
          return;
        }

        context.report({
          node,
          messageId: 'noLocalArrowHelper',
          data: { name },
        });
      },
    };
  },
};
