import React, { useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";

const SPRING = { type: "spring", stiffness: 400, damping: 34 };
const FADE = { duration: 0.2 };

export function SlidePanel({
  open,
  onClose,
  children,
  side = "left",
  width = "w-[280px] max-w-[85vw]",
  className = "",
  backdropClassName = "",
  showBackdrop = true,
  zIndex = "z-[80]",
}) {
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const xOffset = side === "left" ? "-100%" : "100%";
  const panelPosition = side === "left" ? "left-0" : "right-0";

  return (
    <AnimatePresence>
      {open && (
        <div className={`fixed inset-0 ${zIndex} flex`}>
          {showBackdrop && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : FADE}
              className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${backdropClassName}`}
              onClick={onClose}
              aria-hidden
            />
          )}
          <motion.aside
            initial={shouldReduceMotion ? { opacity: 0 } : { x: xOffset }}
            animate={shouldReduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { x: xOffset }}
            transition={shouldReduceMotion ? { duration: 0.15 } : SPRING}
            className={`absolute top-0 bottom-0 ${panelPosition} ${width} flex flex-col ${className}`}
          >
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
