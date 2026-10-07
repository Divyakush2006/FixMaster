/**
 * Maps raw PostgreSQL or server error messages to user-friendly copy.
 */
export function mapApiError(rawError: unknown): string {
  if (!rawError) return 'An unexpected error occurred. Please try again.';

  const message = typeof rawError === 'string'
    ? rawError
    : (rawError as { error?: string; message?: string }).error ||
      (rawError as { message?: string }).message ||
      '';

  if (!message) return 'An unexpected error occurred. Please try again.';

  // PostgreSQL constraint error mappings
  if (message.includes('23505') || message.includes('already exists')) {
    if (message.includes('email') || message.includes('reg_or_emp_id')) {
      return 'An account with this Register/Employee ID or Email already exists.';
    }
    if (message.includes('complaint_feedback')) {
      return 'Feedback has already been submitted for this complaint.';
    }
    return 'A duplicate record already exists in the system.';
  }

  if (message.includes('violates not-null constraint')) {
    if (message.includes('block_id')) {
      return 'Hostel block is required. Please select a valid hostel block.';
    }
    if (message.includes('room_id')) {
      return 'Room selection is required for room complaints.';
    }
    if (message.includes('common_area_id')) {
      return 'Common area selection is required.';
    }
    return 'Please fill in all required fields.';
  }

  if (message.includes('Unauthorized: User') && message.includes('did not raise complaint')) {
    return 'You are only authorized to submit feedback for complaints you raised yourself.';
  }

  if (message.includes('Invalid credentials')) {
    return 'The ID or password is incorrect. Check both and try again.';
  }

  if (message.includes('JWT') || message.includes('expired') || message.includes('token')) {
    return 'Your session has expired. Please log in again.';
  }

  // Return formatted message if it looks clean, otherwise generic fallback
  if (message.length <= 240 && !message.toLowerCase().includes('violates') && !message.toLowerCase().includes('postgres')) {
    return message;
  }

  return 'Operation failed. Please review your input and try again.';
}
