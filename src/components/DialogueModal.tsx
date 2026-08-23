import React, { useState, useEffect } from 'react';
import { DialogueLine } from '../types/game';
import { i18n } from '../core/Localization';
import { soundEngine } from '../audio/SoundEngine';
import { MessageSquare, FastForward, ShieldAlert, Cpu, Bot, Skull } from 'lucide-react';

interface DialogueModalProps {
  dialogues: DialogueLine[];
  onComplete: () => void;
}

export const DialogueModal: React.FC<DialogueModalProps> = ({ dialogues, onComplete }) => {
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [displayedText, setDisplayedText] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(true);

  const currentLine = dialogues[currentIndex];
  const fullText = currentLine ? i18n.t(currentLine.textKey, currentLine.fallbackText) : '';

  useEffect(() => {
    if (!currentLine) {
      onComplete();
      return;
    }

    setDisplayedText('');
    setIsTyping(true);
    let charIdx = 0;

    const timer = setInterval(() => {
      if (charIdx < fullText.length) {
        setDisplayedText(fullText.slice(0, charIdx + 1));
        if (charIdx % 3 === 0) {
          soundEngine.playSound('button_click');
        }
        charIdx++;
      } else {
        setIsTyping(false);
        clearInterval(timer);
      }
    }, 24);

    return () => clearInterval(timer);
  }, [currentIndex, currentLine, fullText, onComplete]);

  const handleNext = () => {
    if (isTyping) {
      // Instantly finish typing
      setDisplayedText(fullText);
      setIsTyping(false);
    } else {
      if (currentIndex + 1 < dialogues.length) {
        setCurrentIndex(currentIndex + 1);
      } else {
        onComplete();
      }
    }
  };

  const getAvatarIcon = (speaker: string) => {
    switch (speaker) {
      case 'commander':
        return <ShieldAlert className="w-8 h-8 text-amber-400" />;
      case 'professor':
        return <Cpu className="w-8 h-8 text-amber-400" />;
      case 'echo':
        return <Bot className="w-8 h-8 text-emerald-400" />;
      case 'boss':
      default:
        return <Skull className="w-8 h-8 text-red-500 animate-pulse" />;
    }
  };

  if (!currentLine) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 md:p-8 bg-zinc-950/70 backdrop-blur-sm select-none">
      <div className="w-full max-w-2xl bg-zinc-900/95 border-2 border-amber-500/60 rounded-2xl p-5 shadow-2xl shadow-amber-950/80 relative flex flex-col md:flex-row gap-4 items-start animate-fade-in">
        {/* Avatar Box */}
        <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-zinc-950 border-2 border-amber-400/50 flex items-center justify-center shrink-0 shadow-inner">
          {getAvatarIcon(currentLine.speaker)}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col justify-between min-h-[100px]">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="font-orbitron font-bold text-amber-400 text-sm md:text-base uppercase tracking-wider">
                {i18n.t(currentLine.speakerNameKey, currentLine.speaker)}
              </span>
              <button
                onClick={onComplete}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 font-orbitron cursor-pointer"
              >
                <FastForward className="w-3.5 h-3.5" />
                <span>ПРОПУСК</span>
              </button>
            </div>
            <p className="text-zinc-200 text-sm md:text-base leading-relaxed font-sans">
              {displayedText}
              {isTyping && <span className="inline-block w-2 h-4 bg-amber-400 ml-1 animate-pulse" />}
            </p>
          </div>

          {/* Next Button */}
          <div className="flex justify-end mt-4">
            <button
              onClick={handleNext}
              className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-zinc-950 font-orbitron font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-amber-500/30 transition-transform active:scale-95 cursor-pointer flex items-center gap-1.5"
            >
              <span>{isTyping ? 'ДАЛЕЕ' : currentIndex + 1 < dialogues.length ? 'СЛЕДУЮЩИЙ' : 'В БОЙ'}</span>
              <MessageSquare className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
