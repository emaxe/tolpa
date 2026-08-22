/**
 * App: роутер экранов + инициализация локализации и состояния.
 * Экраны: меню → уровни/магазин/настройки/справка → игра.
 */
import { useEffect, useState } from "react";
import { store, TOTAL_LEVELS } from "./game/core/GameState";
import { l10n } from "./game/localization/LocalizationManager";
import { MainMenu } from "./ui/screens/MainMenu";
import { LevelSelect } from "./ui/screens/LevelSelect";
import { Shop } from "./ui/screens/Shop";
import { Settings } from "./ui/screens/Settings";
import { Help } from "./ui/screens/Help";
import { GameScreen } from "./ui/GameScreen";
import { StoryDialog } from "./ui/screens/StoryDialog";

type Screen = "menu" | "levels" | "shop" | "settings" | "help" | "game";

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("menu");
  const [levelIndex, setLevelIndex] = useState(0);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const saved = store.getData().settings.lang;
    void l10n.init(saved).then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950">
        <div className="animate-pulse text-2xl font-black tracking-widest text-amber-300">ТОЛПА…</div>
      </div>
    );
  }

  const continueLevel = Math.min(TOTAL_LEVELS - 1, store.getData().levelsCompleted.length);

  const play = (index: number) => {
    setLevelIndex(index);
    setEnding(false);
    setScreen("game");
  };

  const openEnding = () => {
    setEnding(true);
  };

  return (
    <div className="h-dvh w-full overflow-hidden bg-slate-950 font-sans text-white app-bg">
      {screen === "menu" && (
        <MainMenu
          onPlay={() => play(continueLevel)}
          onLevels={() => setScreen("levels")}
          onShop={() => setScreen("shop")}
          onSettings={() => setScreen("settings")}
          onHelp={() => setScreen("help")}
        />
      )}
      {screen === "levels" && (
        <LevelSelect onBack={() => setScreen("menu")} onPlay={play} />
      )}
      {screen === "shop" && <Shop onBack={() => setScreen("menu")} />}
      {screen === "settings" && <Settings onBack={() => setScreen("menu")} />}
      {screen === "help" && <Help onBack={() => setScreen("menu")} />}
      {screen === "game" && (
        <GameScreen
          key={levelIndex}
          levelIndex={levelIndex}
          onExit={() => setScreen("levels")}
          onSelectLevel={(i) => play(i)}
          onEnding={openEnding}
        />
      )}
      {ending && screen === "game" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur">
          <StoryDialog
            prefix="dialog.ending"
            onClose={() => {
              setEnding(false);
              setScreen("menu");
            }}
          />
        </div>
      )}
    </div>
  );
}
