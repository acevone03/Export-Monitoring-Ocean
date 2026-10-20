// Shared by the theme switch (client) and the root layout (server).

export const THEME_KEY = "nnr-theme";

/** Runs in <head> before paint: applies the saved theme (default System) so dark pages never flash white. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;
