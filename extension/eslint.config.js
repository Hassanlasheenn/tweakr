import globals from "globals";

export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        chrome: "readonly",
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
    files: ["background.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        chrome: "readonly",
      },
    },
  },
  {
    ignores: ["node_modules/", "*.png"],
  },
];
