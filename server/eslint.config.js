const globals = require("globals");

module.exports = [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": "off",
      "prefer-const": "warn",
      eqeqeq: ["error", "always"],
    },
  },
  {
    ignores: ["node_modules/", "sample/", "changes.log"],
  },
];
