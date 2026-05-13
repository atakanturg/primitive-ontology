import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Signal {
  id: string;
  ticker?: string;
  status: 'idle' | 'scanning' | 'updated';
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  reasoning: string;
  last_updated: string; 
  last_analyzed_at?: string; 
}

export function Home() {
  const [signal, setSignal] = useState<Signal | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (supabase) {
      setIsConnected(true);
      
      const fetchInitial = async () => {
        const { data, error } = await supabase
          .from('watchlist')
          .select('*')
          .order('last_updated', { ascending: false })
          .limit(1)
          .single();
          
        if (data && !error) {
          setSignal(data as Signal);
          setLastUpdated(new Date(data.last_updated));
        }
      };
      
      fetchInitial();

      const channel = supabase
        .channel('schema-db-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'watchlist',
          },
          (payload) => {
            const newSignal = payload.new as Signal;
            setSignal(newSignal);
            setLastUpdated(new Date(newSignal.last_updated));
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
    // Mock logic removed for real data integrity
  }, []);

  if (!signal) return null;

  return (
    <section className="relative flex flex-col items-center justify-center px-4 overflow-hidden mt-6 mb-24">
      <div className="max-w-4xl w-full z-10 space-y-8 flex flex-col items-center">
        
        {!isConnected && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-full border border-red-200 text-xs font-medium tracking-wide"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Database Connection Required.</span>
          </motion.div>
        )}

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="w-full bg-white/70 backdrop-blur-xl border border-terra-border rounded-[2rem] p-8 md:p-12 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.05)] overflow-hidden relative"
        >
          <div className="absolute inset-0 opacity-[0.03] bg-[url('/noise.svg')] pointer-events-none mix-blend-overlay"></div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 relative z-10">
            <div className="space-y-10">
              <div className="space-y-4">
                <h3 className="text-[10px] font-bold tracking-[0.3em] text-terra-muted uppercase">Target Asset</h3>
                <div className="flex items-center gap-4">
                  <span className="text-3xl font-mono tracking-widest text-terra-ink">
                    {signal.ticker || 'SYS'}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-bold tracking-[0.3em] text-terra-muted uppercase">System Status</h3>
                <div className="flex items-center gap-4">
                  <div className="relative flex h-4 w-4">
                    {signal.status === 'scanning' && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-4 w-4 ${
                      signal.status === 'idle' ? 'bg-gray-400' :
                      signal.status === 'scanning' ? 'bg-blue-500' :
                      'bg-green-500'
                    }`}></span>
                  </div>
                  <span className="text-2xl font-serif tracking-wide capitalize text-terra-ink">
                    {signal.status}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-bold tracking-[0.3em] text-terra-muted uppercase">Last Scan Time</h3>
                <div className="flex items-center gap-3 text-terra-ink/80">
                  <span className="font-mono text-sm tracking-tight">
                    {signal.last_analyzed_at ? new Date(signal.last_analyzed_at).toLocaleString('en-US', { 
                      hour12: false, fractionalSecondDigits: 3
                    }) : lastUpdated?.toLocaleString('en-US', { 
                      hour12: false, fractionalSecondDigits: 3
                    })}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-10">
              <div className="space-y-4">
                <h3 className="text-[10px] font-bold tracking-[0.3em] text-terra-muted uppercase">Market Sentiment</h3>
                <div className="flex items-center gap-4">
                  <span className={`text-4xl font-serif tracking-tight ${
                    signal.sentiment === 'Bullish' ? 'text-green-700' :
                    signal.sentiment === 'Bearish' ? 'text-red-700' :
                    'text-gray-700'
                  }`}>
                    {signal.sentiment}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-bold tracking-[0.3em] text-terra-muted uppercase">Causal Reasoning</h3>
                <AnimatePresence mode="popLayout">
                  <motion.p 
                    key={signal.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-lg md:text-xl text-terra-ink leading-relaxed font-serif italic"
                  >
                    "{signal.reasoning}"
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
