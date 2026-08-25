import React, { useState } from 'react';
import { GameSettings } from '../types/game';
import { stateManager } from '../core/StateManager';
import { i18n } from '../core/Localization';
import { soundEngine } from '../audio/SoundEngine';
import { X, Settings, Volume2, Music, Eye, Sliders, RotateCcw, Download, Upload, Check } from 'lucide-react';

interface SettingsModalProps {
  onClose: () => void;
  onLanguageChanged?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onLanguageChanged }) => {
  const [settings, setSettings] = useState<GameSettings>(stateManager.getState().settings);
  const [importStr, setImportStr] = useState<string>('');
  const [importMsg, setImportMsg] = useState<string>('');
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);

  const updateSetting = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    stateManager.updateSettings({ [key]: value });

    if (key === 'soundVolume') {
      soundEngine.setSfxVolume(value as number);
    } else if (key === 'musicVolume') {
      soundEngine.setBgmVolume(value as number);
    } else if (key === 'language') {
      if (onLanguageChanged) onLanguageChanged();
    }
  };

  const handleExport = () => {
    const b64 = stateManager.exportSave();
    navigator.clipboard.writeText(b64);
    setImportMsg('Сохранение скопировано в буфер обмена!');
    setTimeout(() => setImportMsg(''), 3000);
  };

  const handleImport = () => {
    if (!importStr.trim()) return;
    const ok = stateManager.importSave(importStr.trim());
    if (ok) {
      setSettings(stateManager.getState().settings);
      setImportMsg('Сохранение успешно загружено!');
      setTimeout(() => setImportMsg(''), 3000);
      if (onLanguageChanged) onLanguageChanged();
    } else {
      setImportMsg('Ошибка: неверный формат данных сохранения.');
    }
  };

  const handleReset = () => {
    stateManager.resetProgress();
    setSettings(stateManager.getState().settings);
    setShowResetConfirm(false);
    if (onLanguageChanged) onLanguageChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-100/80 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-xl bg-white border border-slate-300 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 bg-slate-100/70 border-b border-slate-300 flex justify-between items-center">
          <h2 className="font-orbitron font-extrabold text-lg text-slate-900 tracking-wider flex items-center gap-2">
            <Settings className="w-5 h-5 text-amber-400" />
            <span>{i18n.t('settingsTitle')}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-200 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 text-sm">
          {/* Language Toggle */}
          <div className="flex justify-between items-center pb-3 border-b border-slate-300">
            <div>
              <h4 className="font-orbitron font-bold text-slate-900">{i18n.t('language')}</h4>
              <p className="text-xs text-slate-600">RU (Русский) / EN (English)</p>
            </div>
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-300">
              <button
                onClick={() => updateSetting('language', 'ru')}
                className={`px-3 py-1.5 rounded-lg font-orbitron font-bold text-xs transition-all cursor-pointer ${
                  settings.language === 'ru' ? 'bg-amber-400 text-zinc-950 shadow shadow-amber-500/25' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Русский
              </button>
              <button
                onClick={() => updateSetting('language', 'en')}
                className={`px-3 py-1.5 rounded-lg font-orbitron font-bold text-xs transition-all cursor-pointer ${
                  settings.language === 'en' ? 'bg-amber-400 text-zinc-950 shadow shadow-amber-500/25' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                English
              </button>
            </div>
          </div>

          {/* Sound & Music Sliders */}
          <div className="space-y-3 pb-3 border-b border-slate-300">
            <div className="flex justify-between items-center">
              <span className="font-orbitron font-medium text-slate-700 flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-amber-400" />
                <span>{i18n.t('soundVol')}</span>
              </span>
              <span className="font-mono text-amber-400 font-bold">{Math.round(settings.soundVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.soundVolume}
              onChange={(e) => updateSetting('soundVolume', parseFloat(e.target.value))}
              className="w-full accent-amber-400 cursor-pointer"
            />

            <div className="flex justify-between items-center mt-2">
              <span className="font-orbitron font-medium text-slate-700 flex items-center gap-2">
                <Music className="w-4 h-4 text-rose-400" />
                <span>{i18n.t('musicVol')}</span>
              </span>
              <span className="font-mono text-rose-400 font-bold">{Math.round(settings.musicVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.musicVolume}
              onChange={(e) => updateSetting('musicVolume', parseFloat(e.target.value))}
              className="w-full accent-rose-400 cursor-pointer"
            />
          </div>

          {/* Graphics Quality */}
          <div className="space-y-3 pb-3 border-b border-slate-300">
            <div className="flex justify-between items-center">
              <span className="font-orbitron font-medium text-slate-700 flex items-center gap-2">
                <Eye className="w-4 h-4 text-amber-400" />
                <span>{i18n.t('graphics')}</span>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(['high', 'medium', 'low'] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => updateSetting('graphicsQuality', q)}
                  className={`py-2 rounded-xl font-orbitron font-bold text-xs uppercase transition-all cursor-pointer ${
                    settings.graphicsQuality === q
                      ? 'bg-amber-400 text-zinc-950 shadow shadow-amber-500/25'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-300'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Описание выбранного качества */}
            <p className="text-xs text-slate-600 leading-relaxed">
              {settings.graphicsQuality === 'high' && i18n.t('qualityHigh')}
              {settings.graphicsQuality === 'medium' && i18n.t('qualityMed')}
              {settings.graphicsQuality === 'low' && i18n.t('qualityLow')}
            </p>

            {/* Checkboxes for FX */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableShadows}
                  onChange={(e) => updateSetting('enableShadows', e.target.checked)}
                  className="accent-amber-400 rounded"
                />
                <span>{i18n.t('shadows')}</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableScreenShake}
                  onChange={(e) => updateSetting('enableScreenShake', e.target.checked)}
                  className="accent-amber-400 rounded"
                />
                <span>{i18n.t('screenShake')}</span>
              </label>
            </div>
          </div>

          {/* Controls Sensitivity */}
          <div className="space-y-3 pb-3 border-b border-slate-300">
            <div className="flex justify-between items-center">
              <span className="font-orbitron font-medium text-slate-700 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>{i18n.t('sensitivity')}</span>
              </span>
              <span className="font-mono text-amber-400 font-bold">{settings.controlsSensitivity.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={settings.controlsSensitivity}
              onChange={(e) => updateSetting('controlsSensitivity', parseFloat(e.target.value))}
              className="w-full accent-amber-400 cursor-pointer"
            />

            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={settings.invertX}
                onChange={(e) => updateSetting('invertX', e.target.checked)}
                className="accent-amber-400 rounded"
              />
              <span>{i18n.t('invertControls')}</span>
            </label>
          </div>

          {/* Save Management */}
          <div className="space-y-3">
            <h4 className="font-orbitron font-bold text-slate-900 text-xs uppercase tracking-wider">
              {i18n.t('exportSave')} / {i18n.t('importSave')}
            </h4>

            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="flex-1 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{i18n.t('exportSave')}</span>
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Вставьте код сохранения..."
                value={importStr}
                onChange={(e) => setImportStr(e.target.value)}
                className="flex-1 bg-slate-100 border border-slate-300 rounded-xl px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-amber-500"
              />
              <button
                onClick={handleImport}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold shadow shadow-amber-500/25 rounded-xl font-orbitron text-xs flex items-center gap-1 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{i18n.t('importSave')}</span>
              </button>
            </div>

            {importMsg && (
              <p className="text-xs text-emerald-400 font-mono flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                <span>{importMsg}</span>
              </p>
            )}

            {/* Reset Progress */}
            <div className="pt-3 border-t border-slate-300">
              {!showResetConfirm ? (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full py-2 border border-red-500/40 hover:bg-red-500/10 text-red-400 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{i18n.t('resetProgress')}</span>
                </button>
              ) : (
                <div className="bg-red-950/50 border border-red-500/60 p-3 rounded-xl space-y-2">
                  <p className="text-xs text-red-300 leading-relaxed">{i18n.t('resetConfirm')}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReset}
                      className="flex-1 py-1.5 bg-red-600 hover:bg-red-500 text-slate-900 font-orbitron font-bold text-xs rounded-lg cursor-pointer"
                    >
                      ДА, СБРОСИТЬ
                    </button>
                    <button
                      onClick={() => setShowResetConfirm(false)}
                      className="flex-1 py-1.5 bg-slate-200 text-slate-700 font-orbitron text-xs rounded-lg cursor-pointer"
                    >
                      ОТМЕНА
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
