import { createRequire } from 'module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: {
      // @koishijs/loader 的 ESM 构建在 Node 22 下存在默认导出兼容问题，测试环境固定走 CJS 入口
      koishi: require.resolve('koishi')
    }
  }
});
