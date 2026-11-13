import { expect, test, type Browser, type Page } from '@playwright/test';

/* Two people on one team, in separate browser sessions (separate cookies),
   each seeing the other's changes live. A third person on another team
   must see none of it. */

async function signIn(browser: Browser, email: string, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());   // confirm() prompts
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  return page;
}

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test('two teammates see each other’s changes live; other teams see nothing', async ({ browser }) => {
  // --- A creates a team ---
  const a = await signIn(browser, 'alice@example.com', 'Alice');
  await a.getByLabel('New team name').fill('Downtown');
  await a.getByRole('button', { name: 'Create team' }).click();
  await expect(a.getByTestId('team-name')).toHaveText('Downtown');

  await a.getByTestId('team-name').click();
  const code = (await a.getByTestId('join-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await a.keyboard.press('Escape');

  // --- B joins with the code ---
  const b = await signIn(browser, 'bob@example.com', 'Bob');
  await b.getByLabel('Join code').fill(code.toLowerCase());
  await b.getByRole('button', { name: 'Join team' }).click();
  await expect(b.getByTestId('team-name')).toHaveText('Downtown');

  // --- A adds an employee → B sees it ---
  await a.getByLabel('Employee name').fill('Sam Lee');
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByTestId('roster')).toContainText('Sam Lee');
  await expect(b.getByTestId('stat-Team members')).toContainText('1');

  // --- B schedules a shift around now by pasting text → A sees it ---
  const now = new Date();
  const start = hm(new Date(+now - 60 * 60000)), end = hm(new Date(+now + 7 * 60 * 60000));
  await b.getByText('🗓️ Schedule a Shift').click();
  await b.getByLabel('Paste shift text').fill(`Sam Lee ${start} ${end}`);
  await expect(b.locator('.parse-status')).toContainText('employee Sam Lee');
  await b.getByRole('button', { name: 'Add Shift' }).click();
  await expect(a.getByTestId('shift-row')).toHaveCount(1);
  await expect(a.getByTestId('timeline').locator('.g-row')).toHaveCount(1);

  // --- A clocks Sam in and starts a break → B sees both ---
  await a.getByRole('button', { name: 'Clock In' }).click();
  await expect(b.locator('.stamp')).toContainText('In ');
  await a.getByTestId('break-cell').first().getByRole('button', { name: 'Start' }).click();
  await expect(b.getByTestId('break-cell').first()).toContainText('On break');
  await expect(b.getByTestId('stat-On break now')).toContainText('1');

  // --- B ends the break → history on both screens ---
  await b.getByTestId('break-cell').first().getByRole('button', { name: 'End' }).click();
  await expect(a.getByTestId('history')).toContainText('Sam Lee');
  await expect(a.getByTestId('break-cell').first()).toContainText('Completed');

  // --- A renames Sam → B's roster, shifts and history follow ---
  await a.getByRole('button', { name: 'Sam Lee', exact: true }).click();
  const edit = a.getByLabel('Rename Sam Lee');
  await edit.fill('Samantha Lee');
  await edit.press('Enter');
  await expect(b.getByTestId('dashboard')).toContainText('Samantha Lee');
  await expect(b.getByTestId('history')).toContainText('Samantha Lee');

  // --- Break rules are shared too ---
  await b.getByText('⏱️ Break Rules').click();
  await b.getByLabel('Lunch length').selectOption('45');
  await a.getByText('⏱️ Break Rules').click();
  await expect(a.getByLabel('Lunch length')).toHaveValue('45');

  // --- Changes survive a reload (they're in the database, not the tab) ---
  await a.reload();
  await expect(a.getByTestId('dashboard')).toContainText('Samantha Lee');
  await expect(a.getByTestId('history')).toContainText('Samantha Lee');

  // --- C, on another team, sees nothing of Downtown ---
  const c = await signIn(browser, 'carol@example.com', 'Carol');
  await c.getByLabel('New team name').fill('Uptown');
  await c.getByRole('button', { name: 'Create team' }).click();
  await expect(c.getByTestId('team-name')).toHaveText('Uptown');
  await expect(c.getByTestId('dashboard')).toContainText('No shifts scheduled');
  const res = await c.request.get('/api/dev/teams');
  expect((await res.json()).teams.map((t: { name: string }) => t.name)).toEqual(['Uptown']);

  // --- New Day on B clears shifts and history for A as well ---
  await b.getByRole('button', { name: '⟳ New Day' }).click();
  await expect(a.getByTestId('dashboard')).toContainText('No shifts scheduled');
  await expect(a.getByTestId('history')).toContainText('No completed breaks yet');
  await expect(a.getByTestId('roster')).toContainText('Samantha Lee');   // roster kept

  await a.screenshot({ path: 'test-results/dashboard-a.png', fullPage: true });
});
