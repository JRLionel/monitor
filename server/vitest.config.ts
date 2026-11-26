import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 避免 tsc 产物中的测试文件被重复执行
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
