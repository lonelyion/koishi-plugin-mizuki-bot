import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';


/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ['**/*.{js,mjs,cjs,ts}'] },
  { languageOptions: { globals: globals.node } },

  {
    rules: {
      semi: ['error', 'always'], // 强制分号
      quotes: ['error', 'single'], // 强制单引号
      indent: ['error', 2], // 使用 2 空格缩进
      'comma-dangle': ['error', 'never'], // 禁止尾随逗号
      'object-curly-spacing': ['error', 'always'], // 对象花括号中加空格
      'prefer-const': 'error', // 建议优先使用 const
      'no-var': 'error', // 禁止使用 var
      eqeqeq: ['error', 'always'], // 强制使用 === 和 !==
      'key-spacing': ['error', { beforeColon: false, afterColon: true }], // 对齐对象键值
      'space-before-function-paren': ['error', {
        'anonymous': 'always',
        'named': 'never',
        'asyncArrow': 'always'
      }],
      '@typescript-eslint/no-unused-vars': ['warn'], // 警告未使用的变量
      '@typescript-eslint/explicit-function-return-type': 'off', // 不强制声明函数返回类型
      '@typescript-eslint/no-explicit-any': 'warn' // 警告使用 any 类型
    }
  },

  pluginJs.configs.recommended,
  ...tseslint.configs.recommended


];