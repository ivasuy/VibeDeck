import React from "react";
import { motion, useReducedMotion } from "motion/react";

export function CelebrationBadge({
  children,
  className = "",
  trigger = false,
  onCelebrate,
}) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <span className={className}>{children}</span>;
  }

  return (
    <motion.span
      className={`inline-flex items-center justify-center ${className}`}
      animate={trigger ? {
        scale: [1, 1.3, 1],
        rotate: [0, -5, 5, 0],
      } : {}}
      transition={{
        duration: 0.5,
        ease: "easeOut",
      }}
      onAnimationComplete={onCelebrate}
    >
      {children}
    </motion.span>
  );
}

export function PulseRing({
  children,
  className = "",
  active = false,
  color = "#10b981",
}) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion || !active) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={`relative ${className}`}>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: color }}
        animate={{
          scale: [1, 1.5],
          opacity: [0.5, 0],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeOut",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

export function StreakFlame({
  days,
  className = "",
}) {
  const isHighStreak = days >= 30;
  const isMediumStreak = days >= 7;

  // Use inline SVG instead of emoji
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        color: isHighStreak ? "#f59e0b" : isMediumStreak ? "#f97316" : "#fb923c",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
      </svg>
    </span>
  );
}
