#!/bin/sh
set -e

PROJECT_NAME="crowd-evolution-3d"

print_header() {
    printf "\n"
    printf "==============================================\n"
    printf "  %s - управление проектом\n" "$PROJECT_NAME"
    printf "==============================================\n"
}

print_menu() {
    printf "\n"
    printf "  1) dev        — запустить dev-сервер (vite)\n"
    printf "  2) build      — собрать production-бандл\n"
    printf "  3) preview    — просмотр собранного билда\n"
    printf "  4) test       — запустить тесты (vitest)\n"
    printf "  5) build+run  — собрать и сразу открыть preview\n"
    printf "  6) install    — установить зависимости (npm install)\n"
    printf "  7) clean      — удалить dist/ и node_modules/\n"
    printf "  0) exit       — выход\n"
    printf "\n"
}

ensure_deps() {
    if [ ! -d "node_modules" ]; then
        printf "node_modules не найдены, устанавливаю зависимости...\n"
        npm install
    fi
}

run_dev() {
    ensure_deps
    printf "Запускаю dev-сервер...\n\n"
    npm run dev
}

run_build() {
    ensure_deps
    printf "Собираю production-бандл...\n\n"
    npm run build
    printf "\nСборка завершена. Результат в dist/\n"
}

run_preview() {
    ensure_deps
    if [ ! -d "dist" ]; then
        printf "dist/ не найден, сначала выполняю сборку...\n"
        npm run build
    fi
    printf "Запускаю preview...\n\n"
    npm run preview
}

run_test() {
    ensure_deps
    printf "Запускаю тесты...\n\n"
    npm run test
}

run_build_and_preview() {
    ensure_deps
    printf "Собираю проект...\n\n"
    npm run build
    printf "\nЗапускаю preview собранного билда...\n\n"
    npm run preview
}

run_install() {
    printf "Устанавливаю зависимости через npm install...\n\n"
    npm install
    printf "\nЗависимости установлены.\n"
}

run_clean() {
    printf "Внимание: будут удалены dist/ и node_modules/\n"
    printf "Подтвердить удаление? (y/N): "
    read -r confirm
    case "$confirm" in
        y|Y|yes|Yes)
            rm -rf dist node_modules
            printf "Удалено.\n"
            ;;
        *)
            printf "Отменено.\n"
            ;;
    esac
}

run_choice() {
    choice="$1"
    case "$choice" in
        1) run_dev ;;
        2) run_build ;;
        3) run_preview ;;
        4) run_test ;;
        5) run_build_and_preview ;;
        6) run_install ;;
        7) run_clean ;;
        0) printf "Пока!\n"; exit 0 ;;
        *) printf "Неизвестный вариант: %s\n" "$choice" ;;
    esac
}

if [ "$#" -gt 0 ]; then
    run_choice "$1"
    exit 0
fi

print_header

while true; do
    print_menu
    printf "Выберите режим [0-7]: "
    read -r choice
    run_choice "$choice"
done
