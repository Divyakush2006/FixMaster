import { test, expect } from '@playwright/test';
import { studentEmail, uniqueReg, waitForMail } from '../helpers';

// Forgotten password, end to end in a real browser: ask for a link, receive the email
// (the local stack's mail catcher stands in for the university mailbox), choose a new
// password, sign in with it. The link works once.

const OLD_PASSWORD = 'Corridor7Lamp!';
const NEW_PASSWORD = 'Lantern9Harbour!';

test.describe('password reset by email', () => {
  test('a student who forgot their password gets a one-time link and signs in with the new one', async ({ page }) => {
    const regNo = uniqueReg();
    const email = studentEmail(regNo);
    const created = await page.request.post('/api/auth/student/register', {
      data: { reg_or_emp_id: regNo, full_name: 'E2E Forgetful', email, phone_number: '9876543210', password: OLD_PASSWORD },
    });
    expect(created.status()).toBe(201);
    const signupMail = await waitForMail(email, /verification code/i);
    const verified = await page.request.post('/api/auth/student/verify-email', {
      data: { reg_or_emp_id: regNo, code: signupMail.Text.match(/code is (\d{6})/)![1] },
    });
    expect(verified.status()).toBe(200);

    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await page.getByLabel(/registration number or employee id/i).fill(regNo);
    await page.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(page.getByText(/check your spam folder/i)).toBeVisible();

    const mail = await waitForMail(email, /reset your fixmaster password/i);
    const link = mail.Text.match(/https?:\/\/\S+\/reset-password#token=\S+/)![0];
    await page.goto(link);
    await page.getByLabel(/^New password\s*\*?$/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Confirm new password\s*\*?$/).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The old password is dead, the new one works.
    const old = await page.request.post('/api/auth/student/login', { data: { reg_or_emp_id: regNo, password: OLD_PASSWORD } });
    expect(old.status()).toBe(401);
    await page.getByLabel(/registration number/i).fill(regNo);
    await page.getByRole('textbox', { name: 'Password' }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: /sign in as student/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/);

    // The same link cannot be used a second time.
    await page.goto(link);
    await page.getByLabel(/^New password\s*\*?$/).fill('Another8Passphrase!');
    await page.getByLabel(/^Confirm new password\s*\*?$/).fill('Another8Passphrase!');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert')).toContainText(/invalid or has expired/i);
  });

  test('asking for a reset for an account that does not exist reveals nothing', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel(/registration number or employee id/i).fill('99ZZZ9999');
    await page.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(page.getByText(/check your spam folder/i)).toBeVisible();
  });
});
