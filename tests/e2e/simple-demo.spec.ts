import { test, expect } from '@playwright/test';

test.describe('Simple API Health Check', () => {
  test('backend health check passes', async ({ request }) => {
    const response = await request.get('http://localhost:24187/healthz');
    expect(response.status()).toBe(200);
    
    const health = await response.json();
    expect(health.status).toBe('ok');
  });

  test('dashboard is accessible', async ({ request }) => {
    const response = await request.get('http://localhost:24187/dashboard/');
    expect(response.status()).toBe(200);
  });
});