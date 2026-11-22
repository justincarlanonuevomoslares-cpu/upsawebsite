let instagramScriptPromise;

const loadInstagramScript = () => {
  if (window.instgrm?.Embeds) return Promise.resolve();
  if (instagramScriptPromise) return instagramScriptPromise;

  instagramScriptPromise = new Promise((resolve, reject) => {
    let script = document.querySelector('#instagram-embed-script');
    if (!script) {
      script = document.createElement('script');
      script.id = 'instagram-embed-script';
      script.src = 'https://www.instagram.com/embed.js';
      script.async = true;
      document.head.append(script);
    }

    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('Instagram embeds could not be loaded.')), { once: true });
  });

  return instagramScriptPromise;
};

export const processInstagramEmbeds = async () => {
  await loadInstagramScript();
  if (!window.instgrm?.Embeds) throw new Error('Instagram embeds are unavailable.');
  window.instgrm.Embeds.process();
};
