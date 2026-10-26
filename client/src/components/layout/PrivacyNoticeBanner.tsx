import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { meApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { Alert } from '../ui/Alert';

/**
 * Shown to a resident whose consent is for an older version of the privacy
 * notice: read the new one, then save the profile to accept it.
 */
export const PrivacyNoticeBanner: React.FC = () => {
  const { user } = useAuth();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: meApi.getMe, enabled: user?.role === 'STUDENT' });
  if (user?.role !== 'STUDENT' || !me?.privacy_notice_outdated) return null;
  return (
    <Alert
      tone="info"
      className="mb-6"
      title="The privacy notice has changed"
      action={
        <Link to="/onboarding" className="whitespace-nowrap text-[13px] font-medium text-brand-700 hover:underline">
          Review and accept
        </Link>
      }
    >
      Please <Link to="/privacy" className="font-medium underline">read the new notice</Link> and accept it by saving your profile. Everything keeps working in the meantime.
    </Alert>
  );
};
