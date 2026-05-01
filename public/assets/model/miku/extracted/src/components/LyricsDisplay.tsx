import React, { useEffect, useRef } from 'react';
import { Lyric } from '../constants';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface LyricsDisplayProps {
  currentTime: number;
  lyrics: Lyric[];
}

export const LyricsDisplay: React.FC<LyricsDisplayProps> = ({ currentTime, lyrics = [] }) => {
  const activeLyric = lyrics?.find(l => currentTime >= l.time && currentTime <= l.time + l.duration);

  const getAnimationStyle = (animation: Lyric['animation']) => {
    switch (animation) {
      case 'fadeInUp': return { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -20 } };
      case 'fadeInDown': return { initial: { opacity: 0, y: -20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 20 } };
      case 'bounceIn': return { initial: { scale: 0.3, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { type: "spring", stiffness: 260, damping: 20 } };
      case 'scaleUp': return { initial: { scale: 0 }, animate: { scale: 1 }, exit: { scale: 1.5, opacity: 0 } };
      case 'slideFromLeft': return { initial: { x: -100, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: 100, opacity: 0 } };
      case 'glitch': return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.1 } };
      case 'wave': return { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } };
      default: return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
    }
  };

  const getStyleClass = (style: Lyric['style'], animation: Lyric['animation']) => {
    let base = '';
    switch (style) {
      case 'glow': base = 'text-cyan-400 drop-shadow-[0_0_10px_rgba(0,255,255,0.8)]'; break;
      case 'neon': base = 'text-fuchsia-400 drop-shadow-[0_0_10px_rgba(255,0,255,0.8)]'; break;
      case 'gradient': base = 'bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent'; break;
      case 'fire': base = 'bg-gradient-to-t from-red-600 via-orange-400 to-yellow-300 bg-clip-text text-transparent animate-pulse'; break;
      case 'outline': base = 'text-transparent stroke-white stroke-1 [-webkit-text-stroke:1px_white]'; break;
      default: base = 'text-white drop-shadow-md'; break;
    }
    
    if (animation === 'glitch') base += ' animate-glitch';
    if (animation === 'wave') base += ' animate-wave';
    
    return base;
  };

  return (
    <div className="absolute bottom-12 left-0 w-full flex justify-center items-center pointer-events-none z-50 h-32">
      <AnimatePresence mode="wait">
        {activeLyric && (
          <motion.div
            key={activeLyric.time}
            {...getAnimationStyle(activeLyric.animation)}
            className={cn(
              "text-center font-bold tracking-wider transition-all duration-300",
              activeLyric.isChorus ? "text-6xl md:text-8xl" : "text-4xl md:text-5xl",
              getStyleClass(activeLyric.style, activeLyric.animation)
            )}
          >
            {activeLyric.animation === 'typewriter' ? (
              <TypewriterText text={activeLyric.text} />
            ) : (
              activeLyric.text
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const TypewriterText: React.FC<{ text: string }> = ({ text }) => {
  return (
    <span>
      {text.split('').map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.1 }}
        >
          {char}
        </motion.span>
      ))}
    </span>
  );
};
