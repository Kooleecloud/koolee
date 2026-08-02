"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Remounts on every step navigation, giving the booking flow its slide-in
 * step transition. Fade-only under prefers-reduced-motion.
 */
export default function BookTemplate({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
