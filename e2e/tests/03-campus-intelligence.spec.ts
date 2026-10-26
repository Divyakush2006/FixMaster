import { test, expect } from '@playwright/test';
import { ADMIN, STUDENT, STUDENT_B, SUPERVISOR, signIn } from '../helpers';

// The campus-intelligence screens, driven the way people use them. These use
// only the demo accounts, so no mail catcher is needed.

test.describe('managers: briefing, autopilot and cleaning plan', () => {
  test('the daily briefing shows a written summary, the figures behind it, and answers a question', async ({ page }) => {
    await signIn(page, SUPERVISOR);
    await page.getByRole('link', { name: 'Daily briefing' }).click();
    await expect(page.getByRole('heading', { name: "Today's briefing" })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Briefing', exact: true })).toBeVisible();
    // The briefing says who wrote it, and the figures it was written from are on the page.
    await expect(page.getByText(/Standard summary of the figures below|Written by an AI model/)).toBeVisible();
    await expect(page.getByText('Open tickets', { exact: true })).toBeVisible();
    await expect(page.getByText('Not yet assigned')).toBeVisible();

    await page.getByLabel('Your question').fill('Which tickets are about to miss their deadline?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const answer = page.getByRole('status').filter({ hasText: /From the report/ });
    await expect(answer).toContainText(/overdue|deadline/i);
    await expect(answer).toContainText('Tickets at risk of missing their deadline');
  });

  test('a question that is not about operations gets a polite list of what can be asked', async ({ page }) => {
    await signIn(page, SUPERVISOR);
    await page.goto('/supervisor/insights');
    await page.getByLabel('Your question').fill('What is the weather in Vellore today?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /I can answer questions about/ })).toBeVisible();
  });

  test('autopilot settings are changed per trade and saved', async ({ page }) => {
    await signIn(page, SUPERVISOR);
    await page.getByRole('link', { name: 'Dispatch settings' }).click();
    await expect(page.getByRole('heading', { name: 'Dispatch autopilot' })).toBeVisible();
    const electrician = page.getByRole('tablist', { name: 'Autopilot mode for ELECTRICIAN' });
    const saveElectrician = electrician.locator('xpath=ancestor::section[1]').getByRole('button', { name: 'Save' });
    await electrician.getByRole('tab', { name: 'Automatic' }).click();
    await saveElectrician.click();
    await expect(page.getByText('Autopilot updated').first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Autopilot mode for ELECTRICIAN' }).getByRole('tab', { name: 'Automatic' })).toHaveAttribute('aria-selected', 'true');
    // Put it back so the next run starts the same way.
    await page.getByRole('tablist', { name: 'Autopilot mode for ELECTRICIAN' }).getByRole('tab', { name: 'Suggest' }).click();
    await saveElectrician.click();
    await expect(page.getByText('Autopilot updated').first()).toBeVisible();
  });

  test('staff performance lists technicians with their record, and can be filtered by trade', async ({ page }) => {
    await signIn(page, SUPERVISOR);
    await page.getByRole('link', { name: 'Staff performance' }).click();
    await expect(page.getByRole('heading', { name: 'Staff performance' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Rating' })).toBeVisible();
    const all = await page.getByRole('row').count();
    await page.getByLabel('Trade').selectOption('ELECTRICIAN');
    await expect.poll(async () => page.getByRole('row').count()).toBeLessThan(all);
    await expect(page.getByRole('row').filter({ hasText: 'Electrician' }).first()).toBeVisible();
  });

  test('the cleaning plan shows who cleans which floors', async ({ page }) => {
    await signIn(page, SUPERVISOR);
    await page.getByRole('link', { name: 'Cleaning plan' }).click();
    await expect(page.getByRole('heading', { name: 'Cleaning plan' })).toBeVisible();
    await expect(page.getByLabel('Block')).toBeVisible();
    await expect(page.getByText(/rooms shared between|No housekeepers on this shift/)).toBeVisible();
  });

  test('a ticket opens with the autopilot\'s suggestion and the people it left out', async ({ page, browser }) => {
    // A resident raises a new problem, so there is an open ticket nobody has been sent to.
    const resident = await browser.newContext();
    const residentPage = await resident.newPage();
    await signIn(residentPage, STUDENT_B);
    const csrf = (await resident.cookies()).find((c) => c.name === 'fm_csrf')!.value;
    const raised = await residentPage.request.post('/api/complaints', {
      headers: { 'X-CSRF-Token': csrf },
      data: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: 7, description: 'Fan not rotating' },
    });
    expect(raised.status(), await raised.text()).toBe(201);
    await resident.close();

    await signIn(page, SUPERVISOR);
    await page.goto('/supervisor/all-complaints');
    await page.getByRole('row').filter({ hasText: 'Fan Regulator Broken' }).first().click();
    await expect(page.getByRole('heading', { name: 'Autopilot suggestion' })).toBeVisible();
    await expect(page.getByText('Ratings').first()).toBeVisible();
  });
});

test.describe('residents and administrators: privacy', () => {
  test('a resident can download their data and is asked for the password before erasure', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my data' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^fixmaster-my-data-\d{4}-\d{2}-\d{2}\.json$/);

    await page.getByRole('button', { name: 'Ask for my data to be erased' }).click();
    await expect(page.getByRole('button', { name: 'Request erasure' })).toBeDisabled();
    await page.getByLabel(/Enter your password to confirm/).fill('definitely-wrong-1');
    await page.getByRole('button', { name: 'Request erasure' }).click();
    await expect(page.getByRole('alert')).toContainText(/incorrect/i);
    // Nothing was requested.
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('button', { name: 'Ask for my data to be erased' })).toBeVisible();
  });

  test('the administrator has a privacy requests page', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.getByRole('link', { name: 'Privacy requests' }).click();
    await expect(page.getByRole('heading', { name: 'Privacy requests' })).toBeVisible();
    await expect(page.getByText(/No requests|Ready to erase|Erase/).first()).toBeVisible();
  });

  test('a resident cannot reach manager pages', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/supervisor/insights');
    await expect(page).not.toHaveURL(/\/supervisor\/insights/);
  });
});
