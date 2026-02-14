import { useEffect, useRef } from 'react';

interface NetworkNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface DataParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
}

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const networkNodesRef = useRef<NetworkNode[]>([]);
  const dataParticlesRef = useRef<DataParticle[]>([]);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize elements
    const initializeElements = () => {
      // Professional network nodes - avoid center content area
      networkNodesRef.current = Array.from({ length: 35 }, () => {
        let x, y;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const avoidRadius = Math.min(canvas.width, canvas.height) * 0.25; // Avoid 25% of screen center

        // Keep trying until we find a position outside the center area
        do {
          x = Math.random() * canvas.width;
          y = Math.random() * canvas.height;
          const distanceFromCenter = Math.sqrt(
            Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
          );
          if (distanceFromCenter > avoidRadius) break;
        } while (true);

        return {
          x,
          y,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15,
          radius: 1.5 + Math.random() * 2,
        };
      });

      // Subtle data particles - also avoid center
      dataParticlesRef.current = Array.from({ length: 60 }, () => {
        let x, y;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const avoidRadius = Math.min(canvas.width, canvas.height) * 0.3;

        do {
          x = Math.random() * canvas.width;
          y = Math.random() * canvas.height;
          const distanceFromCenter = Math.sqrt(
            Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
          );
          if (distanceFromCenter > avoidRadius) break;
        } while (true);

        return {
          x,
          y,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          radius: 1 + Math.random() * 1.5,
          opacity: 0.2 + Math.random() * 0.3,
        };
      });
    };

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initializeElements();
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Track mouse position
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Animation loop
    let animationId: number;
    const animate = () => {
      timeRef.current += 0.005;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const isDark = document.documentElement.classList.contains('dark');

      // Draw elegant gradient background
      const gradient = ctx.createRadialGradient(
        mouseRef.current.x * canvas.width,
        mouseRef.current.y * canvas.height,
        0,
        canvas.width / 2,
        canvas.height / 2,
        Math.max(canvas.width, canvas.height) * 0.8
      );

      if (isDark) {
        gradient.addColorStop(0, '#0B0D14');
        gradient.addColorStop(0.4, '#12141F');
        gradient.addColorStop(1, '#1A1D2E');
      } else {
        gradient.addColorStop(0, '#F8F9FC');
        gradient.addColorStop(0.4, '#F1F3F9');
        gradient.addColorStop(1, '#EEF2FF');
      }

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw subtle flowing gradient mesh
      const meshGradient = ctx.createLinearGradient(
        0,
        0,
        canvas.width,
        canvas.height
      );

      if (isDark) {
        meshGradient.addColorStop(0, 'rgba(79, 70, 229, 0.03)');
        meshGradient.addColorStop(0.5, 'rgba(129, 140, 248, 0.05)');
        meshGradient.addColorStop(1, 'rgba(79, 70, 229, 0.03)');
      } else {
        meshGradient.addColorStop(0, 'rgba(79, 70, 229, 0.04)');
        meshGradient.addColorStop(0.5, 'rgba(129, 140, 248, 0.06)');
        meshGradient.addColorStop(1, 'rgba(79, 70, 229, 0.04)');
      }

      ctx.fillStyle = meshGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw network connections (professional social graph)
      networkNodesRef.current.forEach((node, i) => {
        networkNodesRef.current.forEach((otherNode, j) => {
          if (i < j) {
            const dx = otherNode.x - node.x;
            const dy = otherNode.y - node.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Connect nodes within 180px
            if (distance < 180) {
              const opacity = (1 - distance / 180) * 0.12;
              ctx.strokeStyle = isDark
                ? `rgba(129, 140, 248, ${opacity})`
                : `rgba(79, 70, 229, ${opacity})`;
              ctx.lineWidth = 0.8;
              ctx.beginPath();
              ctx.moveTo(node.x, node.y);
              ctx.lineTo(otherNode.x, otherNode.y);
              ctx.stroke();
            }
          }
        });
      });

      // Update and draw network nodes
      networkNodesRef.current.forEach((node) => {
        // Gentle mouse attraction
        const dx = mouseRef.current.x * canvas.width - node.x;
        const dy = mouseRef.current.y * canvas.height - node.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 250) {
          const force = (250 - distance) / 250 * 0.08;
          node.vx += (dx / distance) * force;
          node.vy += (dy / distance) * force;
        }

        // Update position
        node.x += node.vx;
        node.y += node.vy;

        // Damping
        node.vx *= 0.98;
        node.vy *= 0.98;

        // Wrap around edges
        if (node.x < 0) node.x = canvas.width;
        if (node.x > canvas.width) node.x = 0;
        if (node.y < 0) node.y = canvas.height;
        if (node.y > canvas.height) node.y = 0;

        // Draw node with glow
        const nodeGradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius * 3);
        nodeGradient.addColorStop(0, isDark ? 'rgba(129, 140, 248, 0.8)' : 'rgba(79, 70, 229, 0.7)');
        nodeGradient.addColorStop(0.5, isDark ? 'rgba(129, 140, 248, 0.3)' : 'rgba(79, 70, 229, 0.3)');
        nodeGradient.addColorStop(1, 'rgba(79, 70, 229, 0)');

        ctx.fillStyle = nodeGradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * 3, 0, Math.PI * 2);
        ctx.fill();

        // Core node
        ctx.fillStyle = isDark ? 'rgba(129, 140, 248, 0.9)' : 'rgba(79, 70, 229, 0.8)';
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // Update and draw data particles
      dataParticlesRef.current.forEach((particle) => {
        // Gentle drift
        particle.x += particle.vx;
        particle.y += particle.vy;

        // Slight mouse repulsion
        const dx = particle.x - mouseRef.current.x * canvas.width;
        const dy = particle.y - mouseRef.current.y * canvas.height;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 120) {
          const force = (120 - distance) / 120 * 0.15;
          particle.vx += (dx / distance) * force;
          particle.vy += (dy / distance) * force;
        }

        // Damping
        particle.vx *= 0.99;
        particle.vy *= 0.99;

        // Wrap around
        if (particle.x < 0) particle.x = canvas.width;
        if (particle.x > canvas.width) particle.x = 0;
        if (particle.y < 0) particle.y = canvas.height;
        if (particle.y > canvas.height) particle.y = 0;

        // Draw particle
        ctx.fillStyle = isDark
          ? `rgba(165, 180, 252, ${particle.opacity * 0.5})`
          : `rgba(79, 70, 229, ${particle.opacity * 0.4})`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 -z-10"
    />
  );
}
