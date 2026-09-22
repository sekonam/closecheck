import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Membership tests written with `in` against a lookup object, which this codebase has now got
 * wrong twice in one day in two different modules.
 *
 * `in` walks the prototype chain. So `"constructor" in SOME_OBJECT` is true for any plain object,
 * and code that treats `in` as "is this a known key" then indexes the object and gets
 * `Object.prototype.constructor` — a function, which passes a truthiness guard and gets used.
 * It happened in billing (a Stripe-supplied plan name validated against a Prisma enum, which is a
 * plain object) and in the Tier A runner registry (an automation key from template content, which
 * was then CALLED, returning a String where a check result belonged).
 *
 * Both instances had a VARIABLE on the left. Every legitimate use in this codebase has a string
 * LITERAL on the left and is narrowing an `unknown` — `"code" in err` before reading `err.code` —
 * where walking the prototype chain is harmless because nothing is indexed with untrusted input.
 * That distinction is the whole rule and it is mechanically checkable, which is the point:
 * `domain-code-review` already carried this rule in prose when the second instance was written.
 * A written rule only binds the code somebody thought to point it at.
 */
const noInMembershipTest = {
  selector: 'BinaryExpression[operator="in"][left.type!="Literal"]',
  message:
    "`in` with a non-literal left operand walks the prototype chain: 'constructor' and 'toString' " +
    "test true against any plain object, including Prisma's generated enums. Use " +
    "Object.hasOwn(obj, key) for own-property membership, or Object.values(Enum).includes(value) " +
    "to validate against an enum. (String-literal `in` for narrowing an unknown is fine.)",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": ["error", noInMembershipTest],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
