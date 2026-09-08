/**
 * Tiny singleton so a nav control anywhere in the shell can open the AscendAI
 * panel without lifting its state. AscendAiPanel registers its opener on mount;
 * the sidebar entry calls openAscendAi(). No-ops before the panel mounts or
 * when AscendAI is disabled (the panel never registers).
 */
let opener = null;

export function registerAscendAiOpener(fn) {
  opener = fn;
  return () => {
    if (opener === fn) opener = null;
  };
}

export function openAscendAi() {
  if (opener) opener();
}

export function ascendAiAvailable() {
  return opener !== null;
}
