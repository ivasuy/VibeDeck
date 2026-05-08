import React from "react";
import { motion, useReducedMotion } from "motion/react";

export function HoverCard({
  children,
  className = "",
  scale = 1.02,
  y = -4,
  glow = false,
}) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      whileHover={{
        scale,
        y,
        boxShadow: glow
          ? "0 20px 40px -12px rgba(0, 0, 0, 0.2)"
          : "0 12px 32px -10px rgba(0, 0, 0, 0.18)",
      }}
      whileTap={{ scale: 0.98 }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 25,
      }}
      style={{ willChange: "transform" }}
    >
      {children}
    </motion.div>
  );
}

export function HoverLift({
  children,
  className = "",
  y = -2,
}) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      whileHover={{ y }}
      transition={{
        type: "spring",
        stiffness: 500,
        damping: 30,
      }}
    >
      {children}
    </motion.div>
  );
}

export function HoverScale({
  children,
  className = "",
  scale = 1.1,
}) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      whileHover={{ scale }}
      whileTap={{ scale: 0.95 }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 20,
      }}
    >
      {children}
    </motion.div>
  );
}
