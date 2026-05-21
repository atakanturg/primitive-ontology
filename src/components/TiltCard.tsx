import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, animate } from 'motion/react';

interface TiltCardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  intensity?: number;
}

export function TiltCard({ children, style, className, intensity = 6 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 22 });
  const sy = useSpring(y, { stiffness: 200, damping: 22 });
  const rotX = useTransform(sy, [-80, 80], [intensity, -intensity]);
  const rotY = useTransform(sx, [-80, 80], [-intensity, intensity]);

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set(e.clientX - rect.left - rect.width / 2);
    y.set(e.clientY - rect.top - rect.height / 2);
  };
  const onLeave = () => {
    animate(x, 0, { type: 'spring', stiffness: 200, damping: 25 });
    animate(y, 0, { type: 'spring', stiffness: 200, damping: 25 });
  };

  return (
    <motion.div
      ref={ref as any}
      style={{ rotateX: rotX, rotateY: rotY, transformPerspective: 800, ...style }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={className}
    >
      {children}
    </motion.div>
  );
}
