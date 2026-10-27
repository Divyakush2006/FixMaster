import { test, expect } from '@playwright/test';
import { completeOnboarding, studentEmail, uniqueReg } from '../helpers';

// University single sign-on, end to end in a real browser, against the stand-in
// identity provider that e2e/local-stack.js starts (e2e/mock-idp.js). Skipped
// when the stack was started without one (the Docker stack).
test.skip(!process.env.E2E_SSO, 'single sign-on is not configured on this stack');

const PASSWORD = 'Corridor7Lamp!';

test.describe('university single sign-on', () => {
  test('a student signs in through the university page, confirming their mailbox on the way', async ({ page, context }) => {
    // Signed up, but the emailed code is never entered: the university vouches for the mailbox instead.
    const regNo = uniqueReg();
    const res = await page.request.post('/api/auth/student/register', {
      data: { reg_or_emp_id: regNo, full_name: 'E2E Sso Student', email: studentEmail(regNo), phone_number: '9876543210', password: PASSWORD },
    });
    expect(res.status()).toBe(201);

    await page.goto('/login');
    await page.getByRole('link', { name: /sign in with/i }).click();

    // The university's own page.
    await expect(page.getByRole('heading', { name: 'University sign-in' })).toBeVisible();
    await page.getByLabel('University email').fill(studentEmail(regNo));
    await page.getByRole('button', { name: 'Continue' }).click();

    // Back in the app, signed in, and sent to finish the resident profile.
    await expect(page).toHaveURL(/\/onboarding$/);
    const session = (await context.cookies()).find((c) => c.name === 'fm_session')!;
    expect(session.httpOnly).toBe(true);
    await completeOnboarding(page);
    await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening), e2e/i })).toBeVisible();
  });

  test('an address with no FixMaster account is told so, and gets no session', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /sign in with/i }).click();
    await page.getByLabel('University email').fill('nobody.registered@vitstudent.ac.in');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page).toHaveURL(/\/login\?sso=no_account/);
    await expect(page.getByRole('alert')).toContainText(/no FixMaster student account/i);
    expect((await context.cookies()).some((c) => c.name === 'fm_session')).toBe(false);
  });
});
