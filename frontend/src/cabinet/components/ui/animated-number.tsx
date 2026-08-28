import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";

/** Число, плавно «докручивающееся» до нового значения (баланс, дни) */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const motionValue = useMotionValue(value);
  const text = useTransform(motionValue, (v) => (format ?? ((n: number) => n.toLocaleString("ru-RU")))(v));

  useEffect(() => {
    const controls = animate(motionValue, value, { type: "spring", stiffness: 90, damping: 20 });
    return () => controls.stop();
  }, [motionValue, value]);

  return <motion.span className={className}>{text}</motion.span>;
}
