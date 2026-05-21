import { useState, useEffect } from 'react';
import { useAuth } from '../lib/useAuth';
import { motion } from 'motion/react';
import { Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface WatchlistItem {
  id: string;
  ticker: string;
  status: string;
}

export function Target() {
  const { user, loading, isConnected } = useAuth();
  const [ticker, setTicker] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [fetching, setFetching] = useState(true);

  const BACKEND_URL = "/api/analyze";

  const fetchWatchlist = async () => {
    if (!supabase || !user) return;
    const { data, error } = await supabase
      .from('watchlist')
      .select('id, ticker, status')
      .eq('user_id', user.id)
      .order('last_updated', { ascending: false });
    
    if (data && !error) {
      setWatchlist(data);
    }
    setFetching(false);
  };

  useEffect(() => {
    if (!user) { setFetching(false); return; }
    if (!supabase) { setFetching(false); return; }

    fetchWatchlist();

    // Include user.id in channel name to avoid Supabase cache collisions in StrictMode
    const channel = supabase
      .channel(`target-watchlist-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'watchlist', filter: `user_id=eq.${user.id}` },
        fetchWatchlist
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim() || !supabase || !user) return;
    
    setSubmitted(true);
    
    // 1. Insert into Supabase
    const { data, error } = await supabase.from('watchlist').insert([{ 
      ticker: ticker.toUpperCase(), 
      user_id: user.id,
      status: 'idle'
    }]).select().single();

    if (error) {
      console.error('Error inserting target:', error);
      setSubmitted(false);
      return;
    }

    if (data) {
      // 2. Trigger the Signal-to-Action Orchestrator (Backend)
      // We use the absolute BACKEND_URL to ensure it hits the Cloudflare Worker
      try {
        fetch(BACKEND_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ticker: data.ticker,
            user_id: user.id,
            row_id: data.id
          })
        });
        // We do not await this fetch because the backend 
        // sends a 202 and continues in the background.
      } catch (err) {
        console.error("Failed to trigger orchestrator:", err);
      }

      await fetchWatchlist();
    }

    setTicker('');
    setSubmitted(false);
  };

  const handleDelete = async (id: string) => {
    if (!supabase) return;
    await supabase.from('watchlist').delete().eq('id', id);
    await fetchWatchlist();
  };

  if (loading || fetching) {
    return <div className="flex justify-center items-center h-64 text-terra-muted uppercase tracking-widest text-sm font-bold">Checking access...</div>;
  }

  if (isConnected && !user) {
    return (
      <div className="flex flex-col justify-center items-center h-[50vh] space-y-6">
        <h2 className="text-xl font-sans font-bold tracking-[0.2em] uppercase text-terra-ink">Module Locked</h2>
        <p className="text-sm font-medium text-terra-muted tracking-wide max-w-md text-center">
          Authentication required. Please sign in via the Overview dashboard to insert target companies.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 mb-36 mt-16 md:mt-32 space-y-20">
      <div className="max-w-xl w-full">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="bg-white/70 backdrop-blur-xl border border-terra-border rounded-[2.5rem] p-10 md:p-14 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.06)] text-center relative overflow-hidden"
        >
          <h3 className="text-[10px] font-bold tracking-[0.35em] text-terra-muted uppercase mb-10">
            Establish New Target
          </h3>

          <form onSubmit={handleSubmit} className="flex flex-col items-center space-y-7">
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="ENTER TICKER"
              className="w-full max-w-sm bg-terra-bg/60 border border-terra-border rounded-2xl px-6 py-5 text-center text-2xl font-mono uppercase tracking-[0.35em] placeholder:text-terra-muted/35 focus:outline-none focus:border-terra-ink focus:ring-1 focus:ring-terra-ink transition-all"
            />

            <button
              type="submit"
              disabled={submitted || !ticker.trim()}
              className="bg-terra-ink text-white px-10 py-4 rounded-full text-[10px] font-bold tracking-[0.25em] uppercase hover:bg-terra-ink/80 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitted ? 'COMMENCING...' : 'COMMENCE SCAN'}
            </button>
          </form>
        </motion.div>
      </div>

      <div className="max-w-xl w-full">
        <h3 className="text-[10px] font-bold tracking-[0.35em] text-terra-ink uppercase mb-8 pl-3 border-l-2 border-terra-ink">
          Watchlist
        </h3>
        <div className="space-y-3">
          {watchlist.length === 0 ? (
            <div className="text-terra-muted font-mono text-sm pl-3 py-4">No targets tracking.</div>
          ) : (
            watchlist.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between bg-white/60 border border-terra-border px-6 py-5 rounded-2xl hover:bg-white/80 transition-colors duration-300"
              >
                <div className="flex items-center gap-5">
                  <span className="font-mono text-lg font-bold tracking-[0.25em]">{item.ticker}</span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em] px-3 py-1.5 bg-terra-surface text-terra-muted rounded-full">
                    {item.status}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="text-terra-muted hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"
                  aria-label="Remove from watchlist"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
