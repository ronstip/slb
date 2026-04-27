import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createBriefingShare,
  getBriefingShare,
} from '../../api/endpoints/briefings.ts';

/**
 * Resolve (or lazily create) a briefing's public share link, then open it
 * in a new tab. Used by the Deliverables surfaces — owners view their own
 * briefing through the same shared URL guests would.
 */
export function useOpenBriefingShare(agentId: string, title: string) {
  const queryClient = useQueryClient();
  const [isOpening, setIsOpening] = useState(false);

  const open = useCallback(async () => {
    setIsOpening(true);
    try {
      let share = await getBriefingShare(agentId);
      if (!share) {
        share = await createBriefingShare({ agent_id: agentId, title });
      }
      queryClient.setQueryData(['briefing-share', agentId], share);
      window.open(share.share_url, '_blank', 'noopener');
    } finally {
      setIsOpening(false);
    }
  }, [agentId, title, queryClient]);

  return { open, isOpening };
}
