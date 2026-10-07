import { apiFetch } from './client';
import {
  AuthResponse,
  RegisterPayload,
  CreateComplaintPayload,
  Complaint,
  ComplaintLogEntry,
  StaffTask,
  FeedbackPayload,
  BlockKpi,
  Hotspot,
  HostelBlock,
  Room,
  Category,
  User,
  StaffRosterItem,
  CommonAreaItem,
  Specialization,
  Allotment,
  AdminAllotment,
  CreateUserPayload,
  Role,
} from '../types';

export const authApi = {
  login: (data: { reg_or_emp_id: string; password: string }) =>
    apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  register: (data: RegisterPayload) =>
    apiFetch<{ message: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export const complaintsApi = {
  create: (data: CreateComplaintPayload) =>
    apiFetch<{ message: string; complaint: Complaint }>('/complaints', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  list: (filters?: { status?: string; block_id?: string }) =>
    apiFetch<Complaint[]>('/complaints', {
      method: 'GET',
      params: filters,
    }),

  getById: (id: string) => apiFetch<Complaint>(`/complaints/${id}`, { method: 'GET' }),

  getLogs: (id: string) => apiFetch<ComplaintLogEntry[]>(`/complaints/${id}/logs`, { method: 'GET' }),
};

export const dispatchApi = {
  getQueue: () => apiFetch<StaffTask[]>('/dispatch/queue', { method: 'GET' }),

  startWork: (assignmentId: string) =>
    apiFetch<{ message: string; complaint_id: string }>(`/dispatch/tasks/${assignmentId}/start`, {
      method: 'PATCH',
    }),

  // The complaint is identified server-side from the assignment itself.
  markTaskCompleted: (assignmentId: string) =>
    apiFetch<{ message: string }>(`/dispatch/tasks/${assignmentId}`, { method: 'PATCH' }),

  assignTechnician: (complaintId: string, staffUserId: string) =>
    apiFetch<{ message: string }>('/dispatch/assign', {
      method: 'POST',
      body: JSON.stringify({
        complaint_id: complaintId,
        staff_user_id: staffUserId,
      }),
    }),

  autoDispatchCleaning: (complaintId: string) =>
    apiFetch<{ assigned: boolean; staff_user_id?: string; staff_name?: string; message: string }>(
      '/dispatch/auto-dispatch',
      {
        method: 'POST',
        body: JSON.stringify({ complaint_id: complaintId }),
      }
    ),
};

export const feedbackApi = {
  submit: (data: FeedbackPayload) =>
    apiFetch<{ message: string }>('/feedback', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export const analyticsApi = {
  getKpis: () => apiFetch<BlockKpi[]>('/analytics/kpi', { method: 'GET' }),

  getHotspots: () => apiFetch<Hotspot[]>('/analytics/hotspots', { method: 'GET' }),
};

export const metaApi = {
  getBlocks: () => apiFetch<HostelBlock[]>('/meta/blocks', { method: 'GET' }),

  getRoomsByBlock: (blockId: string) =>
    apiFetch<Room[]>(`/meta/blocks/${blockId}/rooms`, { method: 'GET' }),

  getCommonAreas: (blockId: string) =>
    apiFetch<CommonAreaItem[]>(`/meta/blocks/${blockId}/common-areas`, { method: 'GET' }),

  getCategories: () => apiFetch<Category[]>('/meta/categories', { method: 'GET' }),

  // SUPERVISOR/ADMIN only - the backend gates this route by role.
  getStaff: (specialization?: Specialization) =>
    apiFetch<StaffRosterItem[]>('/meta/staff', {
      method: 'GET',
      params: specialization ? { specialization } : undefined,
    }),
};

export const meApi = {
  getMe: () => apiFetch<User>('/me', { method: 'GET' }),

  // Throws ApiError with status 404 when the student has no current allotment.
  getMyAllotment: () => apiFetch<Allotment>('/me/allotment', { method: 'GET' }),

  // Returns a fresh token: the change revokes every token issued before it,
  // including the one used for this request.
  changePassword: (current_password: string, new_password: string) =>
    apiFetch<{ message: string; token: string }>('/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ current_password, new_password }),
    }),

  setAvailability: (is_available: boolean) =>
    apiFetch<{ is_available: boolean }>('/me/availability', {
      method: 'PATCH',
      body: JSON.stringify({ is_available }),
    }),
};

// ADMIN only.
export const adminApi = {
  listUsers: (role?: Role) => apiFetch<User[]>('/admin/users', { method: 'GET', params: { role } }),

  createUser: (data: CreateUserPayload) =>
    apiFetch<{ message: string; user: User }>('/admin/users', { method: 'POST', body: JSON.stringify(data) }),

  updateUser: (userId: string, changes: { is_active?: boolean; is_available?: boolean }) =>
    apiFetch<User & { released_tickets: number }>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  resetPassword: (userId: string, new_password: string) =>
    apiFetch<{ message: string }>(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password }),
    }),

  listAllotments: (blockId?: string) =>
    apiFetch<AdminAllotment[]>('/admin/allotments', { method: 'GET', params: { block_id: blockId } }),

  allotRoom: (student_id: string, room_id: string, academic_year: string) =>
    apiFetch<{ message: string }>('/admin/allotments', {
      method: 'POST',
      body: JSON.stringify({ student_id, room_id, academic_year }),
    }),

  endAllotment: (studentId: string) =>
    apiFetch<{ message: string }>(`/admin/allotments/${studentId}`, { method: 'DELETE' }),
};
