import { motion } from 'motion/react';

export function Home() {
  return (
    <section className="relative flex flex-col items-center justify-center px-4 overflow-hidden min-h-[70vh]">
      <div className="max-w-4xl w-full z-10 flex flex-col items-center justify-center">
        
        {/* Isolated container for the Logo Animation only */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          {/* Logo Animation Component remains at the top; all arrows and indicators purged */}
        </motion.div>

      </div>

      {/* Clean Background Texture */}
      <div className="absolute inset-0 opacity-[0.03] bg-[url('/noise.svg')] pointer-events-none mix-blend-overlay"></div>
    </section>
  );
}
