import { apiFetch, apiFetchPage } from './client';
import {
  AuthResponse,
  RegisterPayload,
  CreateComplaintPayload,
  CreateComplaintResult,
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
  Portal,
  AdminBlock,
  BlockFloor,
  AdminRoom,
  RoomType,
  AuditEntry,
  UserSummary,
  RoomRequest,
  PendingAllotmentRequest,
  AppNotification,
  AuthCapabilities,
  RegisterResponse,
  StudentProfile,
  StudentProfileInput,
  AccountStatus,
} from '../types';

// Three separate sign-in portals; each endpoint only accepts its own accounts.
export const authApi = {
  login: (portal: Portal, data: { reg_or_emp_id: string; password: string }) =>
    apiFetch<AuthResponse>(`/auth/${portal}/login`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Revokes this session's token on the server. keepalive lets the request
  // finish even when the page is navigating away.
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST', keepalive: true }),

  /** What this deployment can do, e.g. whether password-reset email is set up. */
  capabilities: () => apiFetch<AuthCapabilities>('/auth/capabilities', { method: 'GET' }),

  forgotPassword: (reg_or_emp_id: string) =>
    apiFetch<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ reg_or_emp_id }) }),

  resetPassword: (token: string, new_password: string) =>
    apiFetch<{ message: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, new_password }) }),

  // Public self-registration exists for students only. The account cannot sign
  // in until the code emailed to the university address is confirmed.
  registerStudent: (data: RegisterPayload) =>
    apiFetch<RegisterResponse>('/auth/student/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** Confirms the emailed code and opens a session (status PENDING_PROFILE). */
  verifyEmail: (reg_or_emp_id: string, code: string) =>
    apiFetch<AuthResponse>('/auth/student/verify-email', { method: 'POST', body: JSON.stringify({ reg_or_emp_id, code }) }),

  /** Always 202; a code is only sent when the account is waiting for one. */
  resendCode: (reg_or_emp_id: string) =>
    apiFetch<{ message: string }>('/auth/student/resend-code', { method: 'POST', body: JSON.stringify({ reg_or_emp_id }) }),
};

export const complaintsApi = {
  /** Attach (or replace) the ticket's photo: the raw image is the request body. */
  uploadPhoto: (complaintId: string, photo: Blob) =>
    apiFetch<{ photo_evidence_url: string }>(`/complaints/${complaintId}/photo`, {
      method: 'PUT',
      headers: { 'Content-Type': photo.type },
      body: photo,
    }),

  deletePhoto: (complaintId: string) => apiFetch<void>(`/complaints/${complaintId}/photo`, { method: 'DELETE' }),

  /**
   * One live ticket per room (or common area) and issue: if it is already
   * open, the caller is added to it and `joined` is true.
   */
  create: (data: CreateComplaintPayload) =>
    apiFetch<CreateComplaintResult>('/complaints', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  list: (filters?: { status?: string; block_id?: string }) =>
    apiFetch<Complaint[]>('/complaints', {
      method: 'GET',
      params: filters,
    }),

  /** Server-side filtered, searched and paged list (supervisor/admin register). */
  page: (filters: { status?: string; block_id?: string; q?: string; sla?: string; limit: number; offset: number }) =>
    apiFetchPage<Complaint>('/complaints', { method: 'GET', params: filters }),

  getById: (id: string) => apiFetch<Complaint>(`/complaints/${id}`, { method: 'GET' }),

  getLogs: (id: string) => apiFetch<ComplaintLogEntry[]>(`/complaints/${id}/logs`, { method: 'GET' }),

  /** Other live tickets at the same room / common area (merge candidates). Supervisor, admin. */
  related: (id: string) => apiFetch<Complaint[]>(`/complaints/${id}/related`, { method: 'GET' }),

  /** Student: withdraw a report while nobody has been assigned. */
  withdraw: (id: string) =>
    apiFetch<{ cancelled: boolean; remaining_reporters: number; message: string }>(`/complaints/${id}/withdraw`, {
      method: 'POST',
    }),

  /** Supervisor, admin: close a ticket that is not valid work. */
  reject: (id: string, reason: string) =>
    apiFetch<{ message: string }>(`/complaints/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  /** Supervisor, admin: fold a duplicate into another live ticket at the same location. */
  merge: (id: string, targetId: string) =>
    apiFetch<{ message: string; merged_into_id: string; reporters_moved: number }>(`/complaints/${id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ target_id: targetId }),
    }),
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

  /**
   * `expectedAssigneeId`: who the screen shows holding the ticket (null =
   * nobody). The API refuses (STALE_ASSIGNMENT) if that changed meanwhile.
   * `allowOffDuty`: confirm assigning an off-duty technician.
   */
  assignTechnician: (
    complaintId: string,
    staffUserId: string,
    options: { expectedAssigneeId?: string | null; allowOffDuty?: boolean } = {}
  ) =>
    apiFetch<{ message: string }>('/dispatch/assign', {
      method: 'POST',
      body: JSON.stringify({
        complaint_id: complaintId,
        staff_user_id: staffUserId,
        ...(options.expectedAssigneeId !== undefined ? { expected_assignee_id: options.expectedAssigneeId } : {}),
        ...(options.allowOffDuty ? { allow_off_duty: true } : {}),
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

export const notificationsApi = {
  /** Newest first, last 14 days. Unread is decided by the caller (it remembers when it last looked). */
  list: (opts: { limit?: number; offset?: number } = {}) =>
    apiFetch<AppNotification[]>('/notifications', { method: 'GET', params: { limit: 30, ...opts } }),
};

export const meApi = {
  getMe: () => apiFetch<User>('/me', { method: 'GET' }),

  /** The student's resident record, or null before onboarding. */
  getProfile: () => apiFetch<{ profile: StudentProfile | null; account_status: AccountStatus }>('/me/profile', { method: 'GET' }),

  /** Saves the record; the first save finishes onboarding (account becomes ACTIVE). */
  saveProfile: (data: StudentProfileInput) =>
    apiFetch<{ message: string; profile: StudentProfile; account_status: AccountStatus }>('/me/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  /** The student's latest room request, or null when none is open / they already have a room. */
  getRoomRequest: () => apiFetch<{ request: RoomRequest | null }>('/me/room-request', { method: 'GET' }),

  requestRoom: (data: { block_id: string; floor_number: number; room_id: string }) =>
    apiFetch<{ request: RoomRequest; message: string }>('/me/room-request', { method: 'POST', body: JSON.stringify(data) }),

  /** Takes back a request the hostel office has not answered yet. */
  withdrawRoomRequest: () => apiFetch<void>('/me/room-request', { method: 'DELETE' }),

  // Throws ApiError with status 404 when the student has no current allotment.
  getMyAllotment: () => apiFetch<Allotment>('/me/allotment', { method: 'GET' }),

  // The change revokes every older session, including this one, so the server
  // re-issues the session cookie in the same response.
  changePassword: (current_password: string, new_password: string) =>
    apiFetch<{ message: string; expires_at: string }>('/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ current_password, new_password }),
    }),

  /**
   * Going off duty with open jobs fails with code OPEN_JOBS unless
   * `releaseOpenJobs` says whether to keep them (false) or hand them back (true).
   */
  setAvailability: (is_available: boolean, releaseOpenJobs?: boolean) =>
    apiFetch<{ is_available: boolean; open_jobs: number; released_jobs: number }>('/me/availability', {
      method: 'PATCH',
      body: JSON.stringify({ is_available, ...(releaseOpenJobs !== undefined ? { release_open_jobs: releaseOpenJobs } : {}) }),
    }),
};

// ADMIN only.
export const adminApi = {
  usersPage: (filters: { role?: Role; status?: 'active' | 'deactivated' | 'locked'; q?: string; limit: number; offset: number }) =>
    apiFetchPage<User>('/admin/users', { method: 'GET', params: filters }),

  userSummary: () => apiFetch<UserSummary>('/admin/users/summary', { method: 'GET' }),

  /** Type-ahead lookup of active students (allotment picker). */
  searchStudents: (q: string) =>
    apiFetch<User[]>('/admin/users', { method: 'GET', params: { role: 'STUDENT', status: 'active', q, limit: 20 } }),

  createUser: (data: CreateUserPayload) =>
    apiFetch<{ message: string; user: User }>('/admin/users', { method: 'POST', body: JSON.stringify(data) }),

  updateUser: (userId: string, changes: { is_active?: boolean; is_available?: boolean; unlock?: boolean }) =>
    apiFetch<User & { released_tickets: number }>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  allotmentRequests: () => apiFetch<PendingAllotmentRequest[]>('/admin/allotment-requests', { method: 'GET' }),

  declineAllotmentRequest: (studentId: string, reason: string) =>
    apiFetch<{ message: string }>(`/admin/allotment-requests/${studentId}/decline`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  resetPassword: (userId: string, new_password: string) =>
    apiFetch<{ message: string }>(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password }),
    }),

  listAudit: (filters: { action?: string; actor?: string; target_id?: string; limit: number; offset: number }) =>
    apiFetchPage<AuditEntry>('/admin/audit', { method: 'GET', params: filters }),

  allotmentsPage: (filters: { block_id?: string; student_id?: string; q?: string; limit: number; offset: number }) =>
    apiFetchPage<AdminAllotment>('/admin/allotments', { method: 'GET', params: filters }),

  allotRoom: (student_id: string, room_id: string, academic_year: string) =>
    apiFetch<{ message: string }>('/admin/allotments', {
      method: 'POST',
      body: JSON.stringify({ student_id, room_id, academic_year }),
    }),

  endAllotment: (studentId: string) =>
    apiFetch<{ message: string }>(`/admin/allotments/${studentId}`, { method: 'DELETE' }),

  // ---- Infrastructure: blocks -> floors -> rooms ----
  listBlocks: () => apiFetch<AdminBlock[]>('/admin/blocks', { method: 'GET' }),

  createBlock: (block_code: string, block_name: string, top_floor: number) =>
    apiFetch<AdminBlock>('/admin/blocks', {
      method: 'POST',
      body: JSON.stringify({ block_code, block_name, top_floor }),
    }),

  renameBlock: (blockId: string, block_name: string) =>
    apiFetch<AdminBlock>(`/admin/blocks/${blockId}`, { method: 'PATCH', body: JSON.stringify({ block_name }) }),

  listFloors: (blockId: string) => apiFetch<BlockFloor[]>(`/admin/blocks/${blockId}/floors`, { method: 'GET' }),

  // Without a floor number the next floor above the current top floor is added.
  addFloor: (blockId: string, floor_number?: number) =>
    apiFetch<{ floor_number: number; floor_code: string }>(`/admin/blocks/${blockId}/floors`, {
      method: 'POST',
      body: JSON.stringify(floor_number === undefined ? {} : { floor_number }),
    }),

  removeFloor: (blockId: string, floorNumber: number) =>
    apiFetch<{ message: string }>(`/admin/blocks/${blockId}/floors/${floorNumber}`, { method: 'DELETE' }),

  listRooms: (blockId: string) => apiFetch<AdminRoom[]>(`/admin/blocks/${blockId}/rooms`, { method: 'GET' }),

  createRooms: (
    blockId: string,
    data: { floor_number: number; from: number; to: number; room_type: RoomType; bed_capacity: number }
  ) =>
    apiFetch<{ message: string; created: string[]; skipped: string[] }>(`/admin/blocks/${blockId}/rooms`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateRoom: (roomId: string, changes: { is_active?: boolean; room_type?: RoomType; bed_capacity?: number }) =>
    apiFetch<AdminRoom>(`/admin/rooms/${roomId}`, { method: 'PATCH', body: JSON.stringify(changes) }),
};

export const aiApi = {
  parseAndTriage: (data: { raw_text: string; photo_url?: string | null; student_allotment_room?: string | null }) =>
    apiFetch<{ success: boolean; data: import('../types').AiTriageResult; meta: { source: string } }>('/ai/parse-and-triage', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  previewAllocation: (data: { category_id?: number | null; subcategory_id?: number | null; priority?: string; floor_number?: number | null }) =>
    apiFetch<{ success: boolean; data: import('../types').AiAllocationPreview; meta: { source: string } }>('/ai/allocate-technician', {
      method: 'POST',
      body: JSON.stringify({ ...data, preview: true }),
    }),

  /** Supervisor/Admin: poll AI service health status. */
  getHealth: () =>
    apiFetch<import('../types').AiHealthStatus>('/ai/health', { method: 'GET' }),
};


