import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { reducedRouteTransition, routeTransition } from "../../lib/motion";

export function PageTransition({
  children,
  className = "",
}) {
  const shouldReduceMotion = useReducedMotion();
  const variants = shouldReduceMotion ? reducedRouteTransition : routeTransition;

  return (
    <motion.div
      initial={variants.initial}
      animate={variants.animate}
      exit={variants.exit}
      className={className}
    >
      {children}
    </motion.div>
  );
}
