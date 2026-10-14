export type Role = 'STUDENT' | 'STAFF' | 'SUPERVISOR' | 'ADMIN';

export type ComplaintStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'PENDING_VERIFICATION'
  | 'COMPLETED'
  | 'ESCALATED'
  | 'REJECTED'
  | 'CANCELLED';

/** Why a ticket was closed. */
export type ClosureReason = 'CONFIRMED' | 'AUTO_CONFIRMED' | 'WITHDRAWN' | 'INVALID' | 'DUPLICATE';

/** Someone who reported a ticket (names are shown to supervisors and roommates only). */
export interface Reporter {
  name: string;
  is_original: boolean;
  reported_at: string;
  is_you: boolean;
}

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';

/**
 * Where a ticket stands against its deadline (category SLA hours after it was raised).
 * ON_TRACK / AT_RISK (last quarter) / OVERDUE while unresolved; MET / BREACHED once
 * the work is done; NOT_APPLICABLE for withdrawn or rejected tickets.
 */
export type SlaStatus = 'ON_TRACK' | 'AT_RISK' | 'OVERDUE' | 'MET' | 'BREACHED' | 'NOT_APPLICABLE';

export type TicketScope = 'ROOM' | 'COMMON_AREA';

export type AssignmentState =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'DECLINED';

export type Specialization =
  | 'CLEANING'
  | 'ELECTRICIAN'
  | 'CARPENTER'
  | 'AC_TECH'
  | 'PLUMBER';

export interface User {
  user_id: string;
  reg_or_emp_id: string;
  full_name: string;
  email?: string;
  phone_number?: string;
  role: Role;
  specialization?: Specialization | null;
  /** Technicians: the block they are based in (auto-dispatch prefers it). */
  home_block_id?: string | null;
  /** Supervisors: the blocks they look after (they only see tickets there). */
  managed_blocks?: string[] | null;
  is_available?: boolean;
  is_active?: boolean;
  created_at?: string;
  last_login_at?: string | null;
  /** Set while the account is locked after repeated failed sign-ins. */
  locked_until?: string | null;
}

export interface CreateUserPayload {
  reg_or_emp_id: string;
  full_name: string;
  email: string;
  phone_number: string;
  password: string;
  role: Role;
  specialization?: Specialization | null;
}

export interface AdminAllotment {
  allotment_id: number;
  student_id: string;
  reg_or_emp_id: string;
  full_name: string;
  room_id: string;
  block_id: string;
  room_number: string;
  floor_number: number;
  bed_capacity: number;
  academic_year: string;
  assigned_date: string;
}

/** The three separate sign-in portals. */
export type Portal = 'student' | 'staff' | 'admin';

export interface AuthResponse {
  token: string;
  portal: Portal;
  user: User;
}

export type RoomType = 'AC' | 'NON_AC' | 'DELUXE_AC';

export interface AdminBlock {
  block_id: string;
  block_code: string;
  block_name: string;
  total_floors: number;
  floor_count: number;
  room_count: number;
  active_room_count: number;
  total_beds: number;
  occupied_beds: number;
}

export interface BlockFloor {
  floor_number: number;
  floor_code: string;
  room_count: number;
  common_area_count: number;
}

export interface AdminRoom {
  room_id: string;
  block_id: string;
  room_number: string;
  floor_number: number;
  room_type: RoomType;
  bed_capacity: number;
  is_active: boolean;
  occupied_beds: number;
}

export interface RegisterPayload {
  reg_or_emp_id: string;
  full_name: string;
  email: string;
  phone_number: string;
  password: string;
  /** The room asked for. A request only: the hostel office allots the room. */
  block_id?: string;
  floor_number?: number;
  room_id?: string;
}

export interface RoomRequest {
  status: 'PENDING' | 'DECLINED';
  block_id: string;
  floor_number: number;
  room_id: string;
  requested_at: string;
  decline_reason: string | null;
}

export interface PendingAllotmentRequest {
  audit_id: number;
  requested_at: string;
  student_id: string;
  reg_or_emp_id: string;
  full_name: string;
  email: string;
  room_id: string;
  block_id: string;
  floor_number: number;
  room_number: string;
  bed_capacity: number;
  occupied_beds: number;
}

export interface CreateComplaintPayload {
  ticket_scope: TicketScope;
  room_id?: string | null;
  common_area_id?: string | null;
  block_id: string;
  subcategory_id: number;
  description?: string | null;
  photo_evidence_url?: string | null;
  priority?: Priority;
  preferred_timeslot?: string | null;
}

export interface Complaint {
  complaint_id: string;
  ticket_scope: TicketScope;
  room_id: string | null;
  common_area_id: string | null;
  block_id: string;
  raised_by_user_id: string;
  subcategory_id: number;
  description: string | null;
  photo_evidence_url: string | null;
  status: ComplaintStatus;
  priority: Priority;
  preferred_timeslot: string | null;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  /** Deadline: created_at + the category's SLA hours. */
  sla_due_at?: string | null;
  sla_status?: SlaStatus;
  default_sla_hours?: number;
  category_name: string;
  issue_name: string;
  required_specialization: Specialization;
  student_name: string;
  /** Technician currently (or most recently) holding the ticket. */
  assigned_staff_id?: string | null;
  assigned_staff_name?: string | null;
  closure_reason?: ClosureReason | null;
  closure_note?: string | null;
  merged_into_id?: string | null;
  merged_into_ref?: string;
  /** How many people reported this issue (the room / area is the unit, not the person). */
  reporter_count?: number;
  /** The signed-in user reported it. */
  is_reporter?: boolean;
  /** The signed-in user currently lives in the ticket's room. */
  is_room_resident?: boolean;
  can_verify?: boolean;
  can_withdraw?: boolean;
  /** Detail view only, and only where names may be shown. */
  reporters?: Reporter[];
}

export interface CreateComplaintResult {
  /** true: the issue was already open here and the caller was added to that ticket. */
  joined: boolean;
  message: string;
  complaint: Complaint;
}

export interface ComplaintLogEntry {
  log_id: number;
  previous_status: ComplaintStatus | null;
  new_status: ComplaintStatus;
  action_note: string | null;
  timestamp: string;
  changed_by_name: string | null;
}

export interface Allotment {
  room_id: string;
  block_id: string;
  room_number: string;
  floor_number: number;
  room_type: string;
  academic_year: string;
  assigned_date: string;
}

export interface StaffTask {
  assignment_id: string;
  staff_user_id: string;
  staff_name: string;
  specialization: Specialization;
  complaint_id: string;
  ticket_scope: TicketScope;
  location_identifier: string;
  floor_number: number;
  priority: Priority;
  category_name: string;
  issue_name: string;
  status: ComplaintStatus;
  assignment_state: AssignmentState;
  assigned_at: string;
  student_name: string;
  student_phone?: string;
  sla_due_at?: string | null;
  sla_status?: SlaStatus;
}

export interface FeedbackPayload {
  complaint_id: string;
  is_satisfied: boolean;
  rating?: number | null;
  comments?: string | null;
}

export interface BlockKpi {
  block_id: string;
  block_name: string;
  total_complaints: string | number;
  pending_complaints: string | number;
  active_in_progress: string | number;
  awaiting_student_verification: string | number;
  resolved_count: string | number;
  escalated_count: string | number;
  common_area_issues: string | number;
  average_student_rating: string | number;
  overdue_count?: string | number;
  at_risk_count?: string | number;
  sla_met_count?: string | number;
  sla_breached_count?: string | number;
  /** % of finished work done within its SLA; null when nothing has finished yet. */
  sla_compliance_pct?: string | number | null;
}

export interface Hotspot {
  block_id: string;
  ticket_scope: TicketScope;
  asset_location: string;
  category_name: string;
  incident_count_14_days: string | number;
  most_recent_incident: string;
}

export interface HostelBlock {
  block_id: string;
  block_name: string;
  total_floors?: number;
}

export interface Room {
  room_id: string;
  block_id: string;
  room_number: string;
  floor_number: number;
  room_type?: string;
  bed_capacity?: number;
  is_active: boolean;
}

export interface Subcategory {
  subcategory_id: number;
  issue_name: string;
  priority_level: Priority;
  required_specialization: Specialization;
}

export interface Category {
  category_id: number;
  category_name: string;
  category_code: string;
  is_quick_action: boolean;
  subcategories: Subcategory[];
}

export interface StaffRosterItem {
  user_id: string;
  full_name: string;
  specialization: Specialization;
  home_block_id?: string | null;
  is_available: boolean;
  active_task_count: number;
}

export interface CommonAreaItem {
  area_id: string;
  block_id: string;
  floor_number: number;
  area_type: string;
  description: string;
  is_operational: boolean;
}

export interface TimelineEvent {
  title: string;
  description: string;
  timestamp: string;
  status: 'completed' | 'current' | 'pending';
}

export interface AuditEntry {
  audit_id: number;
  occurred_at: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  request_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_reg_or_emp_id: string | null;
  target_name: string | null;
}

export interface UserSummary {
  all: number;
  student: number;
  staff: number;
  supervisor: number;
  admin: number;
  locked: number;
  deactivated: number;
}
