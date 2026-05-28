export const spring = {
  snap: { type: "spring", mass: 0.4, stiffness: 320, damping: 24 },
  gentle: { type: "spring", mass: 0.6, stiffness: 240, damping: 28 },
  bouncy: { type: "spring", mass: 0.8, stiffness: 200, damping: 16 },
  slow: { type: "spring", mass: 1, stiffness: 140, damping: 26 },
};

export const ease = {
  micro: [0.4, 0, 0.2, 1],
  short: [0.32, 0.72, 0, 1],
  medium: [0.32, 0.72, 0, 1],
};

export const routeTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: spring.gentle },
  exit: { opacity: 0, y: -4, transition: { duration: 0.18, ease: ease.short } },
};

export const reducedRouteTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.08, ease: "linear" } },
  exit: { opacity: 0, transition: { duration: 0.05, ease: "linear" } },
};

export const pageBodyTransition = {
  initial: { opacity: 0, y: 12, scale: 0.985 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...spring.slow, delay: 0.04 },
  },
};

export const reducedPageBodyTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.08, ease: "linear" } },
};

export const stagger = {
  parent: {
    animate: {
      transition: {
        staggerChildren: 0.06,
        delayChildren: 0.04,
      },
    },
  },
  child: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: spring.gentle },
  },
};
