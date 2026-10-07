import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/**
 * One shared QueryClient, exported so the auth layer can wipe every cached
 * response on sign-in/sign-out. Otherwise the next user on the same browser
 * tab briefly sees the previous user's complaints from cache.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30,
      // Retrying a 4xx can't help (bad input, forbidden, not found); only
      // retry network failures and 5xx.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});
