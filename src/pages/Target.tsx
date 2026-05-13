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
    if (user) {
      fetchWatchlist();
      
      if (supabase) {
        const channel = supabase
          .channel('target-watchlist-changes')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'watchlist',
              filter: `user_id=eq.${user.id}`
            },
            () => {
              fetchWatchlist();
            }
          )
          .subscribe();

        return () => {
          supabase.removeChannel(channel);
        };
      }
    } else {
      setFetching(false);
    }
  }, [user]);

  if (loading || fetching) {
    return <div className="flex justify-center items-center h-64 text-terra-muted uppercase tracking-widest text-sm font-bold">Checking access...</div>;
  }

  // If Supabase is connected but no user is found, block access
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim()) return;
    
    // Process input
    setSubmitted(true);
    
    // Option to push to supabase table here if needed
    if (supabase && user) {
      const { data, error } = await supabase.from('watchlist').insert([{ 
        ticker: ticker.toUpperCase(), 
        user_id: user.id,
        status: 'idle'
      }]).select().single();

      if (error) {
        console.error('Error inserting target:', error);
        if (error.code === '23505') {
          // Unique constraint violation handled silently or gracefully
          setTicker('');
        }
      } else if (data) {
        // Trigger the signal-to-action orchestrator on the backend
        try {
          fetch('/api/analyze', {
            method: 'POST',
            headers: {
               'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              ticker: data.ticker,
              user_id: data.user_id,
              row_id: data.id
            })
          });
        } catch (err) {
          console.error("Failed to trigger orchestrator:", err);
        }

        await fetchWatchlist();
      }
    }

    setTicker('');
    setSubmitted(false);
  };

  const handleDelete = async (id: string) => {
    if (!supabase) return;
    await supabase.from('watchlist').delete().eq('id', id);
    await fetchWatchlist();
  };

  return (
    <div className="flex flex-col items-center px-4 mb-24 mt-12 md:mt-24 space-y-16">
      <div className="max-w-xl w-full">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/70 backdrop-blur-xl border border-terra-border rounded-[2rem] p-8 md:p-12 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.05)] text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] pointer-events-none mix-blend-overlay"></div>
          
          <h3 className="text-xs font-bold tracking-[0.3em] text-terra-muted uppercase mb-8">Establish New Target</h3>
          
          <form onSubmit={handleSubmit} className="flex flex-col items-center space-y-6 relative z-10">
            <input 
              type="text" 
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="ENTER TICKER"
              className="w-full max-w-sm bg-terra-bg/50 border border-terra-border rounded-xl px-4 py-4 text-center text-xl font-mono uppercase tracking-[0.3em] placeholder:text-terra-muted/40 focus:outline-none focus:border-terra-ink focus:ring-1 focus:ring-terra-ink transition-all"
            />
            
            <button 
              type="submit" 
              disabled={submitted || !ticker.trim()}
              className="bg-terra-ink text-white px-8 py-3 rounded-full text-xs font-bold tracking-[0.2em] uppercase hover:bg-terra-ink/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitted ? 'COMMENCING...' : 'COMMENCE SCAN'}
            </button>
          </form>
        </motion.div>
      </div>

      <div className="max-w-xl w-full">
        <h3 className="text-sm font-bold tracking-[0.3em] text-terra-ink uppercase mb-6 pl-2 border-l-2 border-terra-ink">Watchlist</h3>
        <div className="space-y-3">
          {watchlist.length === 0 ? (
             <div className="text-terra-muted font-mono text-sm pl-2">No targets tracking.</div>
          ) : (
            watchlist.map(item => (
              <div key={item.id} className="flex items-center justify-between bg-white/50 border border-terra-border p-4 rounded-xl">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-lg font-bold tracking-widest">{item.ticker}</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-terra-surface text-terra-muted rounded-full">
                    {item.status}
                  </span>
                </div>
                <button 
                  onClick={() => handleDelete(item.id)} 
                  className="text-terra-muted hover:text-red-500 transition-colors p-2"
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
