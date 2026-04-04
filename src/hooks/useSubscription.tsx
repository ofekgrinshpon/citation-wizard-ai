import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const FREE_LIMIT = 3;

export function useSubscription() {
  const { user } = useAuth();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [citationCount, setCitationCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("is_subscribed, citation_count")
      .eq("id", user.id)
      .single();
    if (data) {
      setIsSubscribed(data.is_subscribed ?? false);
      setCitationCount(data.citation_count ?? 0);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const isLimitReached = !isSubscribed && citationCount >= FREE_LIMIT;
  const remaining = isSubscribed ? Infinity : Math.max(0, FREE_LIMIT - citationCount);

  const incrementCount = useCallback(async (amount = 1) => {
    for (let i = 0; i < amount; i++) {
      await supabase.rpc("increment_citation_count");
    }
    setCitationCount((prev) => prev + amount);
  }, []);

  return {
    isSubscribed,
    citationCount,
    isLimitReached,
    remaining,
    incrementCount,
    refresh: fetch,
    loading,
    limit: FREE_LIMIT,
  };
}
