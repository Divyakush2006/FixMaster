import { test, expect } from '@playwright/test';
import { ADMIN, ELECTRICIAN, STUDENT, SUPERVISOR, signIn, signOut } from '../helpers';

test.describe('sign-in and sessions', () => {
  test('a student signs in; the session is an HttpOnly cookie and no credential reaches page scripts', async ({ page, context }) => {
    await signIn(page, STUDENT);
    await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening), vihaan/i })).toBeVisible();

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'fm_session')!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe('Strict');
    expect(session.path).toBe('/api');
    expect(cookies.find((c) => c.name === 'fm_csrf')!.httpOnly).toBe(false);

    // Page JavaScript cannot see the session, and nothing token-like is stored.
    const visible = await page.evaluate(() => ({
      cookie: document.cookie,
      storage: Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join('\n') + Object.keys(sessionStorage).join(),
    }));
    expect(visible.cookie).not.toContain('fm_session');
    expect(visible.storage).not.toMatch(/eyJ|Bearer|fixmaster_token/);
  });

  test('a reload keeps the session; signing out ends it on the server too', async ({ page, request }) => {
    await signIn(page, STUDENT);
    await page.reload();
    await expect(page).toHaveURL(/\/student$/);

    await signOut(page);
    await page.goto('/student');
    await expect(page).toHaveURL(/\/login/);
    // The cookie is gone from the browser, so the API refuses the browser's next call.
    const res = await page.request.get('/api/me');
    expect(res.status()).toBe(401);
    expect((await request.get('/api/me')).status()).toBe(401);
  });

  test('a wrong password is refused with a clear message and does not leave the sign-in page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/registration number/i).fill(STUDENT.id);
    await page.getByRole('textbox', { name: 'Password' }).fill('definitely-wrong-1');
    await page.getByRole('button', { name: /sign in as student/i }).click();
    await expect(page.getByRole('alert')).toContainText(/ID or password is incorrect/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('each portal only signs in its own accounts', async ({ page }) => {
    // A technician on the student tab is pointed to the right tab, only after the password checked out.
    await page.goto('/login');
    await page.getByLabel(/registration number/i).fill(ELECTRICIAN.id);
    await page.getByRole('textbox', { name: 'Password' }).fill('Password@123');
    await page.getByRole('button', { name: /sign in as student/i }).click();
    await expect(page.getByRole('alert')).toContainText(/staff/i);
    await expect(page.getByRole('button', { name: /use staff sign-in/i })).toBeVisible();

    // An administrator is not known to the public sign-in at all.
    await page.getByRole('button', { name: /use staff sign-in/i }).click();
    await page.getByLabel(/employee id/i).fill(ADMIN.id);
    await page.getByRole('textbox', { name: 'Password' }).fill('Password@123');
    await page.getByRole('button', { name: /sign in as staff/i }).click();
    await expect(page.getByRole('alert')).toContainText(/ID or password is incorrect/i);
  });

  test('role boundaries hold in the browser: a student cannot open supervisor or admin pages', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/supervisor/all-complaints');
    await expect(page).not.toHaveURL(/supervisor/);
    await page.goto('/admin/users');
    await expect(page).not.toHaveURL(/admin\/users/);
  });

  test('supervisor and administrator land on their own home pages', async ({ page }) => {
    await signIn(page, SUPERVISOR);
    await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
    await signOut(page);
    await signIn(page, ADMIN);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
