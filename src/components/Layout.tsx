import { GearScene } from '../components/GearScene';
import { Navigation } from '../components/Navigation';
import { ScrollToTop } from './ScrollToTop';
import { Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowDown } from 'lucide-react';
import { PlanetCanvas } from '../components/PlanetEntity';

export default function Layout() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window !== 'undefined') {
      const hasLoaded = sessionStorage.getItem('hasLoaded');
      return !hasLoaded;
    }
    return true;
  });

  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => {
        setIsLoading(false);
        sessionStorage.setItem('hasLoaded', 'true');
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  useEffect(() => {
    const handleScroll = () => {
      if (!scrollRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Consider "at bottom" if within 50px of the bottom
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < 50);
    };

    const container = scrollRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      // Run once on mount
      handleScroll();
    }
    return () => {
      if (container) container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const scrollToPosition = () => {
    if (!scrollRef.current) return;
    if (isAtBottom) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      scrollRef.current.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
    }
  };

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/target': return 'TARGET INPUT';
      case '/data': return 'SIGNALS DATA';
      default: return 'OVERVIEW';
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-transparent text-terra-ink font-sans selection:bg-terra-ink selection:text-white relative">
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center space-y-8"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-12 h-12 border border-terra-ink border-t-transparent rounded-full"
            />
            <div className="text-xs font-sans font-bold tracking-[0.3em] uppercase text-terra-ink">
              Initializing Primitive
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ScrollToTop />
      
      {location.pathname === '/' && <GearScene />}
      <div className="absolute inset-0 bg-white/70 backdrop-blur-[3px] z-[-1] pointer-events-none bg-[radial-gradient(#d1d5db_1px,transparent_1px)] [background-size:24px_24px]" />

      <div 
        id="main-scroll-container" 
        ref={scrollRef}
        className="flex-grow overflow-y-auto overflow-x-hidden relative z-10 w-full flex flex-col"
      >
        <div className="w-full flex-shrink-0 pt-6 flex flex-col items-center">
          {/* Top Text */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: isLoading ? 2 : 0 }}
            className="text-center"
          >
            <h2 className="text-sm md:text-base font-sans font-medium tracking-[0.4em] uppercase text-terra-ink">
              ONTOLOGY DASHBOARD
              <br/>
              <span className="font-bold text-lg md:text-xl text-terra-ink/90 drop-shadow-sm">{getPageTitle()}</span>
            </h2>
          </motion.div>

          {/* Continuous Planet with Logo Overlay, only on Home */}
          {location.pathname === '/' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: isLoading ? 2.2 : 0.2 }}
              className="w-[350px] h-[350px] md:w-[600px] md:h-[600px] relative flex items-center justify-center -mt-4 md:-mt-10"
            >
              <div className="absolute inset-0 pointer-events-auto">
                <PlanetCanvas />
              </div>
              <img 
                src="/logo.png" 
                alt="Company Logo" 
                className="w-40 md:w-56 z-10 absolute pointer-events-none" 
                style={{ filter: "brightness(0) drop-shadow(0px 4px 12px rgba(0,0,0,0.1))" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }} 
              />
            </motion.div>
          )}
        </div>

        <main className={`relative z-10 flex-grow pt-8 ${location.pathname === '/' ? 'pt-0 md:-mt-10' : ''}`}>
          <Outlet />
        </main>

        <footer className="pt-24 pb-36 px-4 text-center relative z-10 border-t border-terra-border/50 bg-terra-bg/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 text-[10px] font-bold uppercase tracking-[0.3em] text-terra-muted">
            <div>Primitive OS © 2026</div>
            <div className="flex gap-8">
              <a href="#" className="hover:text-terra-ink transition-colors">Privacy</a>
              <a href="#" className="hover:text-terra-ink transition-colors">Terms</a>
            </div>
            <div>Status: Optimal</div>
          </div>
        </footer>
      </div>

      <div className="flex-shrink-0 z-50">
        <Navigation />
      </div>

      {/* Floating Scroll Arrow */}
      <motion.button
        onClick={scrollToPosition}
        className="fixed bottom-36 right-8 z-50 w-12 h-12 bg-terra-ink text-white rounded-full flex items-center justify-center shadow-2xl hover:bg-white hover:text-terra-ink hover:border hover:border-terra-border transition-colors duration-300 group"
        animate={{ y: [0, 10, 0] }}
        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
      >
        <motion.div
          animate={{ rotate: isAtBottom ? 180 : 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          <ArrowDown className="w-5 h-5 stroke-[1.5]" />
        </motion.div>
      </motion.button>
    </div>
  );
}
