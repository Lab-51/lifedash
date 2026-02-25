// === FILE PURPOSE ===
// Interactive canvas particle field — drifting stars with mouse-repulsion effect.
// Ported from the LifeDash website hero section for use in the Electron dashboard.

import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  baseSize: number;
  size: number;
  speed: number;
  baseOpacity: number;
  opacity: number;
  colorIndex: number;
  offsetX: number;
  offsetY: number;
  targetOffsetX: number;
  targetOffsetY: number;
}

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let stars: Star[] = [];
    const numStars = 150;
    let animationFrameId: number;
    let mouse = { x: -1000, y: -1000 };

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
    };

    const resize = () => {
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
      initStars();
    };

    const initStars = () => {
      stars = [];
      for (let i = 0; i < numStars; i++) {
        const baseSize = Math.random() * 1.5 + 0.5;
        const baseOpacity = Math.random() * 0.4 + 0.1;
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          baseSize,
          size: baseSize,
          speed: Math.random() * 0.06 + 0.02,
          baseOpacity,
          opacity: baseOpacity,
          colorIndex: Math.random(),
          offsetX: 0,
          offsetY: 0,
          targetOffsetX: 0,
          targetOffsetY: 0,
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      stars.forEach((star) => {
        star.x -= star.speed;

        if (star.x + star.offsetX < -20) {
          star.x = canvas.width + 20;
          star.y = Math.random() * canvas.height;
          star.offsetX = 0;
          star.offsetY = 0;
          star.targetOffsetX = 0;
          star.targetOffsetY = 0;
        }

        const dx = (star.x + star.offsetX) - mouse.x;
        const dy = (star.y + star.offsetY) - mouse.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDistance = 120;

        let targetSize = star.baseSize;
        let targetOpacity = star.baseOpacity;

        if (distance < maxDistance && distance > 0.1) {
          const force = (maxDistance - distance) / maxDistance;
          const pushFactor = 40;
          star.targetOffsetX = (dx / distance) * force * pushFactor;
          star.targetOffsetY = (dy / distance) * force * pushFactor;
          targetSize = star.baseSize * (1 + force * 0.4);
          targetOpacity = Math.min(1, star.baseOpacity + force * 0.4);
        } else {
          star.targetOffsetX = 0;
          star.targetOffsetY = 0;
        }

        star.offsetX += (star.targetOffsetX - star.offsetX) * 0.1;
        star.offsetY += (star.targetOffsetY - star.offsetY) * 0.1;
        star.size += (targetSize - star.size) * 0.1;
        star.opacity += (targetOpacity - star.opacity) * 0.1;

        let r = 255, g = 255, b = 255;
        const a = Math.max(0, star.opacity);

        if (star.colorIndex > 0.95) {
          r = 62; g = 232; b = 228; // Cyan accent
        } else if (star.colorIndex > 0.90) {
          r = 232; g = 163; b = 62; // Warm accent
        }

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        ctx.beginPath();
        ctx.arc(star.x + star.offsetX, star.y + star.offsetY, Math.max(0.1, star.size), 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseout', handleMouseLeave);

    resize();
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseout', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: 0.6 }}
    />
  );
}
