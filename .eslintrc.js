module.exports = {
    root: true,
    // Specifies the ESLint parser
    parser: '@typescript-eslint/parser',
    extends: [
        // Uses the recommended rules from @typescript-eslint/eslint-plugin
        'plugin:@typescript-eslint/recommended',
        'prettier',
    ],
    parserOptions: {
        ecmaVersion: 2022,    // Allows for the parsing of modern ECMAScript features
        sourceType: 'module', // Allows for the use of imports
    },
    rules: {
        // Place to specify ESLint rules. Can be used to overwrite rules specified from the extended configs
        // e.g. "@typescript-eslint/explicit-function-return-type": "off",
    },
    settings: {},
};
