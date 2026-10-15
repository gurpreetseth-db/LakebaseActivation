import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    passWithNoTests: true,
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/.databricks/**'],
    // Test fixtures for the deployment settings that databricks.yml exports to the app at runtime.
    env: {
      LAKEBASE_ENABLED: 'true',
      LAKEBASE_PROJECT: 'projects/test-project',
      LAKEBASE_BRANCH: 'projects/test-project/branches/production',
      LAKEBASE_DATABASE: 'projects/test-project/branches/production/databases/test-db',
      LAKEBASE_ENDPOINT: 'projects/test-project/branches/production/endpoints/primary',
      LAKEBASE_SCHEMA: 'partner_activation',
      ADMIN_EMAILS: 'admin@example.com',
      AI_ENDPOINT_NAME: 'test-llm-endpoint',
      AI_EMBEDDING_ENDPOINT: 'test-embedding-endpoint',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
    },
  },
});
