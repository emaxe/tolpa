import React from 'react';
import { i18n } from '../core/Localization';
import { X, BookOpen, Shield, Sparkles, Cpu, Target } from 'lucide-react';

interface GuideModalProps {
  onClose: () => void;
}

export const GuideModal: React.FC<GuideModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-100/80 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-2xl bg-white border border-slate-300 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 bg-slate-100/70 border-b border-slate-300 flex justify-between items-center">
          <h2 className="font-orbitron font-extrabold text-lg text-slate-900 tracking-wider flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-400" />
            <span>{i18n.t('loreTitle')}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-200 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-6 text-sm text-slate-700 leading-relaxed">
          {/* Architecture Summary */}
          <section className="bg-slate-100/70 p-4 rounded-xl border border-teal-500/30">
            <h3 className="font-orbitron font-bold text-teal-300 text-sm flex items-center gap-2 mb-2">
              <Cpu className="w-4 h-4 text-teal-400" />
              <span>Архитектура & Производительность</span>
            </h3>
            <p className="text-xs text-slate-700">
              {i18n.t('loreArchSummary')}
            </p>
            <ul className="list-disc list-inside mt-2 text-xs text-slate-600 space-y-1 font-mono">
              <li>InstancedMesh для толпы из 400+ юнитов с 1 draw call</li>
              <li>Процедурный синтез Web Audio API (без внешних MP3/OGG)</li>
              <li>ObjectPool для частиц и векторов без сборщика мусора (0-GC)</li>
              <li>Сохранение состояния в localStorage с миграцией версий</li>
            </ul>
          </section>

          {/* Formations */}
          <section className="space-y-3">
            <h3 className="font-orbitron font-bold text-slate-900 text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-teal-400" />
              <span>{i18n.t('loreFormationsTitle')}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-100/50 p-3 rounded-xl border border-slate-300">
                <strong className="text-teal-300 font-orbitron">1. Клин (Wedge) [Клавиша 1]:</strong>
                <p className="text-slate-600 mt-1">{i18n.t('wedgeDesc')}</p>
              </div>
              <div className="bg-slate-100/50 p-3 rounded-xl border border-slate-300">
                <strong className="text-teal-300 font-orbitron">2. Шеренга (Wide Line) [Клавиша 2]:</strong>
                <p className="text-slate-600 mt-1">{i18n.t('wideDesc')}</p>
              </div>
              <div className="bg-slate-100/50 p-3 rounded-xl border border-slate-300">
                <strong className="text-teal-300 font-orbitron">3. Фаланга (Circle) [Клавиша 3]:</strong>
                <p className="text-slate-600 mt-1">{i18n.t('circleDesc')}</p>
              </div>
              <div className="bg-slate-100/50 p-3 rounded-xl border border-slate-300">
                <strong className="text-teal-300 font-orbitron">4. Стрела (Arrow) [Клавиша 4]:</strong>
                <p className="text-slate-600 mt-1">{i18n.t('arrowDesc')}</p>
              </div>
            </div>
          </section>

          {/* Specialized Mob Classes */}
          <section className="space-y-3">
            <h3 className="font-orbitron font-bold text-slate-900 text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>{i18n.t('loreSpecialMobsTitle')}</span>
            </h3>
            <div className="space-y-2 text-xs">
              <div className="bg-slate-100/50 p-3 rounded-xl border border-amber-500/30 flex items-start gap-3">
                <span className="p-1.5 bg-amber-500/20 text-amber-400 rounded-lg font-orbitron font-bold">ТАНК</span>
                <div>
                  <h4 className="font-orbitron font-bold text-amber-300">{i18n.t('tankName')}</h4>
                  <p className="text-slate-600 mt-0.5">{i18n.t('tankDesc')}</p>
                </div>
              </div>

              <div className="bg-slate-100/50 p-3 rounded-xl border border-rose-500/30 flex items-start gap-3">
                <span className="p-1.5 bg-rose-500/20 text-rose-400 rounded-lg font-orbitron font-bold">НИНДЗЯ</span>
                <div>
                  <h4 className="font-orbitron font-bold text-rose-300">{i18n.t('ninjaName')}</h4>
                  <p className="text-slate-600 mt-0.5">{i18n.t('ninjaDesc')}</p>
                </div>
              </div>

              <div className="bg-slate-100/50 p-3 rounded-xl border border-emerald-500/30 flex items-start gap-3">
                <span className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg font-orbitron font-bold">МАГ</span>
                <div>
                  <h4 className="font-orbitron font-bold text-emerald-300">{i18n.t('mageName')}</h4>
                  <p className="text-slate-600 mt-0.5">{i18n.t('mageDesc')}</p>
                </div>
              </div>
            </div>
          </section>

          {/* Boss Battle Mechanics */}
          <section className="space-y-2">
            <h3 className="font-orbitron font-bold text-slate-900 text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-red-400" />
              <span>{i18n.t('loreBossesTitle')}</span>
            </h3>
            <p className="text-xs text-slate-600">
              Боссы встречаются каждые 10 уровней (10, 20, 30, 40, 50). Следите за красными кругами телеграфа атак на земле. Переключайтесь в формацию Клин или Фаланга и активируйте Гипер-режим Адреналина (ПРОБЕЛ) в момент атаки босса!
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
