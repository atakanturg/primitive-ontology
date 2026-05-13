import { useAuth } from '../lib/useAuth';
import { motion, AnimatePresence } from 'motion/react';
import { CheckSquare, Square } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// Reuse Signal interface for historical data
interface Signal {
  id: string;
  ticker: string;
  status: string;
  sentiment: string;
  reasoning: string;
  last_updated: string;
  last_analyzed_at?: string;
  analysis_count?: number;
}

export function Data() {
  const { user, loading, isConnected } = useAuth();
  const [watchlist, setWatchlist] = useState<Signal[]>([]);
  const [fetching, setFetching] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analysisResults, setAnalysisResults] = useState<Signal[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeView, setActiveView] = useState(false); // Indicates if right panel should show active results

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
        (payload) => {
          fetchWatchlist();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Keep analysisResults synced with watchlist changes if they are currently being viewed
  useEffect(() => {
    if (activeView) {
      setAnalysisResults(watchlist.filter(item => selectedIds.has(item.id)));
    }
  }, [watchlist, selectedIds, activeView]);

  if (loading || fetching) {
    return <div className="flex justify-center items-center h-64 text-terra-muted uppercase tracking-widest text-sm font-bold">Checking access...</div>;
  }

  // If Supabase is connected but no user is found, block access
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
    // Hide active view if selection becomes empty
    if (selectedIds.size === 1 && selectedIds.has(id)) {
      setActiveView(false);
    }
  };

  const handleSeeAnalysis = async () => {
    if (selectedIds.size === 0) return;
    setAnalyzing(true);
    setActiveView(true);
    
    // We already have the live data in `watchlist`, so we just filter it.
    // It will be kept up to date by the real-time subscription effect.
    setAnalysisResults(watchlist.filter(item => selectedIds.has(item.id)));
    
    // Simulate a brief loading state for UX
    setTimeout(() => {
      setAnalyzing(false);
    }, 600);
  };

  const handleUpdateAnalysis = async (ticker: string, id: string) => {
    // Optimistically set status to scanning
    if (!supabase) return;
    await supabase.from('watchlist').update({ status: 'scanning' }).eq('id', id);

    try {
      fetch('/api/analyze', {
        method: 'POST',
        headers: {
           'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ticker: ticker,
          user_id: user?.id,
          row_id: id
        })
      });
    } catch (err) {
      console.error("Failed to trigger update:", err);
    }
  };

  return (
    <div className="flex flex-col px-4 mb-24 mt-12 md:mt-24 max-w-5xl mx-auto w-full gap-12 text-terra-ink">
      <div className="flex flex-col md:flex-row gap-12 items-start">
        {/* Watchlist Section */}
        <div className="w-full md:w-1/3 flex flex-col">
          <div className="flex items-center gap-3 mb-6">
            <h3 className="text-xs font-bold tracking-[0.3em] text-terra-muted uppercase">Select Targets</h3>
          </div>
          
          <div className="space-y-3 mb-8">
            {watchlist.length === 0 ? (
               <div className="text-terra-muted font-mono text-sm">Watchlist is empty.</div>
            ) : (
              watchlist.map(item => (
                <div 
                  key={item.id} 
                  onClick={() => toggleSelection(item.id)}
                  className={`flex items-center justify-between p-4 border rounded-xl cursor-pointer transition-all ${
                    selectedIds.has(item.id) 
                      ? 'border-terra-ink bg-terra-ink/5' 
                      : 'border-terra-border bg-white/50 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="text-terra-ink">
                      {selectedIds.has(item.id) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-terra-muted" />}
                    </div>
                    <span className="font-mono text-lg font-bold tracking-widest">{item.ticker}</span>
                  </div>
                  <div className="relative flex h-2 w-2">
                    {item.status === 'scanning' && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${
                      item.status === 'idle' ? 'bg-gray-400' :
                      item.status === 'scanning' ? 'bg-blue-500' :
                      'bg-green-500'
                    }`}></span>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <button 
            onClick={handleSeeAnalysis}
            disabled={selectedIds.size === 0 || analyzing}
            className="w-full bg-terra-ink text-white px-8 py-4 rounded-xl text-xs font-bold tracking-[0.2em] uppercase hover:bg-terra-ink/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analyzing ? 'FETCHING...' : 'SEE ANALYSIS'}
          </button>
        </div>

        {/* Analysis Results Display */}
        <div className="w-full md:w-2/3">
           <h3 className="text-xs font-bold tracking-[0.3em] text-terra-muted uppercase mb-6">Intelligence Report</h3>
           
           <div className="space-y-6">
             {!activeView && !analyzing ? (
               <div className="border border-dashed border-terra-border rounded-2xl p-12 text-center text-terra-muted font-mono text-sm leading-relaxed bg-white/30 backdrop-blur-sm">
                 SELECT TARGETS AND REQUEST ANALYSIS TO RETRIEVE LATEST SENTIMENT DATA.
               </div>
             ) : (
               <AnimatePresence mode="popLayout">
                 {analysisResults.map(result => (
                   <motion.div 
                     initial={{ opacity: 0, y: 10 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, scale: 0.95 }}
                     key={result.id} 
                     className={`bg-white/70 backdrop-blur-xl border rounded-2xl p-6 shadow-sm overflow-hidden relative transition-colors ${
                       result.status === 'scanning' ? 'border-blue-200' : 'border-terra-border'
                     }`}
                   >
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
                        <div className="flex items-center gap-4">
                          <span className="text-2xl font-mono tracking-widest font-bold">{result.ticker}</span>
                          <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              result.sentiment === 'Bullish' ? 'bg-green-100 text-green-700' :
                              result.sentiment === 'Bearish' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-700'
                          }`}>
                            {result.sentiment || 'Awaiting'}
                          </div>
                          
                          <div className="flex items-center gap-2">
                             <div className="relative flex h-3 w-3">
                               {result.status === 'scanning' && (
                                 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                               )}
                               <span className={`relative inline-flex rounded-full h-3 w-3 ${
                                 result.status === 'idle' ? 'bg-gray-400' :
                                 result.status === 'scanning' ? 'bg-blue-500' :
                                 'bg-green-500'
                               }`}></span>
                             </div>
                             <span className="text-[10px] uppercase tracking-wider font-bold text-terra-muted">{result.status}</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-col sm:items-end gap-2">
                          {result.last_analyzed_at && (
                            <span className="flex items-center gap-1 font-mono text-[10px] text-terra-muted uppercase tracking-wider">
                              {new Date(result.last_analyzed_at).toLocaleString()}
                            </span>
                          )}
                          <button
                            onClick={() => handleUpdateAnalysis(result.ticker, result.id)}
                            disabled={result.status === 'scanning'}
                            className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-terra-ink hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-terra-surface px-3 py-1.5 rounded-full"
                          >
                            {result.status === 'scanning' ? 'Scanning...' : 'Update Analysis'}
                          </button>
                        </div>
                      </div>

                      <div className="font-serif text-lg leading-relaxed text-terra-ink border-t border-terra-border pt-4">
                        {result.status === 'scanning' ? (
                          <div className="flex flex-col gap-2 animate-pulse">
                            <div className="h-4 bg-terra-surface rounded w-full"></div>
                            <div className="h-4 bg-terra-surface rounded w-5/6"></div>
                            <div className="h-4 bg-terra-surface rounded w-4/6"></div>
                          </div>
                        ) : (
                          result.reasoning || <span className="italic text-terra-muted">Analysis pending or system error occurred.</span>
                        )}
                      </div>
                      
                      {result.analysis_count !== undefined && result.analysis_count > 0 && (
                        <div className="mt-4 flex items-center justify-end">
                           <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-terra-muted/60">
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
