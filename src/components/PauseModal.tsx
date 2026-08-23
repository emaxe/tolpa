import React from 'react';
import { i18n } from '../core/Localization';
import { Pause, Play, RotateCcw, Home } from 'lucide-react';

interface PauseModalProps {
  onResume: () => void;
  onRestart: () => void;
  onHome: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({ onResume, onRestart, onHome }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/85 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-sm bg-zinc-900 rounded-3xl shadow-2xl p-6 border-2 border-amber-500/70 shadow-amber-950/80 text-center">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3 shadow-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-zinc-950">
            <Pause className="w-8 h-8 fill-current" />
          </div>
          <h2 className="font-orbitron font-extrabold text-2xl tracking-wider text-amber-400">
            {i18n.t('paused')}
          </h2>
        </div>

        <div className="space-y-2.5">
          <button
            onClick={onResume}
            className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-zinc-950 font-orbitron font-extrabold text-sm uppercase tracking-wider rounded-xl shadow-lg shadow-amber-500/40 flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{i18n.t('resume')}</span>
          </button>

          <button
            onClick={onRestart}
            className="w-full py-2.5 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{i18n.t('retry')}</span>
          </button>

          <button
            onClick={onHome}
            className="w-full py-2.5 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Home className="w-3.5 h-3.5" />
            <span>{i18n.t('toMenu')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
