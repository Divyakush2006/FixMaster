import { expect, Page } from '@playwright/test';

export const PASSWORD = 'Password@123';
export const MAIL_URL = process.env.E2E_MAIL_URL ?? 'http://localhost:8025';

export type Who = { portal: 'student' | 'staff' | 'admin'; id: string; password?: string };

export const STUDENT = { portal: 'student', id: '21BCE0843' } as const; // Vihaan, room L-843
export const STUDENT_B = { portal: 'student', id: '21BCE1042' } as const; // Rahul, room L-810
export const SUPERVISOR = { portal: 'staff', id: 'SUP_LBLOCK_01' } as const;
export const ELECTRICIAN = { portal: 'staff', id: 'EMP_ELEC_01' } as const;
export const ADMIN = { portal: 'admin', id: 'ADMIN_ESTATES_01' } as const;

const HOME = { student: /\/student$/, staff: /\/(staff|supervisor)$/, admin: /\/admin\/dashboard$/ };

/** Signs in through the real form of the matching portal. */
export async function signIn(page: Page, who: Who) {
  const url = who.portal === 'student' ? '/login' : who.portal === 'staff' ? '/login?portal=staff' : '/admin';
  await page.goto(url);
  const idLabel = who.portal === 'student' ? /registration number/i : who.portal === 'staff' ? /employee id/i : /administrator id/i;
  await page.getByLabel(idLabel).fill(who.id);
  await page.getByRole('textbox', { name: 'Password' }).fill(who.password ?? PASSWORD);
  await page.getByRole('button', { name: /^sign in/i }).click();
  await expect(page).toHaveURL(HOME[who.portal]);
}

export async function signOut(page: Page) {
  await page.getByRole('banner').getByRole('button', { expanded: false, name: /student|staff|supervisor|administrator|technician/i }).last().click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/(login|admin)(\?|$)/);
}

/**
 * A registration number in the VIT format (21BCE0843) that is unique to this
 * run, so re-runs and parallel files never collide: three random letters and
 * four digits give 175 million combinations.
 */
export const uniqueReg = () => {
  const letters = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  return `26${letters}${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
};

/** A new student's university address. */
export const studentEmail = (regNo: string) => `${regNo.toLowerCase()}@vitstudent.ac.in`;

/** Reads the 6-digit sign-up code from Mailpit and enters it; lands on onboarding. */
export async function confirmEmailCode(page: Page, regNo: string) {
  await expect(page).toHaveURL(/\/verify-email/);
  const mail = await waitForMail(studentEmail(regNo), /verification code/i);
  const code = mail.Text.match(/code is (\d{6})/)![1];
  await page.getByLabel('Verification code').fill(code);
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

/** Fills the six-step resident profile with valid details and finishes it. */
export async function completeOnboarding(page: Page) {
  await page.getByLabel('School').fill('SCOPE');
  await page.getByLabel('Programme').fill('B.Tech Computer Science');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Gender').selectOption('FEMALE');
  await page.getByLabel('Date of birth').fill('2006-04-12');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Parent or guardian').fill('R. Iyer');
  await page.getByLabel('Relation').selectOption('Mother');
  await page.getByLabel('Their phone').fill('9876500011');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('City').fill('Coimbatore');
  await page.getByLabel('State or UT').selectOption('Tamil Nadu');
  await page.getByLabel('PIN code').fill('641001');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/I have read the privacy notice/).check();
  await page.getByRole('button', { name: 'Finish and continue' }).click();
  await expect(page).toHaveURL(/\/student$/);
}

/** Plays the hostel office: approves the room request of a registration number. */
export async function approveRoomRequest(page: Page, regNo: string) {
  await page.goto('/admin/allotments');
  const row = page.getByRole('row').filter({ hasText: regNo });
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('row').filter({ hasText: regNo }).getByRole('button', { name: 'Approve' })).toHaveCount(0);
}

/** The newest message in the Mailpit inbox for `to`, waiting for it to arrive. */
export async function waitForMail(to: string, subject: RegExp) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL_URL}/api/v1/messages`)).json();
    const hit = (list.messages ?? []).find((m: any) => m.To?.some((a: any) => a.Address === to) && subject.test(m.Subject));
    if (hit) return (await (await fetch(`${MAIL_URL}/api/v1/message/${hit.ID}`)).json()) as { Text: string };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email to ${to} matching ${subject}`);
}
