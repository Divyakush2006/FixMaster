// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
  ],
  Y_BLOCK: [{ room_id: 'Y-301', block_id: 'Y_BLOCK', room_number: '301', floor_number: 3, is_active: true }],
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RegisterScreen />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const select = (name: RegExp) => screen.getByRole('combobox', { name });

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

  it('offers only the configured blocks, and floors and rooms follow the choice', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    expect((select(/^floor/i) as HTMLSelectElement).disabled).toBe(true);
    expect((select(/^room/i) as HTMLSelectElement).disabled).toBe(true);

    await user.selectOptions(select(/^block/i), 'X_BLOCK');
    await waitFor(() => expect(within(select(/^floor/i)).getByRole('option', { name: 'Ground floor' })).toBeTruthy());
    expect(within(select(/^floor/i)).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select floor', 'Ground floor', 'Floor 1']);

    await user.selectOptions(select(/^floor/i), '1');
    expect(within(select(/^room/i)).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select room', '101']);
  });

  it('clears the dependent choices when a parent choice changes', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await user.selectOptions(select(/^block/i), 'X_BLOCK');
    await waitFor(() => within(select(/^floor/i)).getByRole('option', { name: 'Floor 1' }));
    await user.selectOptions(select(/^floor/i), '1');
    await user.selectOptions(select(/^room/i), 'X-101');
    expect((select(/^room/i) as HTMLSelectElement).value).toBe('X-101');

    await user.selectOptions(select(/^block/i), 'Y_BLOCK');
    expect((select(/^floor/i) as HTMLSelectElement).value).toBe('');
    expect((select(/^room/i) as HTMLSelectElement).value).toBe('');
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
    await waitFor(() => within(select(/^floor/i)).getByRole('option', { name: 'Floor 1' }));
    await user.selectOptions(select(/^floor/i), '1');
    await user.selectOptions(select(/^room/i), 'X-101');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/do not match/i)).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('submits the chosen block, floor and room once, then signs in', async () => {
    register.mockResolvedValue({ user: { role: 'STUDENT' }, roomRequest: { room_id: 'X-101' } });
    login.mockResolvedValue({ role: 'STUDENT' });
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await fillProfile(user);
    await user.selectOptions(select(/^block/i), 'X_BLOCK');
    await waitFor(() => within(select(/^floor/i)).getByRole('option', { name: 'Floor 1' }));
    await user.selectOptions(select(/^floor/i), '1');
    await user.selectOptions(select(/^room/i), 'X-101');
    await user.dblClick(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('student', '24BCE0001', 'Corridor7Lamp'));
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ block_id: 'X_BLOCK', floor_number: 1, room_id: 'X-101' }));
  });

  it('shows the server error and keeps the form when registration fails', async () => {
    register.mockRejectedValue(new Error('An account with this Register/Employee ID already exists.'));
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'X Block' });
    await fillProfile(user);
    await user.selectOptions(select(/^block/i), 'Y_BLOCK');
    await waitFor(() => within(select(/^floor/i)).getByRole('option', { name: 'Floor 3' }));
    await user.selectOptions(select(/^floor/i), '3');
    await user.selectOptions(select(/^room/i), 'Y-301');
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
