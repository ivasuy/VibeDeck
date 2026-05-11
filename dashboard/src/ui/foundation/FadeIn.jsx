import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";

export function FadeIn({
  children,
  delay = 0,
  duration = 0.35,
  y = 12,
  className = "",
  once = true,
  show,
}) {
  const shouldReduceMotion = useReducedMotion();
  const hasToggle = typeof show === "boolean";

  if (shouldReduceMotion) {
    if (hasToggle && !show) return null;
    return <div className={className}>{children}</div>;
  }

  const inner = (
    <motion.div
      key="fade-in"
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      exit={hasToggle ? { opacity: 0, y: y / 2 } : undefined}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );

  if (hasToggle) {
    return <AnimatePresence mode="wait">{show && inner}</AnimatePresence>;
  }

  return inner;
}

export function StaggerContainer({
  children,
  staggerDelay = 0.1,
  initialDelay = 0,
  className = "",
}) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: initialDelay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className = "",
  y = 12,
}) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: 0.35,
            ease: [0.16, 1, 0.3, 1],
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
