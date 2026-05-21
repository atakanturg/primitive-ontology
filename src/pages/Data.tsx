import { useAuth } from '../lib/useAuth';
import { motion, AnimatePresence } from 'motion/react';
import { CheckSquare, Square, HelpCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Signal {
  id: string;
  ticker: string;
  status: string;
  sentiment: string;
  reasoning: string;
  last_updated: string;
  last_analyzed_at?: string;
  analysis_count?: number;
  experimental_mode?: boolean;
}

export function Data() {
  const { user, loading, isConnected } = useAuth();
  const [watchlist, setWatchlist] = useState<Signal[]>([]);
  const [fetching, setFetching] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analysisResults, setAnalysisResults] = useState<Signal[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeView, setActiveView] = useState(false);

  useEffect(() => {
    if (!supabase || !user) {
      setFetching(false);
      return;
    }

    const fetchWatchlist = async () => {
      const { data, error } = await supabase
        .from('watchlist')
        .select('*')
        .eq('user_id', user.id)
        .order('last_updated', { ascending: false });
      
      if (!error && data) {
        setWatchlist(data as Signal[]);
      }
      setFetching(false);
    };

    fetchWatchlist();

    const channel = supabase
      .channel('watchlist-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'watchlist',
          filter: `user_id=eq.${user.id}`
        },
        () => { fetchWatchlist(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  useEffect(() => {
    if (activeView) {
      setAnalysisResults(watchlist.filter(item => selectedIds.has(item.id)));
    }
  }, [watchlist, selectedIds, activeView]);

  if (loading || fetching) {
    return <div className="flex justify-center items-center h-64 text-terra-muted uppercase tracking-widest text-sm font-bold">Checking access...</div>;
  }

  if (isConnected && !user) {
    return (
      <div className="flex flex-col justify-center items-center h-[50vh] space-y-6">
        <h2 className="text-xl font-sans font-bold tracking-[0.2em] uppercase text-terra-ink">Module Locked</h2>
        <p className="text-sm font-medium text-terra-muted tracking-wide max-w-md text-center">
          Authentication required. Please sign in via the Overview dashboard to access target data records.
        </p>
      </div>
    );
  }

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
    if (selectedIds.size === 1 && selectedIds.has(id)) {
      setActiveView(false);
    }
  };

  const toggleExperimentalMode = async (e: React.MouseEvent, id: string, current: boolean) => {
    e.stopPropagation();
    if (!supabase) return;
    const newValue = !current;
    setWatchlist(prev =>
      prev.map(item => item.id === id ? { ...item, experimental_mode: newValue } : item)
    );
    await supabase
      .from('watchlist')
      .update({ experimental_mode: newValue })
      .eq('id', id);
  };

  const handleSeeAnalysis = async () => {
    if (selectedIds.size === 0) return;
    setAnalyzing(true);
    setActiveView(true);
    setAnalysisResults(watchlist.filter(item => selectedIds.has(item.id)));
    setTimeout(() => { setAnalyzing(false); }, 600);
  };

  const handleUpdateAnalysis = async (ticker: string, id: string, experimental_mode: boolean) => {
    if (!supabase) return;
    await supabase.from('watchlist').update({ status: 'scanning' }).eq('id', id);
    try {
      fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          user_id: user?.id,
          row_id: id,
          experimental_mode,
        })
      });
    } catch (err) {
      console.error("Failed to trigger update:", err);
    }
  };

  return (
    <div className="flex flex-col px-4 mb-36 mt-16 md:mt-32 max-w-5xl mx-auto w-full gap-16 text-terra-ink">
      <div className="flex flex-col md:flex-row gap-12 md:gap-16 items-start">

        {/* ── SELECT PANEL ───────────────────────────────── */}
        <div className="w-full md:w-[280px] flex-shrink-0 flex flex-col">
          <h3 className="text-[9px] font-bold tracking-[0.38em] text-terra-muted uppercase mb-8">
            Select Targets
          </h3>

          <div className="space-y-3 mb-10">
            {watchlist.length === 0 ? (
              <div className="text-terra-muted font-mono text-sm py-4">Watchlist is empty.</div>
            ) : (
              watchlist.map(item => (
                <div key={item.id} className="flex flex-col gap-2">
                  <div
                    onClick={() => toggleSelection(item.id)}
                    className={`flex items-center justify-between px-5 py-4 border rounded-2xl cursor-pointer transition-all duration-300 ${
                      selectedIds.has(item.id)
                        ? 'border-terra-ink bg-terra-ink/5 shadow-sm'
                        : 'border-terra-border bg-white/60 hover:bg-white hover:border-terra-clay/30'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="text-terra-ink">
                        {selectedIds.has(item.id)
                          ? <CheckSquare className="w-4 h-4" />
                          : <Square className="w-4 h-4 text-terra-muted/50" />}
                      </div>
                      <span className="font-mono text-base font-bold tracking-[0.2em]">{item.ticker}</span>
                    </div>
                    <div className="relative flex h-2 w-2">
                      {item.status === 'scanning' && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${
                        item.status === 'idle' ? 'bg-gray-300' :
                        item.status === 'scanning' ? 'bg-blue-500' :
                        'bg-emerald-500'
                      }`} />
                    </div>
                  </div>

                  <AnimatePresence>
                    {selectedIds.has(item.id) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-visible"
                      >
                        <div className="flex items-center justify-between px-5 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-amber-700">
                              Experimental
                            </span>
                            <div className="relative group">
                              <HelpCircle className="w-3 h-3 text-amber-500 cursor-help" />
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-3 py-2 bg-terra-ink text-white text-[9px] font-bold uppercase tracking-wider rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[100] text-center leading-relaxed whitespace-normal shadow-xl">
                                HIGH RISK: Forces analysis to be either Bullish or Bearish, removing Neutral results.
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={(e) => toggleExperimentalMode(e, item.id, item.experimental_mode ?? false)}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                              item.experimental_mode ? 'bg-amber-500' : 'bg-terra-border'
                            }`}
                          >
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                              item.experimental_mode ? 'translate-x-[18px]' : 'translate-x-[2px]'
                            }`} />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))
            )}
          </div>

          <button
            onClick={handleSeeAnalysis}
            disabled={selectedIds.size === 0 || analyzing}
            className="w-full bg-terra-ink text-white px-8 py-4 rounded-full text-[9px] font-bold tracking-[0.25em] uppercase hover:bg-terra-ink/80 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {analyzing ? 'FETCHING...' : 'SEE ANALYSIS'}
          </button>
        </div>

        {/* ── INTELLIGENCE REPORT ────────────────────────── */}
        <div className="w-full min-w-0 flex flex-col">
          <h3 className="text-[9px] font-bold tracking-[0.38em] text-terra-muted uppercase mb-8">
            Intelligence Report
          </h3>

          <div className="space-y-6">
            {!activeView && !analyzing ? (
              <div className="border border-dashed border-terra-border rounded-3xl p-14 text-center text-terra-muted font-mono text-sm leading-relaxed bg-white/30 backdrop-blur-sm">
                SELECT TARGETS AND REQUEST ANALYSIS TO RETRIEVE LATEST SENTIMENT DATA.
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {analysisResults.map(result => (
                  <motion.div
                    key={result.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className={`bg-white/70 backdrop-blur-xl border rounded-3xl p-8 md:p-10 shadow-sm overflow-hidden transition-colors duration-300 ${
                      result.status === 'scanning' ? 'border-blue-200' : 'border-terra-border'
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-5 mb-8">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-2xl md:text-3xl font-mono tracking-[0.2em] font-bold">{result.ticker}</span>

                        {/* Sentiment badge */}
                        <div className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] ${
                          result.sentiment === 'Bullish'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : result.sentiment === 'Bearish'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-gray-50 text-gray-600 border border-gray-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            result.sentiment === 'Bullish' ? 'bg-emerald-500' :
                            result.sentiment === 'Bearish' ? 'bg-red-500' : 'bg-gray-400'
                          }`} />
                          {result.sentiment || 'Awaiting'}
                        </div>

                        {/* Status */}
                        <div className="flex items-center gap-2">
                          <div className="relative flex h-2.5 w-2.5">
                            {result.status === 'scanning' && (
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            )}
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                              result.status === 'idle' ? 'bg-gray-300' :
                              result.status === 'scanning' ? 'bg-blue-500' :
                              'bg-emerald-500'
                            }`} />
                          </div>
                          <span className="text-[9px] uppercase tracking-[0.22em] font-bold text-terra-muted">{result.status}</span>
                        </div>

                        {result.experimental_mode && (
                          <div className="px-3 py-1 bg-amber-50 border border-amber-200 rounded-full">
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-700">Experimental</span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col sm:items-end gap-2.5 flex-shrink-0">
                        {result.last_analyzed_at && (
                          <span className="font-mono text-[9px] text-terra-muted uppercase tracking-wider">
                            {new Date(result.last_analyzed_at).toLocaleString()}
                          </span>
                        )}
                        <button
                          onClick={() => handleUpdateAnalysis(result.ticker, result.id, result.experimental_mode ?? false)}
                          disabled={result.status === 'scanning'}
                          className="text-[9px] font-bold tracking-[0.22em] uppercase text-terra-ink hover:text-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-terra-surface px-4 py-2 rounded-full"
                        >
                          {result.status === 'scanning' ? 'Scanning...' : 'Update Analysis'}
                        </button>
                      </div>
                    </div>

                    {/* Reasoning */}
                    <div className="font-serif text-base md:text-lg leading-relaxed text-terra-ink border-t border-terra-border pt-7">
                      {result.status === 'scanning' ? (
                        <div className="flex flex-col gap-3 animate-pulse">
                          <div className="h-4 bg-terra-surface rounded-full w-full" />
                          <div className="h-4 bg-terra-surface rounded-full w-5/6" />
                          <div className="h-4 bg-terra-surface rounded-full w-4/6" />
                        </div>
                      ) : (
                        result.reasoning || (
                          <span className="italic text-terra-muted">
                            Analysis pending or system error occurred.
                          </span>
                        )
                      )}
                    </div>

                    {result.analysis_count !== undefined && result.analysis_count > 0 && (
                      <div className="mt-6 flex items-center justify-end">
                        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-terra-muted/50">
                          Total Scans: {result.analysis_count}
                        </span>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
