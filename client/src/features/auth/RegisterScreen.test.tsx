// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const register = vi.fn();
const login = vi.fn();
const getBlocks = vi.fn();
const getRoomsByBlock = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ register, login, getHomeRouteForRole: () => '/student' }),
}));
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../api/endpoints', () => ({
  metaApi: { getBlocks: () => getBlocks(), getRoomsByBlock: (id: string) => getRoomsByBlock(id) },
  authApi: { capabilities: async () => ({ password_reset: true, student_signup: true, student_email_domains: ['vitstudent.ac.in'] }) },
}));

import { RegisterScreen } from './RegisterScreen';

const BLOCKS = [
  { block_id: 'X_BLOCK', block_name: 'X Block' },
  { block_id: 'Y_BLOCK', block_name: 'Y Block' },
];
const ROOMS: Record<string, unknown[]> = {
  X_BLOCK: [
    { room_id: 'X-101', block_id: 'X_BLOCK', room_number: '101', floor_number: 1, is_active: true },
    { room_id: 'X-G01', block_id: 'X_BLOCK', room_number: 'G01', floor_number: 0, is_active: true },
    // A hostel that counts the ground floor as 1: floor 3 holds rooms 4xx.
    { room_id: 'X-420', block_id: 'X_BLOCK', room_number: '420', floor_number: 3, is_active: true },
  ],
  Y_BLOCK: [{ room_id: 'Y-301', block_id: 'Y_BLOCK', room_number: '301', floor_number: 3, is_active: true }],
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<RegisterScreen />} />
          <Route path="/verify-email" element={<p>Code entry page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const select = (name: RegExp) => screen.getByRole('combobox', { name });
const floorBox = () => screen.getByLabelText(/^floor/i) as HTMLInputElement;
const roomBox = () => screen.getByLabelText(/^room number/i) as HTMLInputElement;

async function fillProfile(user: ReturnType<typeof userEvent.setup>, password = 'Corridor7Lamp', confirm = password) {
  await user.type(screen.getByLabelText(/registration number/i), '24BCE0001');
  await user.type(screen.getByLabelText(/full name/i), 'Asha Rao');
  await user.type(screen.getByLabelText(/^email/i), 'asha@vitstudent.ac.in');
  await user.type(screen.getByLabelText(/mobile number/i), '9876543210');
  await user.type(screen.getByLabelText(/^password/i), password);
  await user.type(screen.getByLabelText(/confirm password/i), confirm);
}

describe('RegisterScreen', () => {
  beforeEach(() => {
    register.mockReset();
    login.mockReset();
    getBlocks.mockResolvedValue(BLOCKS);
    getRoomsByBlock.mockImplementation(async (id: string) => ROOMS[id] ?? []);
  });
  afterEach(cleanup);

  it('offers only the configured blocks; floor and room number are typed as whole numbers and checked against the block', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    expect(floorBox().disabled).toBe(true);
    expect(roomBox().disabled).toBe(true);
    expect(floorBox().inputMode).toBe('numeric');

    await user.selectOptions(select(/^block/i), 'X_BLOCK');
    await user.type(floorBox(), '1x');
    expect(floorBox().value).toBe('1');
    await user.type(roomBox(), '101');
    expect(await screen.findByText('Room X-101')).toBeTruthy();

    // The door number does not have to start with the floor: floor 3 can hold room 420.
    await user.clear(floorBox());
    await user.type(floorBox(), '3');
    await user.clear(roomBox());
    await user.type(roomBox(), '420');
    expect(await screen.findByText('Room X-420')).toBeTruthy();

    // The same room on the wrong floor is named, not just refused.
    await user.clear(floorBox());
    await user.type(floorBox(), '4');
    expect(await screen.findByText(/room 420 is on floor 3 of this block, not floor 4/i)).toBeTruthy();

    await user.clear(roomBox());
    await user.type(roomBox(), '999');
    // A room the office has not added yet is not refused: it is added when the request is sent.
    expect(await screen.findByText(/room x-999: not in our records yet/i)).toBeTruthy();
  });

  it('allows floors 0 to 24 and room numbers of three or four digits only', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await user.selectOptions(select(/^block/i), 'X_BLOCK');

    await user.type(floorBox(), '25');
    expect(await screen.findByText(/the floor must be from 0 \(ground\) to 24/i)).toBeTruthy();
    await user.clear(floorBox());
    await user.type(floorBox(), '24');
    expect(screen.queryByText(/the floor must be from 0/i)).toBeNull();
    await user.clear(floorBox());
    await user.type(floorBox(), '0');
    expect(screen.queryByText(/the floor must be from 0/i)).toBeNull();

    // Two digits are still being typed; five are not accepted at all.
    await user.type(roomBox(), '12345');
    expect(roomBox().value).toBe('1234');
    await user.clear(roomBox());
    await user.type(roomBox(), '07');
    await user.type(roomBox(), '5');
    expect(await screen.findByText(/the room number is the 3 or 4 digit number on your door/i)).toBeTruthy();
  });

  it('clears the floor and room when the block changes', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await user.selectOptions(select(/^block/i), 'X_BLOCK');
    await user.type(floorBox(), '1');
    await user.type(roomBox(), '101');
    expect(await screen.findByText('Room X-101')).toBeTruthy();

    await user.selectOptions(select(/^block/i), 'Y_BLOCK');
    expect(floorBox().value).toBe('');
    expect(roomBox().value).toBe('');
  });

  it('blocks submission with inline messages and never calls the API', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/enter your registration number/i)).toBeTruthy();
    expect(screen.getByText(/choose your hostel block/i)).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await fillProfile(user, 'Corridor7Lamp', 'Corridor7Lamq');
    await user.selectOptions(select(/^block/i), 'X_BLOCK');
    await user.type(floorBox(), '1');
    await user.type(roomBox(), '101');
    await screen.findByText('Room X-101');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/do not match/i)).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('refuses addresses outside the university domain before calling the API', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await user.type(screen.getByLabelText(/^email/i), 'asha@gmail.com');
    await user.type(screen.getByLabelText(/registration number/i), 'ASHA01');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/use your university email address/i)).toBeTruthy();
    expect(screen.getByText(/as printed on your id card/i)).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('submits the chosen block, floor and room once, then asks for the emailed code', async () => {
    register.mockResolvedValue({
      user: { role: 'STUDENT', reg_or_emp_id: '24BCE0001' },
      room_request: { room_id: 'X-101' },
      verification: { email: 'as***@vitstudent.ac.in', expires_in_minutes: 15 },
    });
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await fillProfile(user);
    await user.selectOptions(select(/^block/i), 'X_BLOCK');
    await user.type(floorBox(), '1');
    await user.type(roomBox(), '101');
    await screen.findByText('Room X-101');
    await user.dblClick(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Code entry page')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ block_id: 'X_BLOCK', floor_number: 1, room_number: '101' }));
  });

  it('shows the server error and keeps the form when registration fails', async () => {
    register.mockRejectedValue(new Error('An account with this Register/Employee ID already exists.'));
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await fillProfile(user);
    await user.selectOptions(select(/^block/i), 'Y_BLOCK');
    await user.type(floorBox(), '3');
    await user.type(roomBox(), '301');
    await screen.findByText('Room Y-301');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect((await screen.findAllByText(/already exists/i)).length).toBeGreaterThan(0);
    expect(login).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('explains when no hostel infrastructure is configured and blocks submission', async () => {
    getBlocks.mockResolvedValue([]);
    setup();
    expect(await screen.findByText(/hostel rooms are not set up yet/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
