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
        return <ShieldAlert className="w-8 h-8 text-cyan-400" />;
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
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 md:p-8 bg-slate-950/70 backdrop-blur-sm select-none">
      <div className="w-full max-w-2xl bg-slate-900/95 border-2 border-cyan-500/60 rounded-2xl p-5 shadow-2xl shadow-cyan-950/80 relative flex flex-col md:flex-row gap-4 items-start animate-fade-in">
        {/* Avatar Box */}
        <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-slate-950 border-2 border-cyan-400/50 flex items-center justify-center shrink-0 shadow-inner">
          {getAvatarIcon(currentLine.speaker)}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col justify-between min-h-[100px]">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="font-orbitron font-bold text-cyan-400 text-sm md:text-base uppercase tracking-wider">
                {i18n.t(currentLine.speakerNameKey, currentLine.speaker)}
              </span>
              <button
                onClick={onComplete}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-orbitron cursor-pointer"
              >
                <FastForward className="w-3.5 h-3.5" />
                <span>ПРОПУСК</span>
              </button>
            </div>
            <p className="text-slate-200 text-sm md:text-base leading-relaxed font-sans">
              {displayedText}
              {isTyping && <span className="inline-block w-2 h-4 bg-cyan-400 ml-1 animate-pulse" />}
            </p>
          </div>

          {/* Next Button */}
          <div className="flex justify-end mt-4">
            <button
              onClick={handleNext}
              className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-orbitron font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-cyan-600/30 transition-transform active:scale-95 cursor-pointer flex items-center gap-1.5"
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
