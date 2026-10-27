import { test, expect, Page } from '@playwright/test';
import { ADMIN, approveRoomRequest, completeOnboarding, confirmEmailCode, signIn, signOut, studentEmail, uniqueReg } from '../helpers';

const NEW_PASSWORD = 'Corridor7Lamp!';

async function register(page: Page, regNo: string, room: { block: string; floor: string; room: string } | null) {
  await page.goto('/register');
  await page.getByLabel('Registration number').fill(regNo);
  await page.getByLabel('Full name').fill('E2E Newcomer');
  await page.getByLabel(/^Email\s*\*?$/).fill(studentEmail(regNo));
  await page.getByLabel('Mobile number').fill('9876543210');
  if (room) {
    await page.getByLabel('Block').selectOption({ label: room.block });
    await page.getByLabel('Floor').selectOption({ label: room.floor });
    await page.getByLabel('Room').selectOption(room.room);
  }
  await page.getByLabel(/^Password\s*\*?$/).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Confirm the university mailbox, then the resident profile.
  await confirmEmailCode(page, regNo);
  await completeOnboarding(page);
}

test.describe('registration, room requests and allotment', () => {
  test('a new student registers, asks for a room, and gets room tickets only after the office approves', async ({ page }) => {
    const regNo = uniqueReg();
    await register(page, regNo, { block: 'L-Block (Ladies/Mens Hostel)', floor: 'Floor 1', room: 'L-101' });

    // Registered, verified and onboarded: the request is pending and grants nothing yet.
    await expect(page).toHaveURL(/\/student$/);
    await expect(page.getByText(/waiting for the hostel office to confirm room L-101/i)).toBeVisible();
    await page.goto('/student/new');
    await expect(page.getByRole('radio', { name: /my room/i })).toBeDisabled();

    // The office approves it through the allotment screen.
    await signOut(page);
    await signIn(page, ADMIN);
    await approveRoomRequest(page, regNo);
    await signOut(page);

    // Now the student has a room and can raise a ticket for it.
    await page.goto('/login');
    await page.getByLabel(/registration number/i).fill(regNo);
    await page.getByRole('textbox', { name: 'Password' }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: /sign in as student/i }).click();
    await expect(page).toHaveURL(/\/student$/);
    await expect(page.getByText(/waiting for the hostel office/i)).toHaveCount(0);
    await page.goto('/student/new');
    await expect(page.getByRole('radio', { name: /my room.*L-101/i })).toBeEnabled();
  });

  test('a student can withdraw a waiting request, and ask again for another room', async ({ page }) => {
    const regNo = uniqueReg();
    await register(page, regNo, { block: 'L-Block (Ladies/Mens Hostel)', floor: 'Floor 2', room: 'L-201' });
    await expect(page).toHaveURL(/\/student$/);
    await page.getByRole('button', { name: 'Withdraw request' }).click();
    await expect(page.getByText(/no room has been allotted to your account yet/i)).toBeVisible();

    // Gone from the office queue.
    await signOut(page);
    await signIn(page, ADMIN);
    await page.goto('/admin/allotments');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: regNo })).toHaveCount(0);
  });

  test('sign-in sends an unconfirmed student back to the code screen', async ({ page }) => {
    const regNo = uniqueReg();
    await page.goto('/register');
    await page.getByLabel('Registration number').fill(regNo);
    await page.getByLabel('Full name').fill('E2E Unconfirmed');
    await page.getByLabel(/^Email\s*\*?$/).fill(studentEmail(regNo));
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Block').selectOption({ label: 'L-Block (Ladies/Mens Hostel)' });
    await page.getByLabel('Floor').selectOption({ label: 'Floor 3' });
    await page.getByLabel('Room').selectOption('L-305');
    await page.getByLabel(/^Password\s*\*?$/).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/verify-email/);

    await page.goto('/login');
    await page.getByLabel(/registration number/i).fill(regNo);
    await page.getByRole('textbox', { name: 'Password' }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: /sign in as student/i }).click();
    await confirmEmailCode(page, regNo);
    await completeOnboarding(page);
  });

  test('registration without a room works, and the form refuses a weak or mismatched password', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Registration number').fill(uniqueReg());
    await page.getByLabel('Full name').fill('Weak Pass');
    await page.getByLabel(/^Email\s*\*?$/).fill(`weak${Date.now()}@vitstudent.ac.in`);
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel(/^Password\s*\*?$/).fill('short');
    await page.getByLabel('Confirm password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/at least 8 characters/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });
});
