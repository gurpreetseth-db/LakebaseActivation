import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Application, NextFunction, Request, Response } from 'express';
import { WorkspaceClient } from '@databricks/sdk-experimental';

// Optional usage tracking (dbdemos-tracker). Reports an APP-VIEW event on page loads so the asset's
// owners can see usage. Fire-and-forget: it never delays or breaks a request. Disable with
// DBDEMOS_TRACKER_DISABLED=1.
const DEMO_NAME = 'lakebase-partner-readiness-hub-6372';
const ENDPOINT = 'https://ppxrzfxige.execute-api.us-west-2.amazonaws.com/v1/analytics';
const TIMEOUT_MS = 2000;

let workspaceId: Promise<string | undefined> | undefined;

function getWorkspaceId(): Promise<string | undefined> {
  workspaceId ??= (async () => {
    if (process.env.DATABRICKS_WORKSPACE_ID) return process.env.DATABRICKS_WORKSPACE_ID;
    const res = await new WorkspaceClient({}).apiClient.request({
      path: '/api/2.0/preview/scim/v2/Me',
      method: 'GET',
      headers: new Headers(),
      raw: false,
      query: {},
      responseHeaders: ['x-databricks-org-id'],
    });
    const id = (res as { 'x-databricks-org-id'?: string[] })['x-databricks-org-id']?.[0];
    return id || undefined;
  })().catch(() => {
    workspaceId = undefined; // retry on the next page load
    return undefined;
  });
  return workspaceId;
}

async function sendView(appPath: string, email: string | undefined): Promise<void> {
  const orgId = await getWorkspaceId();
  if (!orgId) return;
  const payload: Record<string, string> = {
    category: 'demo-app',
    event: 'APP-VIEW',
    version: '1',
    demo_name: DEMO_NAME,
    org_id: orgId,
    path: `/_dbdemos/demo-app/${DEMO_NAME}`,
    app_path: appPath,
  };
  // Only Databricks users are reported, and only as a hash; any other email is never sent.
  if (email && email.toLowerCase().endsWith('@databricks.com')) {
    payload.user_hash = createHash('sha256').update(email).digest('hex');
  }
  await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Registers page-load tracking. Call before the static/SPA handler so page loads are seen. */
export function registerTracker(app: Application): void {
  if (process.env.DBDEMOS_TRACKER_DISABLED === '1') return;
  try {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      next();
      try {
        // Page loads only: not the API, and not static assets (anything with a file extension).
        if (req.method !== 'GET' || req.path.startsWith('/api') || path.extname(req.path)) return;
        void sendView(req.path, req.header('x-forwarded-email')).catch(() => {});
      } catch {
        // tracking must never affect the request
      }
    });
  } catch (err) {
    console.warn(`[tracker] disabled: ${(err as Error).message}`);
  }
}
