import React, { useEffect, useRef, useState } from "react";

/**
 *
 * @param {Object} props
 */
export function AnimatedContainer({
  children,
  className = "",
  staggerDelay = 100,
  initialDelay = 0,
}) {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), initialDelay);
    return () => clearTimeout(timer);
  }, [initialDelay]);

  const childrenArray = React.Children.toArray(children);

  return (
    <div ref={containerRef} className={className}>
      {childrenArray.map((child, index) => (
        <div
          key={index}
          className={`transition-all duration-500 ease-out ${
            visible
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-4"
          }`}
          style={{
            transitionDelay: visible ? `${index * staggerDelay}ms` : "0ms",
            willChange: "opacity, transform",
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

/**
 *
 * @param {Object} props
 */
export function AnimatedCard({
  children,
  className = "",
  delay = 0,
  animation = "fade-up",
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  const animationClasses = {
    "fade-up": visible
      ? "opacity-100 translate-y-0"
      : "opacity-0 translate-y-5",
    "fade-in": visible ? "opacity-100" : "opacity-0",
    scale: visible ? "opacity-100 scale-100" : "opacity-0 scale-95",
  };

  return (
    <div
      className={`transition-all duration-500 ease-out ${animationClasses[animation]} ${className}`}
      style={{
        transitionDelay: `${delay}ms`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

/**
 *
 * @param {Object} props
 */
export function CountUpNumber({
  value,
  className = "",
  duration = 1000,
  format = "compact",
}) {
  const [displayValue, setDisplayValue] = useState("0");
  const [hasAnimated, setHasAnimated] = useState(false);
  const valueRef = useRef(value);

  useEffect(() => {

    const numericValue = parseFloat(String(value).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(numericValue) || numericValue === 0) {
      setDisplayValue(String(value));
      return;
    }


    if (valueRef.current === value && hasAnimated) {
      setDisplayValue(String(value));
      return;
    }

    valueRef.current = value;


    const startTime = Date.now();
    const startValue = 0;
    const endValue = numericValue;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // ease-out-quart
      const easeProgress = 1 - Math.pow(1 - progress, 4);
      const currentValue = Math.floor(
        startValue + (endValue - startValue) * easeProgress
      );


      let formatted;
      if (format === "compact") {
        formatted = formatCompact(currentValue);
      } else if (format === "currency") {
        formatted = `$${currentValue.toLocaleString()}`;
      } else {
        formatted = currentValue.toLocaleString();
      }

      setDisplayValue(formatted);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayValue(String(value));
        setHasAnimated(true);
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration, format, hasAnimated]);

  return <span className={className}>{displayValue}</span>;
}


function formatCompact(num) {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return num.toString();
}

/**
 *
 * @param {Object} props
 */
export function PulseIndicator({
  color = "bg-oai-brand",
  size = "w-2 h-2",
}) {
  return (
    <span className="relative flex">
      <span
        className={`animate-ping absolute inline-flex rounded-full ${color} opacity-75 ${size}`}
      />
      <span
        className={`relative inline-flex rounded-full ${color} ${size}`}
      />
    </span>
  );
}

/**
 *
 * @param {Object} props
 */
export function ShimmerLoader({ className = "" }) {
  return (
    <div
      className={`shimmer ${className}`}
    />
  );
}
