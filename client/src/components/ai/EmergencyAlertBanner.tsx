import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  advisory: string;
}

export const EmergencyAlertBanner: React.FC<Props> = ({ advisory }) => {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-xl border border-rose-300 bg-rose-50/90 p-4 shadow-sm backdrop-blur transition-all motion-safe:animate-pulse"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-rose-500 p-1.5 text-white shadow-sm">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-rose-900">
            EMERGENCY PRIORITY DETECTED
          </h4>
          <p className="mt-1 text-sm text-rose-700">
            {advisory || 'Immediate attention required. Technical and emergency response dispatched.'}
          </p>
        </div>
      </div>
    </div>
  );
};
