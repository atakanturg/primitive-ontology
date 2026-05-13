import { motion } from 'motion/react';

export function Home() {
  return (
    <section className="relative flex flex-col items-center justify-center px-4 overflow-hidden min-h-[70vh]">
      <div className="max-w-4xl w-full z-10 flex flex-col items-center justify-center">
        
        {/* Logo Animation Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          {/* Your existing logo animation component goes here */}
          <h1 className="text-6xl md:text-8xl font-serif tracking-tighter text-terra-ink select-none">
            Primitive
          </h1>
          
          {/* Decorative underline for the logo area */}
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: '100%' }}
            transition={{ delay: 0.5, duration: 1, ease: "easeInOut" }}
            className="h-[1px] bg-terra-ink mt-2"
          />
        </motion.div>

      </div>

      {/* Background Texture */}
      <div className="absolute inset-0 opacity-[0.03] bg-[url('/noise.svg')] pointer-events-none mix-blend-overlay"></div>
    </section>
  );
}
