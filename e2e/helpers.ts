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

/** A reg number unique to this run, so re-runs and parallel files never collide. */
export const uniqueReg = (prefix = '26E2E') => `${prefix}${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;

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
