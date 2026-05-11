export const COLORS = {
  MATRIX: "#00FF41",
  GOLD: "#FFD700",
  DARK: "#050505",
};

export const TEXTURES = [

  { bg: `${COLORS.MATRIX}99`, pattern: "none" },

  {
    bg: "transparent",
    pattern: `repeating-linear-gradient(45deg, transparent, transparent 2px, ${COLORS.MATRIX}33 2px, ${COLORS.MATRIX}33 4px)`,
  },

  {
    bg: "transparent",
    pattern: `radial-gradient(${COLORS.MATRIX}33 1px, transparent 1px)`,
    size: "4px 4px",
  },

  {
    bg: "transparent",
    pattern: `linear-gradient(90deg, ${COLORS.MATRIX}1A 1px, transparent 1px)`,
    size: "3px 100%",
  },
];
