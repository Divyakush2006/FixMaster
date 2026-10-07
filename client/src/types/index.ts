export type Role = 'STUDENT' | 'STAFF' | 'SUPERVISOR' | 'ADMIN';

export type ComplaintStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'PENDING_VERIFICATION'
  | 'COMPLETED'
  | 'ESCALATED'
  | 'REJECTED';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';

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
  category_name: string;
  issue_name: string;
  required_specialization: Specialization;
  student_name: string;
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
