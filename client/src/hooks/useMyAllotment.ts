import { useQuery } from '@tanstack/react-query';
import { meApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { Allotment } from '../types';

/**
 * The signed-in student's current room, straight from the server.
 * `allotment` is null when the hostel office hasn't allotted a room yet
 * (the API answers 404). Room tickets can only be raised for this room, so
 * the UI never lets a student pick one.
 */
export function useMyAllotment(enabled = true) {
  const query = useQuery<Allotment | null>({
    queryKey: ['my-allotment'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        return await meApi.getMyAllotment();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
  return { allotment: query.data ?? null, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}
