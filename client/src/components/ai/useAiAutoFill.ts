import { useState } from 'react';
import { aiApi } from '../../api/endpoints';
import { AiTriageResult, AiAllocationPreview } from '../../types';

interface UseAiAutoFillOptions {
  onSuccess?: (triage: AiTriageResult, preview: AiAllocationPreview | null) => void;
  onError?: (err: Error) => void;
}

export function useAiAutoFill(options?: UseAiAutoFillOptions) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triageResult, setTriageResult] = useState<AiTriageResult | null>(null);
  const [allocationPreview, setAllocationPreview] = useState<AiAllocationPreview | null>(null);

  const autoFillFromText = async (rawText: string, studentRoom?: string | null) => {
    if (!rawText || !rawText.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // 1. Call parse-and-triage
      const triageRes = await aiApi.parseAndTriage({
        raw_text: rawText,
        student_allotment_room: studentRoom,
      });

      const triageData = triageRes.data;
      setTriageResult(triageData);

      // 2. Load allocation preview
      let previewData: AiAllocationPreview | null = null;
      try {
        const allocRes = await aiApi.previewAllocation({
          category_id: triageData.category_id,
          subcategory_id: triageData.subcategory_id,
          priority: triageData.priority,
        });
        previewData = allocRes.data;
        setAllocationPreview(previewData);
      } catch (allocErr) {
        console.warn('Could not load technician allocation preview:', allocErr);
      }

      if (options?.onSuccess) {
        options.onSuccess(triageData, previewData);
      }
    } catch (err: any) {
      const msg = err.message || 'AI Auto-Fill encountered an error.';
      setError(msg);
      if (options?.onError) {
        options.onError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  return {
    autoFillFromText,
    loading,
    error,
    triageResult,
    allocationPreview,
    clear: () => {
      setTriageResult(null);
      setAllocationPreview(null);
      setError(null);
    },
  };
}
