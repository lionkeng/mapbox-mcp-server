# Bash commands

- npm run build: Build the project
- npx tsc --noEmit: Run the typechecker

# Code style

- Use ES modules (import/export) syntax, not CommonJS (require)
- Destructure imports when possible (eg. import { foo } from 'bar')

# TypeScript Type Checking

**Automatically Enforced (tsconfig.json):**

- <!-- ❌ `"strict": true` - All strict type checking enabled (disabled for legacy code compatibility) -->
- <!-- ❌ `"noUncheckedIndexedAccess": true` - Array/object access safety (disabled for legacy code compatibility) -->
- <!-- ❌ `"exactOptionalPropertyTypes": true` - Strict optional properties (disabled for legacy code compatibility) -->
- <!-- ❌ `"noImplicitReturns": true` - All code paths must return (disabled for legacy code compatibility) -->
- <!-- ❌ `"noImplicitOverride": true` - Explicit override declarations (disabled for legacy code compatibility) -->
- <!-- ❌ `"noUnusedLocals": true` - No unused variables (disabled for legacy code compatibility) -->
- <!-- ❌ `"noUnusedParameters": true` - No unused function parameters (disabled for legacy code compatibility) -->
- DO NOT modify tsconfig.json
- DO NOT modify eslint.config.mjs

**Automatically Enforced (ESLint):**

- ✅ `@typescript-eslint/no-explicit-any` - Warns about `any` usage
- ✅ `@typescript-eslint/prefer-as-const` - Prefer const assertions
- <!-- ❌ `@typescript-eslint/no-unused-vars` - Warns about unused variables (disabled for legacy code compatibility) -->

**Manual Best Practices:**

- Add explicit type annotations to function parameters, return values, and class properties
- Use `unknown` instead of `any` for values with uncertain types
- Use union types (e.g., `string | null`) instead of `any` when possible
- Type guard caught errors: `if (err instanceof Error)`
- Use primitive types (`number`, `string`, `boolean`) not wrapper types (`Number`, `String`, `Boolean`)
- Leverage utility types: `Partial<T>`, `Readonly<T>`, `Pick<T>`, `Omit<T>`
- Run `npx tsc --noEmit` frequently during development to catch type errors early

# Legacy Code Compatibility

Some strict TypeScript rules have been relaxed to accommodate existing code from the original repository:

- Unused variables/parameters are allowed to avoid modifying original files
- Array access and optional property checking is relaxed for existing patterns
- This ensures clean PR process while maintaining type safety for new development

# Workflow

- Be sure to typecheck when you’re done making a series of code changes
- Prefer running single tests, and not the whole test suite, for performance
