/**
 * Utility functions for date formatting, number coercion, and string transformations.
 */

export function coerceNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return isNaN(value) ? fallback : value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
}

export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'N/A';

  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) return `${diffInDays}d ago`;

  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'N/A';

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function truncateId(id: string | null | undefined, length = 8): string {
  if (!id) return '';
  if (id.length <= length) return id;
  return `${id.substring(0, length)}...`;
}

/**
 * Floor/room numbering, matching the database rules (migration 004):
 * floor 0 is the Ground floor (code "G"); a room number is the floor code
 * followed by a two-digit room 01-99, e.g. G01, 428, 1007.
 */
export function floorCode(floorNumber: number): string {
  return floorNumber === 0 ? 'G' : String(floorNumber);
}

export function floorLabel(floorNumber: number | null | undefined): string {
  if (floorNumber === null || floorNumber === undefined) return 'N/A';
  return floorNumber === 0 ? 'Ground floor' : `Floor ${floorNumber}`;
}

export function roomNumberFor(floorNumber: number, seq: number): string {
  return `${floorCode(floorNumber)}${String(seq).padStart(2, '0')}`;
}
