(function () {
  const DEFAULT_APP_NAME = 'ILKKM ID CARD';
  const DEFAULT_ICON_URL = '/icon.jpg';
  const DEFAULT_MATCH_CARD_BACKGROUND_URL = '/match_game.jpg';

  function applySettings(settings) {
    const appName = String(settings?.appName || DEFAULT_APP_NAME).trim() || DEFAULT_APP_NAME;
    const iconUrl = settings?.appIconUrl || DEFAULT_ICON_URL;
    const matchCardBackgroundUrl = settings?.matchCardBackgroundUrl || DEFAULT_MATCH_CARD_BACKGROUND_URL;

    window.appSettings = {
      appName,
      appIconUrl: iconUrl,
      matchCardBackgroundUrl,
      matchGameEnabled: Boolean(settings?.matchGameEnabled),
    };

    document.querySelectorAll('[data-app-name]').forEach((element) => {
      element.textContent = appName;
    });

    document.querySelectorAll('img.brand-icon, img.app-icon-image').forEach((image) => {
      image.src = iconUrl;
    });

    document.querySelectorAll('[data-match-game-link]').forEach((element) => {
      element.hidden = !window.appSettings.matchGameEnabled;
      element.style.setProperty('--match-card-background', `url("${matchCardBackgroundUrl}")`);
    });

    if (document.title.includes('ILKKM ID Card Maker')) {
      document.title = document.title.replace('ILKKM ID Card Maker', appName);
    }

    window.dispatchEvent(new CustomEvent('app-settings:ready', { detail: window.appSettings }));
    return window.appSettings;
  }

  window.appSettingsReady = fetch('/api/app-settings')
    .then((response) => response.ok ? response.json() : {})
    .then(applySettings)
    .catch(() => applySettings({
      appName: DEFAULT_APP_NAME,
      appIconUrl: DEFAULT_ICON_URL,
      matchCardBackgroundUrl: DEFAULT_MATCH_CARD_BACKGROUND_URL,
      matchGameEnabled: true,
    }));
}());
