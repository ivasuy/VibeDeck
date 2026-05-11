import React from "react";

/**
 *
 * @param {Object} props
 */
export function Badge({
  children,
  variant = "info",
  size = "md",
  className = "",
}) {
  const baseStyles = "inline-flex items-center font-medium";

  const variantStyles = {
    success: "bg-oai-brand-100 dark:bg-oai-brand-900/30 text-oai-brand-700 dark:text-oai-brand-400 rounded-full",
    warning: "bg-oai-amber-50 dark:bg-oai-amber-900/30 text-oai-amber-dark dark:text-oai-amber-400 rounded-full",
    error: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full",
    info: "bg-oai-gray-100 dark:bg-oai-gray-800 text-oai-gray-600 dark:text-oai-gray-300 rounded-full",
    secondary: "bg-oai-gray-100 dark:bg-oai-gray-800 text-oai-gray-500 dark:text-oai-gray-300 rounded-md",
  };

  const sizeStyles = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-sm",
  };

  const mergedClassName = `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`.trim();

  return <span className={mergedClassName}>{children}</span>;
}
