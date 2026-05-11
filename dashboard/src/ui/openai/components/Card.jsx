import React from "react";

/**
 */
export function Card({
  children,
  title,
  subtitle,
  className = "",
  bodyClassName = "",
  hover = false,
}) {
  return (
    <div className={`rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] shadow-glass transition-all duration-200 ${hover ? "hover:shadow-glass-glow hover:border-oai-gray-300 dark:hover:border-white/10 hover:-translate-y-0.5" : ""} ${className}`}>
      {(title || subtitle) && (
        <div className="px-5 py-4 border-b border-[var(--glass-border)] transition-colors duration-200">
          {title && (
            <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide font-mono transition-colors duration-200">{title}</h3>
          )}
          {subtitle && (
            <p className="text-sm text-oai-gray-500 dark:text-oai-gray-300 mt-1 transition-colors duration-200">{subtitle}</p>
          )}
        </div>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </div>
  );
}
