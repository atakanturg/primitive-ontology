import { motion, AnimatePresence } from 'motion/react';
import { Menu, X, LogIn, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { supabase } from '../lib/supabase';

export function Navigation() {
  // Expanded by default per instruction
  const [isOpen, setIsOpen] = useState(true); 
  const location = useLocation();
  const { user } = useAuth();
  const [authLoading, setAuthLoading] = useState(false);

  const handleSignIn = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      }
    });
    setAuthLoading(false);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    await supabase.auth.signOut();
    setAuthLoading(false);
  };

  const routes = [
    { path: '/', label: 'Overview' },
    { path: '/target', label: 'Input Target' },
    { path: '/data', label: 'See Data' },
  ];

  return (
    <div className="w-full bg-terra-bg border-t border-terra-border py-4 px-4 flex justify-center items-center h-[88px] relative">
      <motion.nav 
        layout
        className="flex items-center p-2 bg-terra-ink backdrop-blur-md rounded-[3rem] shadow-2xl overflow-hidden min-h-[64px]"
      >
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-center w-12 h-12 rounded-full text-white hover:bg-white/10 transition-colors flex-shrink-0"
        >
          {isOpen ? <X className="w-5 h-5 stroke-[1.5]" /> : <Menu className="w-5 h-5 stroke-[1.5]" />}
        </button>
        
        <AnimatePresence mode="popLayout">
          {isOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center whitespace-nowrap overflow-hidden"
            >
              <div className="flex pr-2 pl-2 gap-2">
                {routes.map((route) => {
                  const isActive = location.pathname === route.path;
                  return (
                    <Link
                      key={route.path}
                      to={route.path}
                      className={`px-5 md:px-6 py-3 rounded-[2.5rem] transition-all duration-500 text-[9px] md:text-[10px] font-medium uppercase tracking-[0.2em] ${
                        isActive 
                          ? 'bg-white text-terra-ink shadow-sm' 
                          : 'text-terra-bg/60 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {route.label}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      {supabase && (
        <div className="absolute right-4 md:right-8 hidden md:block z-10">
          {user ? (
            <button 
              onClick={handleSignOut}
              disabled={authLoading}
              className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-terra-muted hover:text-terra-ink transition-colors px-4 py-2 bg-white/50 border border-terra-border rounded-full"
            >
              <LogOut className="w-3 h-3" />
              Sign Out
            </button>
          ) : (
            <button 
              onClick={handleSignIn}
              disabled={authLoading}
              className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-terra-muted hover:text-terra-ink transition-colors px-4 py-2 bg-white/50 border border-terra-border rounded-full"
            >
              <LogIn className="w-3 h-3" />
              Sign In
            </button>
          )}
        </div>
      )}
    </div>
  );
}
