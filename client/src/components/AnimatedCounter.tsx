import { useEffect, useRef, useState } from "react";
import { Typography, TypographyProps } from "@mui/material";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  typographyProps?: TypographyProps;
}

export default function AnimatedCounter({ value, duration = 800, typographyProps }: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const prevValueRef = useRef(0);

  useEffect(() => {
    const startValue = prevValueRef.current;
    const diff = value - startValue;

    if (diff === 0) return;

    const animate = (timestamp: number) => {
      if (!startRef.current) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);

      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValue + diff * eased);

      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        prevValueRef.current = value;
      }
    };

    startRef.current = null;
    requestAnimationFrame(animate);
  }, [value, duration]);

  return (
    <Typography variant="h3" {...typographyProps} sx={{ fontFamily: '"Geist Mono", monospace', fontWeight: 600, ...typographyProps?.sx }}>
      {displayValue}
    </Typography>
  );
}
