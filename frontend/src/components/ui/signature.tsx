"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface SignatureProps {
  text?: string;
  color?: string;
  fontSize?: number;
  duration?: number;
  delay?: number;
  className?: string;
  onComplete?: () => void;
}

export function Signature({
  text = "ClearLane",
  color = "#ffffff",
  fontSize = 72,
  duration = 2,
  delay = 0.3,
  className,
  onComplete,
}: SignatureProps) {
  const textRef = useRef<SVGTextElement>(null);
  const [textWidth, setTextWidth] = useState(0);
  const [mounted, setMounted] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Measure text after mount so the clipPath rect matches exactly
  useEffect(() => {
    if (mounted && textRef.current) {
      const bbox = textRef.current.getBBox();
      setTextWidth(bbox.width);
    }
  }, [mounted, text, fontSize]);

  const svgHeight = fontSize * 1.4;

  return (
    <svg
      className={className}
      width={textWidth > 0 ? textWidth : undefined}
      height={svgHeight}
      viewBox={`0 0 ${Math.max(textWidth, 1)} ${svgHeight}`}
      style={{
        display: "block",
        fontFamily: "'Dancing Script', 'Caveat', cursive, serif",
        fontWeight: 700,
      }}
    >
      <defs>
        <clipPath id={`sig-clip-${text.replace(/\s/g, "-")}`}>
          <motion.rect
            x={0}
            y={0}
            height={svgHeight}
            initial={{ width: 0 }}
            animate={mounted && textWidth > 0 ? { width: textWidth } : {}}
            transition={{
              duration,
              delay,
              ease: "easeInOut",
            }}
            onAnimationComplete={() => {
              if (!doneRef.current) {
                doneRef.current = true;
                onComplete?.();
              }
            }}
          />
        </clipPath>
      </defs>

      {/* Text revealed left-to-right via expanding clipPath */}
      <text
        ref={textRef}
        x={0}
        y={fontSize * 1.05}
        fontSize={fontSize}
        fill={color}
        fontFamily="'Dancing Script', 'Caveat', cursive, serif"
        fontWeight={700}
        clipPath={`url(#sig-clip-${text.replace(/\s/g, "-")})`}
      >
        {text}
      </text>
    </svg>
  );
}

export default Signature;
