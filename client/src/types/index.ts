export type Role = 'STUDENT' | 'STAFF' | 'SUPERVISOR' | 'CHIEF_WARDEN' | 'ADMIN';

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
  is_available?: boolean;
  is_active?: boolean;
  created_at?: string;
  last_login_at?: string | null;
  /** Set while the account is locked after repeated failed sign-ins. */
  locked_until?: string | null;
  /** Self-registered students go PENDING_VERIFICATION -> PENDING_PROFILE -> ACTIVE. */
  account_status?: AccountStatus;
  email_verified_at?: string | null;
  /** GET /me only: whether a student has saved their resident profile. */
  profile_complete?: boolean;
  /** Staff: the block they are based in (null = campus pool) and their shift. */
  home_block_id?: string | null;
  shift?: StaffShift | null;
  /** Supervisors (admin user list): blocks they manage; empty = every block. */
  managed_blocks?: string[] | null;
  /** When this person asked for their data to be erased; null when they have not. */
  erasure_requested_at?: string | null;
}

export interface ErasureRequest {
  user_id: string;
  reg_or_emp_id: string;
  full_name: string;
  email: string;
  erasure_requested_at: string;
  /** What stops the erasure right now (room still allotted, open tickets). */
  blockers: string[];
}

export type StaffShift = 'MORNING' | 'EVENING' | 'NIGHT';
export type HostelType = 'MENS' | 'LADIES';

export interface StaffLeave {
  leave_id: number;
  staff_user_id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
}

export type AccountStatus = 'PENDING_VERIFICATION' | 'PENDING_PROFILE' | 'ACTIVE';

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNDISCLOSED';
export type CleaningSlot = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANY';
export type AssistantLanguage = 'en' | 'hi' | 'ta' | 'te';
export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

/** The resident record a student completes at first sign-in. */
export interface StudentProfileFields {
  school: string;
  programme: string;
  admission_year: number;
  expected_graduation_year: number;
  gender: Gender;
  date_of_birth: string;
  guardian_name: string;
  guardian_relation: string;
  guardian_phone: string;
  local_guardian_name?: string | null;
  local_guardian_phone?: string | null;
  permanent_city: string;
  permanent_state: string;
  permanent_pincode: string;
  preferred_cleaning_slot: CleaningSlot;
  preferred_language: AssistantLanguage;
  health_consent: boolean;
  blood_group?: BloodGroup | null;
  medical_notes?: string | null;
}

export interface StudentProfile extends StudentProfileFields {
  user_id: string;
  privacy_notice_version: string;
  privacy_consented_at: string;
  completed_at: string;
  updated_at: string;
}

export interface StudentProfileInput extends StudentProfileFields {
  privacy_consent: boolean;
  privacy_notice_version: string;
}

/** What this deployment supports, for the public pages. */
export interface AuthCapabilities {
  password_reset: boolean;
  student_signup?: boolean;
  student_email_domains?: string[];
  privacy_notice_version?: string;
}

export interface RegisterResponse {
  message: string;
  user: User;
  room_request: RoomRequest | null;
  /** Where the code went (masked) and how long it works. */
  verification: { email: string; expires_in_minutes: number };
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
  portal: Portal;
  user: User;
  /** When the cookie session ends (ISO time). The token itself is only ever in an HttpOnly cookie. */
  expires_at: string;
}

export type RoomType = 'AC' | 'NON_AC' | 'DELUXE_AC';

export interface AdminBlock {
  block_id: string;
  block_code: string;
  block_name: string;
  hostel_type: HostelType;
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

/** A derived in-app notification (no stored read state; see the server's notificationFeed). */
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  complaint_id: string | null;
  created_at: string;
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
  ai_priority_reasoning?: string | null;
  ai_safety_advisory?: string | null;
  ai_decided?: boolean;
}

/** One ticket draft from the request assistant. Priority is the issue's catalogue value, shown for information. */
export interface AssistantDraft {
  ticket_scope: TicketScope;
  block_id: string | null;
  room_id: string | null;
  common_area_id: string | null;
  common_area_name: string | null;
  category_id: number;
  category_name: string;
  subcategory_id: number;
  issue_name: string;
  required_specialization: Specialization;
  priority: Priority;
  description: string;
  confidence: number | null;
  safety_advice: string | null;
  /** What the student still has to do: ROOM_ALLOTMENT, CHOOSE_AREA. */
  needs: ('ROOM_ALLOTMENT' | 'CHOOSE_AREA')[];
  existing_ticket: { complaint_id: string; status: ComplaintStatus } | null;
  review_hint: string | null;
}

export interface AssistantResponse {
  source: 'ai' | 'rules';
  drafts: AssistantDraft[];
  clarification: string | null;
  notice: string | null;
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
  /** Deadline: created_at + the category's SLA hours (computed by the API). */
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
  /** True for someone who reported this ticket while it is still open: they may add, replace or remove its photo. */
  can_attach_photo?: boolean;
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
  hostel_type?: HostelType;
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
  chief_warden: number;
  admin: number;
  locked: number;
  deactivated: number;
}

export interface AiProviderHealth {
  provider: string;
  configured: boolean;
  breaker_open: boolean;
  used_today: number;
  daily_limit: number;
  ok_last_hour: number;
  failed_last_hour: number;
  last_ok_at: string | null;
  last_error: string | null;
}

export interface AiHealthStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'DISABLED';
  /** Set while a chief warden or administrator is running an outage drill. */
  drill: { active: boolean; reason: string | null; since: string | null } | null;
  providers: AiProviderHealth[];
  routes: Record<string, { provider: string; model: string }[]>;
}


// ---- Autopilot -----------------------------------------------------------------

export type AutopilotMode = 'OFF' | 'SUGGEST' | 'AUTO';
export type ScoreComponent = 'quality' | 'load' | 'idle' | 'proximity' | 'reliability' | 'roomHistory';

export interface AutopilotCandidate {
  user_id: string;
  full_name: string;
  score: number;
  components: Record<ScoreComponent, number>;
  weights: Record<ScoreComponent, number>;
  live_jobs: number;
  rated_jobs: number;
  home_block_id: string | null;
}

export type ExclusionReason = 'OFF_DUTY' | 'ON_LEAVE' | 'OFF_SHIFT' | 'OTHER_BLOCK' | 'AT_CAPACITY' | 'BAD_EXPERIENCE_HERE' | 'BLOCK_STAFF_AVAILABLE';

export interface AutopilotSuggestions {
  ticket: { complaint_id: string; status: ComplaintStatus; block_id: string; specialization: Specialization };
  settings: { mode: AutopilotMode; live_job_cap: number; weights: Record<ScoreComponent, number>; inherited: boolean };
  shift: StaffShift;
  recovery: boolean;
  candidates: AutopilotCandidate[];
  excluded: { user_id: string; full_name: string; reason: ExclusionReason }[];
}

export interface AutopilotDispatchResult {
  assigned: boolean;
  staff_user_id?: string;
  staff_name?: string;
  score?: number;
  recovery?: boolean;
  reason?: string;
}

export interface AutopilotSetting {
  block_id: string | null;
  specialization: Specialization;
  mode: AutopilotMode;
  live_job_cap: number;
  weights: Record<ScoreComponent, number>;
  updated_at?: string;
  updated_by?: string | null;
}

export interface AutopilotSettingsResponse {
  defaults: { mode: AutopilotMode; live_job_cap: number; weights: Record<ScoreComponent, number> };
  settings: AutopilotSetting[];
  can_edit_campus_default: boolean;
}

export type PerformanceFlagCode = 'LOW_RATING' | 'HIGH_REWORK' | 'MISSED_SLA' | 'LONG_IDLE';

export interface StaffPerformanceRow {
  user_id: string;
  full_name: string;
  reg_or_emp_id: string;
  specialization: Specialization;
  home_block_id: string | null;
  shift: StaffShift | null;
  is_available: boolean;
  rated_jobs: number;
  avg_rating: number | null;
  smoothed_rating: number | null;
  verification_rounds: number;
  sent_back: number;
  rework_rate: number;
  completed: number;
  on_time: number;
  on_time_rate: number | null;
  avg_minutes: number | null;
  live_jobs: number;
  last_assigned_at: string | null;
  comment_tags: Record<string, number>;
  flags: { code: PerformanceFlagCode; evidence: string }[];
}

export interface CleaningPlan {
  block_id: string;
  shift: StaffShift;
  total_rooms: number;
  cleaners: { user_id: string; full_name: string; floors: number[]; rooms: number; slots: { MORNING: number; AFTERNOON: number; EVENING: number } }[];
  unassigned_floors: number[];
  uses_campus_pool: boolean;
}

// ---- Insights --------------------------------------------------------------------

export interface InsightsTotals {
  blocks: number;
  open_tickets: number;
  unassigned: number;
  overdue: number;
  at_risk: number;
  emergencies: number;
  raised_24h: number;
}

export interface InsightsBlockRow {
  block_id: string;
  block_name: string;
  open_tickets: number;
  unassigned: number;
  overdue: number;
  at_risk: number;
  emergencies: number;
  raised_24h: number;
  avg_rating_30d: number | null;
}

export interface InsightsOverview {
  totals: InsightsTotals;
  blocks: InsightsBlockRow[];
}

export interface BreachRiskTicket {
  complaint_id: string;
  block_id: string;
  priority: Priority;
  status: string;
  category_name: string;
  issue_name: string;
  location: string | null;
  sla_status: 'OVERDUE' | 'AT_RISK';
  due_at: string;
  hours_left: number;
  assigned_to: string | null;
}

export interface RecurringFault {
  block_id: string;
  ticket_scope: 'ROOM' | 'COMMON_AREA';
  location: string | null;
  category_name: string;
  incidents: number;
  most_recent: string;
}

export interface Briefing {
  narrative: { headline: string; highlights: string[]; actions: string[] };
  facts: { totals: InsightsTotals };
  source: 'AI' | 'RULES';
  model: string | null;
  generated_at: string;
  cached: boolean;
}

export type InsightReport = 'overview' | 'breach_risk' | 'recurring_faults' | 'category_mix' | 'unassigned';

export interface AskResult {
  answered: boolean;
  answer: string;
  source: 'AI' | 'RULES';
  report?: InsightReport;
  title?: string;
  params?: { block_id: string | null; days: number | null };
  rows?: unknown;
}

export interface BlockComparisonRow {
  block_id: string;
  block_name: string;
  tickets: number;
  urgent: number;
  met: number;
  breached: number;
  compliance_pct: number | null;
  overdue_now: number;
  escalated_now: number;
  avg_hours: number | null;
  avg_rating: number | null;
}

export interface VolumeTrend {
  weeks: { week_start: string; tickets: number; urgent: number; z: number; unusual: boolean }[];
  blocks: { block_id: string; last_7_days: number; usual_week: number; z: number }[];
}

export interface StaffingGap {
  block_id: string;
  trade: Specialization;
  staff: number;
  on_duty: number;
  pool_on_duty: number;
  open_tickets: number;
  status: 'NO_COVER' | 'POOL_ONLY' | 'STRETCHED';
}

export interface ReportResult<T> {
  report: string;
  title: string;
  answer: string;
  rows: T;
}
